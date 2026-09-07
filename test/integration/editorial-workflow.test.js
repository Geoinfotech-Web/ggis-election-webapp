const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { validDataset } = require('../fixtures');

const databaseUrl = process.env.TEST_DATABASE_URL;

test('draft → review → publish enforces evidence and two people', { skip: !databaseUrl }, async () => {
  const archiveRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'election-source-'));
  process.env.NODE_ENV = 'test';
  process.env.EDITORIAL_DATABASE_URL = databaseUrl;
  process.env.SOURCE_ARCHIVE_ROOT = archiveRoot;
  const store = require('../../src/editorial-store');
  const storage = require('../../src/storage');
  try {
    await store.initializeEditorialStore();
    await store.resetTestData();
    const contents = Buffer.from('%PDF-test source');
    const storageKey = 'president/2015/nigeria/inec-declaration.pdf';
    await storage.storeSourceBuffer(storageKey, contents);
    const draft = await store.createDraft(validDataset(storageKey, contents), 'preparer@example.com');
    assert.equal(draft.status, 'draft');
    assert.equal((await store.submitDraft(draft.id, 'preparer@example.com')).status, 'in_review');
    await assert.rejects(
      store.reviewDataset(draft.id, 'preparer@example.com', 'approved'),
      /preparer cannot approve/
    );
    assert.equal((await store.reviewDataset(draft.id, 'approver@example.com', 'approved')).status, 'verified');
    assert.equal((await store.publishDataset(draft.id, 'approver@example.com')).status, 'published');
    const contests = await store.listPublishedContests({});
    assert.equal(contests.length, 1);
    const results = await store.getPublishedResults(contests[0].id);
    assert.equal(results.results.length, 2);
    assert.equal(results.status, 'published');
    assert.equal((await store.getPublishedSources(draft.id)).length, 1);
  } finally {
    await store.close();
    await fs.rm(archiveRoot, { recursive: true, force: true });
  }
});
