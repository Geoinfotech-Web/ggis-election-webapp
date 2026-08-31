const fs = require('fs/promises');
const path = require('path');
const XLSX = require('xlsx');

const WORKBOOK_PATH = path.join(__dirname, '..', 'public', 'data', 'population-pvc-data.xlsx');
const OUTPUT_PATH = path.join(__dirname, '..', 'public', 'data', 'population-pvc-data.json');

function cleanRow(row) {
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => !key.startsWith('__EMPTY'))
  );
}

function normalizeStateName(value) {
  return value === 'Federal Capital Territory' ? 'FCT' : value;
}

async function main() {
  const workbook = XLSX.readFile(WORKBOOK_PATH);
  const statePopulation = XLSX.utils
    .sheet_to_json(workbook.Sheets['State Population'], { defval: '' })
    .map(cleanRow)
    .filter((row) => row.State && row.State !== 'Water body')
    .map((row) => ({
      state: normalizeStateName(row.State),
      population: Number(row.Population) || 0,
      registeredVoters: Number(row.Registered_Voters) || 0,
      collectedPVCs: Number(row.Collected_PVCs) || 0,
      pvcCollectionRate: Number(row['PVC_Collection_%']) || 0,
      uncollectedPVCs: Number(row.Uncollected_PVCs) || 0,
      uncollectedRate: Number(row['Uncollected_%']) || 0,
    }));

  let currentState = '';
  const lgaPopulation = XLSX.utils
    .sheet_to_json(workbook.Sheets['LGA Population'], { defval: '' })
    .map(cleanRow)
    .map((row) => {
      if (row.state) {
        currentState = row.state;
      }

      return {
        state: normalizeStateName(currentState),
        lga: row.local,
        population: Number(row.mean) || 0,
      };
    })
    .filter((row) => row.state && row.lga);

  const governors = XLSX.utils
    .sheet_to_json(workbook.Sheets['Governors and Party'], { defval: '' })
    .map(cleanRow)
    .filter((row) => row.STATE)
    .map((row) => ({
      state: normalizeStateName(row.STATE),
      governor: row["GOVERNOR'S NAME"],
      party: row.PARTY,
      geopoliticalZone: row['GEOPOLITICAL ZONES'],
    }));

  const output = {
    generatedAt: new Date().toISOString(),
    statePopulation,
    lgaPopulation,
    governors,
  };

  await fs.writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
