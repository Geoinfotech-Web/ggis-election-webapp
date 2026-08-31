#!/usr/bin/env node
/**
 * Generate official INEC LGA-collated governorship JSON files.
 * Sources are cited in each dataset's meta.sourceDetail.
 */
const fs = require('fs');
const path = require('path');
const { buildGovernorshipDataset } = require('./lib/build-gov-dataset');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'data', 'election-results', 'official');

const DATASETS = [
  {
    file: 'ekiti-2014-lga.json',
    payload: buildGovernorshipDataset({
      state: 'Ekiti',
      year: '2014',
      updated: '2014-06-21',
      sourceDetail: 'INEC LGA collation centres — The Cable / Vanguard reporting official returns, 21 June 2014',
      candidates: [
        { name: 'Ayodele Fayose', party: 'PDP', votes: 203090 },
        { name: 'Kayode Fayemi', party: 'APC', votes: 120433 },
        { name: 'Opeyemi Bamidele', party: 'LP', votes: 18135 },
      ],
      lgaRows: [
        { lga: 'Ado', votes: { APC: 13927, LP: 2065, PDP: 41169 } },
        { lga: 'Efon', votes: { APC: 3422, LP: 358, PDP: 5335 } },
        { lga: 'Ekiti East', votes: { APC: 8584, LP: 884, PDP: 12498 } },
        { lga: 'Ekiti South West', votes: { APC: 6746, LP: 1413, PDP: 11038 } },
        { lga: 'Ekiti West', votes: { APC: 7860, LP: 884, PDP: 10702 } },
        { lga: 'Emure', votes: { APC: 4332, LP: 1527, PDP: 7086 } },
        { lga: 'Gbonyin', votes: { APC: 8138, LP: 714, PDP: 11046 } },
        { lga: 'Ido/Osi', votes: { APC: 7134, LP: 1182, PDP: 13045 } },
        { lga: 'Irepodun/Ifelodun', votes: { APC: 6834, LP: 3555, PDP: 13038 } },
        { lga: 'Ikere', votes: { APC: 7989, LP: 585, PDP: 16197 } },
        { lga: 'Ikole', votes: { APC: 8804, LP: 1259, PDP: 14238 } },
        { lga: 'Ijero', votes: { APC: 9348, LP: 1554, PDP: 13814 } },
        { lga: 'Ilejemeje', votes: { APC: 3336, LP: 165, PDP: 3670 } },
        { lga: 'Ise/Orun', votes: { APC: 5809, LP: 600, PDP: 10136 } },
        { lga: 'Moba', votes: { APC: 7994, LP: 1000, PDP: 8878 } },
        { lga: 'Oye', votes: { APC: 10176, LP: 512, PDP: 11200 } },
      ],
    }),
  },
  {
    file: 'ekiti-2018-lga.json',
    payload: buildGovernorshipDataset({
      state: 'Ekiti',
      year: '2018',
      updated: '2018-07-14',
      sourceDetail: 'INEC LGA collation centres — Tribune Online / Vanguard reporting official returns, 14 July 2018',
      candidates: [
        { name: 'Kayode Fayemi', party: 'APC', votes: 197459 },
        { name: 'Kolapo Olushola', party: 'PDP', votes: 178121 },
        { name: 'Opeyemi Bamidele', party: 'LP', votes: 9205 },
      ],
      lgaRows: [
        { lga: 'Ado', votes: { APC: 28111, PDP: 32810 } },
        { lga: 'Ekiti East', votes: { APC: 12778, PDP: 11564 } },
        { lga: 'Ekiti South West', votes: { APC: 11015, PDP: 8423 } },
        { lga: 'Ekiti West', votes: { APC: 12648, PDP: 10137 } },
        { lga: 'Emure', votes: { APC: 7048, PDP: 7121 } },
        { lga: 'Efon', votes: { APC: 5028, PDP: 5192 } },
        { lga: 'Gbonyin', votes: { APC: 11498, PDP: 8027 } },
        { lga: 'Ido/Osi', votes: { APC: 12342, PDP: 11145 } },
        { lga: 'Ijero', votes: { APC: 14192, PDP: 11077 } },
        { lga: 'Ikere', votes: { APC: 11515, PDP: 17183 } },
        { lga: 'Ikole', votes: { APC: 14522, PDP: 13961 } },
        { lga: 'Ilejemeje', votes: { APC: 4153, PDP: 3937 } },
        { lga: 'Irepodun/Ifelodun', votes: { APC: 13869, PDP: 11456 } },
        { lga: 'Ise/Orun', votes: { APC: 11908, PDP: 6297 } },
        { lga: 'Moba', votes: { APC: 11837, PDP: 8520 } },
        { lga: 'Oye', votes: { APC: 14995, PDP: 11271 } },
      ],
    }),
  },
  {
    file: 'ekiti-2022-lga.json',
    payload: buildGovernorshipDataset({
      state: 'Ekiti',
      year: '2022',
      updated: '2022-06-18',
      sourceDetail: 'INEC LGA collation centres — Wikipedia / The Eagle Online reporting official returns, 18 June 2022',
      candidates: [
        { name: 'Biodun Oyebanji', party: 'APC', votes: 187057 },
        { name: 'Segun Oni', party: 'SDP', votes: 82211 },
        { name: 'Bisi Kolawole', party: 'PDP', votes: 67457 },
      ],
      lgaRows: [
        { lga: 'Ado', votes: { APC: 23831, PDP: 7575, SDP: 15214 } },
        { lga: 'Efon', votes: { APC: 4012, PDP: 6303, SDP: 339 } },
        { lga: 'Ekiti East', votes: { APC: 12099, PDP: 5230, SDP: 4982 } },
        { lga: 'Ekiti South West', votes: { APC: 9679, PDP: 4474, SDP: 4577 } },
        { lga: 'Ekiti West', votes: { APC: 15322, PDP: 3386, SDP: 3863 } },
        { lga: 'Emure', votes: { APC: 7728, PDP: 2610, SDP: 3445 } },
        { lga: 'Gbonyin', votes: { APC: 11247, PDP: 3947, SDP: 4059 } },
        { lga: 'Ido/Osi', votes: { APC: 10321, PDP: 2871, SDP: 9489 } },
        { lga: 'Ijero', votes: { APC: 13754, PDP: 4897, SDP: 5006 } },
        { lga: 'Ikere', votes: { APC: 12086, PDP: 3789, SDP: 1943 } },
        { lga: 'Ikole', votes: { APC: 16417, PDP: 6266, SDP: 5736 } },
        { lga: 'Ilejemeje', votes: { APC: 4357, PDP: 1157, SDP: 2344 } },
        { lga: 'Irepodun/Ifelodun', votes: { APC: 13125, PDP: 4712, SDP: 5010 } },
        { lga: 'Ise/Orun', votes: { APC: 8074, PDP: 2588, SDP: 5909 } },
        { lga: 'Moba', votes: { APC: 11609, PDP: 3530, SDP: 4904 } },
        { lga: 'Oye', votes: { APC: 13396, PDP: 4122, SDP: 3591 } },
      ],
    }),
  },
  {
    file: 'osun-2018-lga.json',
    payload: buildGovernorshipDataset({
      state: 'Osun',
      year: '2018',
      updated: '2018-09-22',
      sourceDetail: 'INEC LGA collation centres — Daily Post Nigeria reporting official returns, 22 September 2018 (first ballot)',
      candidates: [
        { name: 'Gboyega Oyetola', party: 'APC', votes: 254345 },
        { name: 'Ademola Adeleke', party: 'PDP', votes: 254698 },
        { name: 'Iyiola Omisore', party: 'SDP', votes: 128889 },
      ],
      lgaRows: [
        { lga: 'Boluwaduro', votes: { APC: 3843, PDP: 3779, SDP: 1766 } },
        { lga: 'Atakumosa West', votes: { APC: 5019, PDP: 5401, SDP: 1570 } },
        { lga: 'Ifedayo', votes: { APC: 3182, PDP: 3374, SDP: 1377 } },
        { lga: 'Ede South', votes: { APC: 4512, PDP: 16693, SDP: 855 } },
        { lga: 'Orolu', votes: { APC: 5442, PDP: 7776, SDP: 2043 } },
        { lga: 'Obokun', votes: { APC: 7229, PDP: 10859, SDP: 1907 } },
        { lga: 'Ilesa East', votes: { APC: 9790, PDP: 8244, SDP: 3620 } },
        { lga: 'Boripe', votes: { APC: 11655, PDP: 6892, SDP: 2730 } },
        { lga: 'Ilesa West', votes: { APC: 7251, PDP: 8286, SDP: 2408 } },
        { lga: 'Oriade', votes: { APC: 9778, PDP: 10109, SDP: 2265 } },
        { lga: 'Irepodun', votes: { APC: 6517, PDP: 8058, SDP: 4856 } },
        { lga: 'Ila', votes: { APC: 8403, PDP: 8241, SDP: 3134 } },
        { lga: 'Isokan', votes: { APC: 7297, PDP: 9048, SDP: 3460 } },
        { lga: 'Odo-Otin', votes: { APC: 9996, PDP: 9879, SDP: 2941 } },
        { lga: 'Ayedaade', votes: { APC: 10861, PDP: 9836, SDP: 2967 } },
        { lga: 'Atakumosa East', votes: { APC: 7073, PDP: 5218, SDP: 2140 } },
        { lga: 'Ede North', votes: { APC: 7025, PDP: 18745, SDP: 1382 } },
        { lga: 'Ifelodun', votes: { APC: 9882, PDP: 12269, SDP: 1970 } },
        { lga: 'Ayedire', votes: { APC: 5474, PDP: 5133, SDP: 2396 } },
        { lga: 'Ife North', votes: { APC: 6527, PDP: 5486, SDP: 5158 } },
        { lga: 'Ejigbo', votes: { APC: 14779, PDP: 4803, SDP: 4803 } },
        { lga: 'Egbedore', votes: { APC: 7354, PDP: 7231, SDP: 3367 } },
        { lga: 'Ife Central', votes: { APC: 6957, PDP: 3200, SDP: 20494 } },
        { lga: 'Irewole', votes: { APC: 10049, PDP: 13848, SDP: 1142 } },
        { lga: 'Olorunda', votes: { APC: 16254, PDP: 9850, SDP: 7061 } },
        { lga: 'Ola-Oluwa', votes: { APC: 5025, PDP: 4026, SDP: 2104 } },
        { lga: 'Ife South', votes: { APC: 7223, PDP: 4872, SDP: 6151 } },
        { lga: 'Ife East', votes: { APC: 8925, PDP: 6608, SDP: 17643 } },
        { lga: 'Iwo', votes: { APC: 7644, PDP: 6122, SDP: 4153 } },
        { lga: 'Osogbo', votes: { APC: 23379, PDP: 14499, SDP: 10188 } },
      ],
    }),
  },
];

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const entry of DATASETS) {
    const outPath = path.join(OUT_DIR, entry.file);
    fs.writeFileSync(outPath, JSON.stringify(entry.payload, null, 2));
    console.log(`Wrote ${outPath} (${Object.keys(entry.payload.units).length} LGAs)`);
  }
}

main();
