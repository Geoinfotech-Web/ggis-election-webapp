const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'polling-cache-test-'));
process.env.ELECTION_DB_PATH = path.join(root, 'cache.db');
const store = require('../../db');

test('upgrades an unversioned coordinate cache and rolls back failed imports', () => {
  const db = store.getDb();
  try {
    db.exec("INSERT INTO polling_units(state,lga,code,state_norm,lga_norm,latitude,longitude) VALUES ('Fake','Fake','fake','fake','fake',7,8)");
    const normalize = row => ({state:row.state,lga:row.lg,ward:row.ward,code:row.code,
      latitude:row.lat.trim() ? Number(row.lat) : null,
      longitude:row.long.trim() ? Number(row.long) : null});
    assert.equal(store.ensurePollingUnitsSeeded(normalize), 176846);
    assert.ok(store.getDbStatus().pollingUnitsWithCoordinates >= 100000);
    assert.equal(db.prepare("SELECT count(*) n FROM polling_units WHERE code='fake'").get().n, 0);
    assert.equal(store.ensurePollingUnitsSeeded(() => { throw new Error('Unexpected reimport'); }), 176846);
    assert.throws(() => store.importPollingUnitsFromCsv(store.CSV_PATH, () => { throw new Error('Bad row'); }), /Bad row/);
    assert.equal(store.getDbStatus().pollingUnits, 176846);
    assert.ok(store.getDbStatus().pollingUnitsWithCoordinates >= 100000);
  } finally {
    db.close();
    fs.rmSync(root, {recursive:true,force:true});
  }
});
