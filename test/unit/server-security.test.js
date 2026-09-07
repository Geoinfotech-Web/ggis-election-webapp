const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

process.env.NODE_ENV = 'development';
delete process.env.EDITORIAL_DATABASE_URL;
delete process.env.DATABASE_URL;
const { app } = require('../../server');

test('health and security headers are available without starting a port', async () => {
  const response = await request(app).get('/health/live').expect(200);
  assert.equal(response.body.ok, true);
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['x-frame-options'], 'SAMEORIGIN');
});

test('password login is permanently disabled', async () => {
  const response = await request(app).post('/api/admin/login').send({ username: 'admin', password: 'admin123' }).expect(410);
  assert.match(response.body.error, /removed/);
  assert.equal(response.body.token, undefined);
});

test('unconfigured editorial APIs fail closed', async () => {
  await request(app).get('/api/v1/contests').expect(503);
});

test('cross-origin requests are denied', async () => {
  const response = await request(app).get('/health/live').set('Origin', 'https://attacker.example').expect(403);
  assert.notEqual(response.headers['access-control-allow-origin'], 'https://attacker.example');
});

test('legacy dataset catalogue exposes neither files nor unpublished data', async () => {
  const response = await request(app).get('/api/election-results/datasets').expect(200);
  assert.equal(response.body.status, 'deprecated');
  assert.deepEqual(response.body.datasets, []);
  assert.equal(response.body.dir, undefined);
  assert.equal(response.headers.deprecation, 'true');
});

test('legacy result discovery is empty while files are quarantined', async () => {
  const states = await request(app).get('/api/election-results/gov-states?year=2026').expect(200);
  assert.deepEqual(states.body.states, []);
  const result = await request(app).get('/api/election-results/ekiti').expect(200);
  assert.equal(result.body.status, 'quarantined');
  assert.equal(result.body.latest, null);
  assert.deepEqual(result.body.news, []);
});

test('reference summary labels uncertain and missing data', async () => {
  const response = await request(app).get('/api/v1/reference-summary').expect(200);
  assert.equal(response.body.voterRegister.status, 'in_review');
  assert.equal(response.body.population.status, 'quarantined');
  assert.equal(Number.isInteger(response.body.pollingUnits.records), true);
  assert.match(response.body.pollingUnits.coordinateAccuracy, /not inferred/);
  const full = await request(app).get('/api/population-data').expect(200);
  assert.equal(full.body.chairmanDirectory, undefined);
});
