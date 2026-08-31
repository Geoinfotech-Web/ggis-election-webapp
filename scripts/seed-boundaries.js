#!/usr/bin/env node
/**
 * Import bundled GRID3 shapefiles into SQLite boundary tables.
 * Run: npm run seed:boundaries
 */
const fs = require('fs');
const path = require('path');
const { importGeoJson } = require('../boundaries-data');

const ROOT = path.join(__dirname, '..');

async function readShapefileSet(dir, base) {
  const shp = (await import('shpjs')).default;
  return shp({
    shp: fs.readFileSync(path.join(dir, `${base}.shp`)),
    dbf: fs.readFileSync(path.join(dir, `${base}.dbf`)),
    prj: fs.readFileSync(path.join(dir, `${base}.prj`)),
  });
}

async function main() {
  const stateDir = path.join(ROOT, 'Shapefiles', 'state-administrative-boundaries');
  const lgaDir = path.join(ROOT, 'Shapefiles', 'local-government-administrative-boundaries');

  if (!fs.existsSync(path.join(stateDir, 'u_boundary_states.shp'))) {
    console.error('State shapefile not found under Shapefiles/state-administrative-boundaries');
    process.exit(1);
  }

  const states = await readShapefileSet(stateDir, 'u_boundary_states');
  const stateResult = importGeoJson('state', states, 'u_boundary_states.shp');
  console.log(`Imported ${stateResult.featureCount} state boundaries`);

  if (fs.existsSync(path.join(lgaDir, 'u_boundary_lgas.shp'))) {
    const lgas = await readShapefileSet(lgaDir, 'u_boundary_lgas');
    const lgaResult = importGeoJson('lga', lgas, 'u_boundary_lgas.shp');
    console.log(`Imported ${lgaResult.featureCount} LGA boundaries`);
  } else {
    console.warn('LGA shapefile not found; skipped');
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
