const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

test('page-content-store sanitizes, drafts, publishes, and serves by country', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'eid-page-content-'));
  const storePath = path.join(tmp, 'page-content.json');
  process.env.PAGE_CONTENT_PATH = storePath;
  delete require.cache[require.resolve('../../src/page-content-store')];
  const store = require('../../src/page-content-store');

  const listed = await store.listCountries();
  assert.ok(listed.countries.some((c) => c.code === 'ng'));
  assert.ok(listed.enums.navIds.includes('Analysis'));

  const admin = await store.getAdminCountry('ng');
  assert.equal(admin.draft.country, 'ng');
  assert.ok(admin.draft.nav.length >= 8);
  assert.equal(admin.published, null);

  const draft = {
    ...admin.draft,
    nav: admin.draft.nav.map((n) => (
      n.id === 'Data' ? { ...n, visible: false, label: 'Datasets' } : n
    )),
    editorial: {
      ...admin.draft.editorial,
      headline: 'Nigeria studio test',
      notes: 'Published from unit test',
      kpiCards: [{ id: 'k1', label: 'Test KPI', value: '42', unit: '%', caption: 'unit', icon: 'bolt' }],
    },
    widgets: admin.draft.widgets.map((w) => (
      w.id === 'ana-vote-share' ? { ...w, title: 'Share of vote', visible: true } : w
    )),
  };

  const saved = await store.saveDraft('ng', draft);
  assert.match(saved.draft.updatedAt || '', /T/);
  assert.equal(saved.draft.nav.find((n) => n.id === 'Data').visible, false);
  assert.equal(saved.draft.nav.find((n) => n.id === 'Data').label, 'Datasets');

  const pubBefore = await store.getPublished('ng');
  assert.equal(pubBefore.published, null);

  const published = await store.publishCountry('ng');
  assert.ok(published.published);
  assert.equal(published.published.editorial.headline, 'Nigeria studio test');
  assert.equal(published.published.widgets.find((w) => w.id === 'ana-vote-share').title, 'Share of vote');

  const pubAfter = await store.getPublished('ng');
  assert.equal(pubAfter.published.editorial.kpiCards[0].value, '42');

  await assert.rejects(() => store.getAdminCountry('xx'), /Unknown country/);

  delete process.env.PAGE_CONTENT_PATH;
  delete require.cache[require.resolve('../../src/page-content-store')];
});

test('public page-content route returns published or null without auth', async () => {
  process.env.NODE_ENV = 'development';
  delete process.env.EDITORIAL_DATABASE_URL;
  delete process.env.DATABASE_URL;
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'eid-page-content-api-'));
  process.env.PAGE_CONTENT_PATH = path.join(tmp, 'page-content.json');
  delete require.cache[require.resolve('../../src/page-content-store')];
  delete require.cache[require.resolve('../../server')];
  const request = require('supertest');
  const { app } = require('../../server');
  const store = require('../../src/page-content-store');

  const empty = await request(app).get('/api/page-content/ng').expect(200);
  assert.equal(empty.body.ok, true);
  assert.equal(empty.body.published, null);

  const admin = await store.getAdminCountry('global');
  await store.saveDraft('global', {
    ...admin.draft,
    editorial: { ...admin.draft.editorial, headline: 'Global headline' },
  });
  await store.publishCountry('global');

  const published = await request(app).get('/api/page-content/global').expect(200);
  assert.equal(published.body.published.editorial.headline, 'Global headline');
  assert.ok(published.headers['cache-control']);

  await request(app).put('/api/admin/pages/ng').send({ bundle: {} }).expect(401);

  delete process.env.PAGE_CONTENT_PATH;
  delete require.cache[require.resolve('../../src/page-content-store')];
  delete require.cache[require.resolve('../../server')];
});
