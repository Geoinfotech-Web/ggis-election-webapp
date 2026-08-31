const fs = require('fs/promises');
const path = require('path');
const JSZip = require('jszip');
const { google } = require('googleapis');
const { getAuthClient } = require('../auth');

const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'data', 'boundaries');

const LAYERS = {
  adm0: [
    ['NGA_adm0.shp', '13nF__neiDAmlrGpCCr_TohJTOQDj7Di2'],
    ['NGA_adm0.shx', '1qr0subx4NjV_vw_iYzB4Ccci2swv0t6D'],
    ['NGA_adm0.dbf', '1U-15cEDNM2SlkiYXsUkwzcLCfuTnHDI0'],
    ['NGA_adm0.prj', '1cD6_6knbFvhlQ5xF7ruaQrp_vkkmA7sy'],
    ['NGA_adm0.cpg', '1lmqUIVQTl-rH_CiBW4ZmJUtuKcY5mSnB'],
  ],
  adm1: [
    ['NGA_adm1.shp', '1TFxkmwyN-4S70kymxIq98gMvyOIkFLpe'],
    ['NGA_adm1.shx', '1CfINS4kL7SPvj5AwumoF0oxEI0hlsofW'],
    ['NGA_adm1.dbf', '1d0Q6pdeSZCiEMCfCMwmml9uCwWorBPRD'],
    ['NGA_adm1.prj', '1HxznilAOQ2WeqQcQ8DpNafKjGDcKDkHT'],
    ['NGA_adm1.cpg', '1b1De5z0o3d-CE_2S8PFxQV5gFERVvw6O'],
  ],
  adm2: [
    ['NGA_adm2.shp', '1X3HNojcAaFoTwbt4FSGrGr-P6r4rsBuL'],
    ['NGA_adm2.shx', '1Q6npNOQcYv4soStL02w5eTH1li3S5u3B'],
    ['NGA_adm2.dbf', '1GIyJ1fRgNe1H90tHVVNDphoKHA1DB-bt'],
    ['NGA_adm2.prj', '1RemlKWXKqgwdYDAnJ6T05PkhR91M8nTK'],
    ['NGA_adm2.cpg', '1esrtMhGSm_wbjm3hyBBgwqjfQ6tIspue'],
  ],
};

async function downloadFile(drive, fileId) {
  const response = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );

  return Buffer.from(response.data);
}

async function createLayerZip(drive, layerName, files) {
  const zip = new JSZip();

  for (const [fileName, fileId] of files) {
    const buffer = await downloadFile(drive, fileId);
    zip.file(fileName, buffer);
    console.log(`Downloaded ${fileName}`);
  }

  const zipped = await zip.generateAsync({ type: 'nodebuffer' });
  const outputPath = path.join(OUTPUT_DIR, `${layerName}.zip`);
  await fs.writeFile(outputPath, zipped);
  console.log(`Wrote ${outputPath}`);
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const auth = await getAuthClient();
  const drive = google.drive({ version: 'v3', auth });

  for (const [layerName, files] of Object.entries(LAYERS)) {
    await createLayerZip(drive, layerName, files);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
