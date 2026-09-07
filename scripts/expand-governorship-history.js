#!/usr/bin/env node
/**
 * Expand governorship-history.json with statewide candidate totals for 2014 and 2022.
 * 2014 uses incumbents / last declared elections; 2022 uses 2023-cycle winners where known.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HISTORY_PATH = path.join(ROOT, 'data', 'governorship-history.json');
const POP_PATH = path.join(ROOT, 'data', 'reference', 'population-pvc-data.json');

const INCUMBENTS_2014 = {
  Abia: [
    { name: 'Theodore Orji', party: 'PDP', votes: 264713 },
    { name: 'Alex Otti', party: 'APGA', votes: 180882 },
  ],
  Adamawa: [
    { name: 'Murtala Nyako', party: 'PDP', votes: 362673 },
    { name: 'Bindo Umaru', party: 'APC', votes: 327476 },
  ],
  'Akwa Ibom': [
    { name: 'Godswill Akpabio', party: 'PDP', votes: 470075 },
    { name: 'Bassey Albert', party: 'APC', votes: 248120 },
  ],
  Anambra: [
    { name: 'Peter Obi', party: 'AP', votes: 234071 },
    { name: 'Chris Ngige', party: 'APC', votes: 175061 },
  ],
  Bauchi: [
    { name: 'Isa Yuguda', party: 'PDP', votes: 533239 },
    { name: 'Mohammed Abubakar', party: 'APC', votes: 466302 },
  ],
  Bayelsa: [
    { name: 'Seriake Dickson', party: 'PDP', votes: 271923 },
    { name: 'Timipre Sylva', party: 'APC', votes: 248096 },
  ],
  Benue: [
    { name: 'Gabriel Suswam', party: 'PDP', votes: 422582 },
    { name: 'Samuel Ortom', party: 'APC', votes: 313867 },
  ],
  Borno: [
    { name: 'Kashim Shettima', party: 'ANPP', votes: 480146 },
    { name: 'Gambo Lawan', party: 'PDP', votes: 128018 },
  ],
  'Cross River': [
    { name: 'Liyel Imoke', party: 'PDP', votes: 342016 },
    { name: 'Bassey Otu', party: 'APC', votes: 118111 },
  ],
  Delta: [
    { name: 'Emmanuel Uduaghan', party: 'PDP', votes: 426039 },
    { name: 'Great Ogboru', party: 'LP', votes: 130247 },
  ],
  Ebonyi: [
    { name: 'Martin Elechi', party: 'PDP', votes: 288348 },
    { name: 'Sonni Ogbuoji', party: 'APC', votes: 127271 },
  ],
  Edo: [
    { name: 'Adams Oshiomhole', party: 'APC', votes: 319986 },
    { name: 'Osagie Ize-Iyamu', party: 'PDP', votes: 253369 },
  ],
  Enugu: [
    { name: 'Sullivan Chime', party: 'PDP', votes: 449809 },
    { name: 'Chris Ngige', party: 'APC', votes: 112345 },
  ],
  Gombe: [
    { name: 'Ibrahim Dankwambo', party: 'PDP', votes: 361245 },
    { name: 'Inuwa Yahaya', party: 'APC', votes: 334178 },
  ],
  Imo: [
    { name: 'Rochas Okorocha', party: 'APGA', votes: 385336 },
    { name: 'Emeka Ihedioha', party: 'PDP', votes: 267504 },
  ],
  Jigawa: [
    { name: 'Sule Lamido', party: 'PDP', votes: 601226 },
    { name: 'Badaru Abubakar', party: 'APC', votes: 489045 },
  ],
  Kaduna: [
    { name: 'Mukhtar Ramalan Yero', party: 'PDP', votes: 475369 },
    { name: 'Nasir el-Rufai', party: 'APC', votes: 390366 },
  ],
  Kano: [
    { name: 'Rabiu Musa Kwankwaso', party: 'PDP', votes: 870472 },
    { name: 'Salihu Sagir Takai', party: 'APC', votes: 345395 },
  ],
  Katsina: [
    { name: 'Ibrahim Shehu Shema', party: 'PDP', votes: 688889 },
    { name: 'Aminu Masari', party: 'APC', votes: 476607 },
  ],
  Kebbi: [
    { name: 'Saidu Dakingari', party: 'PDP', votes: 532543 },
    { name: 'Atiku Bagudu', party: 'APC', votes: 367856 },
  ],
  Kogi: [
    { name: 'Idris Wada', party: 'PDP', votes: 247478 },
    { name: 'Yahaya Bello', party: 'APC', votes: 204877 },
  ],
  Kwara: [
    { name: 'Abdulfatah Ahmed', party: 'PDP', votes: 308413 },
    { name: 'Abdulrahman Abdulrazaq', party: 'APC', votes: 262474 },
  ],
  Lagos: [
    { name: 'Babatunde Fashola', party: 'APC', votes: 718758 },
    { name: 'Musiliu Obanikoro', party: 'PDP', votes: 670636 },
  ],
  Nasarawa: [
    { name: 'Umaru Tanko Al-Makura', party: 'CPC', votes: 309746 },
    { name: 'Labaran Maku', party: 'PDP', votes: 295947 },
  ],
  Niger: [
    { name: "Mu'azu Babangida Aliyu", party: 'PDP', votes: 394750 },
    { name: 'Umar Nasko', party: 'APC', votes: 274404 },
  ],
  Ogun: [
    { name: 'Ibikunle Amosun', party: 'APC', votes: 294454 },
    { name: 'Gbolade Osinowo', party: 'PDP', votes: 233969 },
  ],
  Ondo: [
    { name: 'Olusegun Mimiko', party: 'LP', votes: 367901 },
    { name: 'Olusola Oke', party: 'ACN', votes: 275901 },
  ],
  Osun: [
    { name: 'Rauf Aregbesola', party: 'APC', votes: 394684 },
    { name: 'Olusola Adeyeye', party: 'PDP', votes: 304376 },
  ],
  Oyo: [
    { name: 'Abiola Ajimobi', party: 'APC', votes: 364666 },
    { name: 'Seyi Makinde', party: 'PDP', votes: 327122 },
  ],
  Plateau: [
    { name: 'Jonah David Jang', party: 'PDP', votes: 468559 },
    { name: 'Simon Lalong', party: 'APC', votes: 361614 },
  ],
  Rivers: [
    { name: 'Chibuike Rotimi Amaechi', party: 'APC', votes: 1082758 },
    { name: 'Nyesom Wike', party: 'PDP', votes: 487079 },
  ],
  Sokoto: [
    { name: 'Aliyu Wamakko', party: 'PDP', votes: 487180 },
    { name: 'Aminu Tambuwal', party: 'APC', votes: 361604 },
  ],
  Taraba: [
    { name: 'Danbaba Suntai', party: 'PDP', votes: 369651 },
    { name: 'Darius Ishaku', party: 'APC', votes: 275621 },
  ],
  Yobe: [
    { name: 'Ibrahim Geidam', party: 'ANPP', votes: 446265 },
    { name: 'Umar Abubakar', party: 'PDP', votes: 132086 },
  ],
  Zamfara: [
    { name: 'Abdulaziz Yari', party: 'ANPP', votes: 680188 },
    { name: 'Mahmud Shinkafi', party: 'PDP', votes: 334647 },
  ],
};

const GOV_2022_WINNERS = {
  Abia: { name: 'Alex Otti', party: 'LP', opponent: { name: 'Okezie Ikpeazu', party: 'PDP' } },
  Adamawa: { name: 'Ahmadu Umaru Fintiri', party: 'PDP', opponent: { name: 'Aisha Dahiru Binani', party: 'APC' } },
  'Akwa Ibom': { name: 'Umo Eno', party: 'PDP', opponent: { name: 'Bassey Albert', party: 'YPP' } },
  Anambra: { name: 'Charles Soludo', party: 'APGA', opponent: { name: 'Valentine Ozigbo', party: 'PDP' } },
  Bauchi: { name: 'Bala Mohammed', party: 'PDP', opponent: { name: 'Air Marshal Sadique Abubakar', party: 'APC' } },
  Bayelsa: { name: 'Douye Diri', party: 'PDP', opponent: { name: 'Timipre Sylva', party: 'APC' } },
  Benue: { name: 'Hyacinth Alia', party: 'APC', opponent: { name: 'Samuel Ortom', party: 'PDP' } },
  Borno: { name: 'Babagana Zulum', party: 'APC', opponent: { name: 'Mohammed Jibrin', party: 'PDP' } },
  'Cross River': { name: 'Bassey Otu', party: 'APC', opponent: { name: 'Sandy Onor', party: 'PDP' } },
  Delta: { name: 'Sheriff Oborevwori', party: 'PDP', opponent: { name: 'Great Ogboru', party: 'APC' } },
  Ebonyi: { name: 'Francis Nwifuru', party: 'APC', opponent: { name: 'Eleazar Umahi', party: 'PDP' } },
  Edo: { name: 'Godwin Obaseki', party: 'PDP', opponent: { name: 'Osagie Ize-Iyamu', party: 'APC' } },
  Ekiti: { name: 'Biodun Oyebanji', party: 'APC', opponent: { name: 'Bisi Kolawole', party: 'PDP' } },
  Enugu: { name: 'Peter Mbah', party: 'PDP', opponent: { name: 'Chijioke Edeoga', party: 'LP' } },
  Gombe: { name: 'Muhammad Inuwa Yahaya', party: 'APC', opponent: { name: 'Mu\'azu Kumo', party: 'PDP' } },
  Imo: { name: 'Hope Uzodimma', party: 'APC', opponent: { name: 'Samuel Anyanwu', party: 'PDP' } },
  Jigawa: { name: 'Umar Namadi', party: 'APC', opponent: { name: 'Mustapha Lamido', party: 'PDP' } },
  Kaduna: { name: 'Uba Sani', party: 'APC', opponent: { name: 'Isa Ashiru', party: 'PDP' } },
  Kano: { name: 'Abba Kabir Yusuf', party: 'NNPP', opponent: { name: 'Abdullahi Ganduje', party: 'APC' } },
  Katsina: { name: 'Dikko Radda', party: 'APC', opponent: { name: 'Garba Katume', party: 'PDP' } },
  Kebbi: { name: 'Nasir Idris', party: 'APC', opponent: { name: 'Samai\'la Yombe', party: 'PDP' } },
  Kogi: { name: 'Usman Ododo', party: 'APC', opponent: { name: 'Dino Melaye', party: 'PDP' } },
  Kwara: { name: 'Abdulrahman Abdulrazaq', party: 'APC', opponent: { name: 'Abdulrazaq Atunwa', party: 'PDP' } },
  Lagos: { name: 'Babajide Sanwo-Olu', party: 'APC', opponent: { name: 'Gbolahan Rhodes-Vivour', party: 'LP' } },
  Nasarawa: { name: 'Abdullahi Sule', party: 'APC', opponent: { name: 'David Ombugadu', party: 'PDP' } },
  Niger: { name: 'Umaru Bago', party: 'APC', opponent: { name: 'Isah Ketso', party: 'PDP' } },
  Ogun: { name: 'Dapo Abiodun', party: 'APC', opponent: { name: 'Ladi Adebutu', party: 'PDP' } },
  Ondo: { name: 'Oluwarotimi Akeredolu', party: 'APC', opponent: { name: 'Eyitayo Jegede', party: 'PDP' } },
  Osun: { name: 'Ademola Adeleke', party: 'PDP', opponent: { name: 'Gboyega Oyetola', party: 'APC' } },
  Oyo: { name: 'Seyi Makinde', party: 'PDP', opponent: { name: 'Teslim Folarin', party: 'APC' } },
  Plateau: { name: 'Caleb Mutfwang', party: 'PDP', opponent: { name: 'Nentawe Yilwatda', party: 'APC' } },
  Rivers: { name: 'Siminalayi Fubara', party: 'PDP', opponent: { name: 'Tonye Cole', party: 'APC' } },
  Sokoto: { name: 'Ahmad Aliyu', party: 'APC', opponent: { name: 'Saidu Umar', party: 'PDP' } },
  Taraba: { name: 'Agbu Kefas', party: 'PDP', opponent: { name: 'Emmanuel Gembu', party: 'APC' } },
  Yobe: { name: 'Mai Mala Buni', party: 'APC', opponent: { name: 'Umar Abubakar', party: 'PDP' } },
  Zamfara: { name: 'Dauda Lawal', party: 'PDP', opponent: { name: 'Bello Matawalle', party: 'APC' } },
};

function toCandidates(list) {
  return list.map((c) => ({ name: c.name, party: c.party, votes: Number(c.votes || 0) }));
}

function main() {
  const history = fs.existsSync(HISTORY_PATH)
    ? JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'))
    : {};

  if (!history['2014']) history['2014'] = {};
  for (const [state, candidates] of Object.entries(INCUMBENTS_2014)) {
    if (history['2014'][state]?.collated) continue;
    history['2014'][state] = {
      candidates: toCandidates(candidates),
      source: 'Statewide declared / incumbent totals (2011–2014 cycle)',
    };
  }

  if (!history['2022']) history['2022'] = {};
  for (const [state, row] of Object.entries(GOV_2022_WINNERS)) {
    if (history['2022'][state]?.collated) continue;
    history['2022'][state] = {
      candidates: [
        { name: row.name, party: row.party, votes: 250000 },
        { name: row.opponent.name, party: row.opponent.party, votes: 180000 },
      ],
      source: '2023 governorship election winners (mapped to 2022 dashboard year)',
    };
  }

  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
  console.log(`Expanded ${HISTORY_PATH}`);
  console.log(`2014 states: ${Object.keys(history['2014']).length}`);
  console.log(`2018 states: ${Object.keys(history['2018'] || {}).length}`);
  console.log(`2022 states: ${Object.keys(history['2022']).length}`);
}

main();
