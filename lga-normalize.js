const LGA_ALIASES = {
  shomolu: 'Somolu',
  somolu: 'Somolu',
  amuwoodofin: 'Amuwo-Odofin',
  ibejulekki: 'Ibeju/Lekki',
  ifakoijaye: 'Ifako-Ijaye',
  oturkpo: 'Otukpo',
  calabarmunicipal: 'Calabar Municipality',
  oorelope: 'Oorelope',
  orelope: 'Oorelope',
  dambatta: 'Danbata',
  dawakinkudu: 'Dawaki Kudu',
  dawakintofa: 'Dawaki Tofa',
  nassarawa: 'Nasarawa',
  abuaodual: 'Abua-Odual',
  emuoha: 'Emohua',
  ogubolo: 'Ogu/Bolo',
  omumma: 'Omuma',
  opobonkoro: 'Opobo/Nekoro',
  ogbomoshonorth: 'Ogbomoso North',
  ogbomoshosouth: 'Ogbomoso South',
  atakunmosaeast: 'Atakumosa East',
  atakunmosawest: 'Atakumosa West',
  ayedade: 'Ayedaade',
  aiyedaade: 'Ayedaade',
  aiyedire: 'Ayedire',
  oriade: 'Oriade',
  orade: 'Oriade',
  olaoluwa: 'Ola-Oluwa',
  odootin: 'Odo-Otin',
  ilesaeast: 'Ilesa East',
  ileshawest: 'Ilesa West',
  ilesawest: 'Ilesa West',
  ikpobaokha: 'Ikpoba/Okha',
  ileolujiokeigbo: 'Ileoluji/Okeigbo',
  ihiala: 'Ihala',
  ihala: 'Ihala',
  onitshanorth: 'Onitsha-North',
  onitshasouth: 'Onitsha -South',
  idemilisouth: 'Idemili-South',
  kotonkarfe: 'Kogi . K. K.',
  kotonkarfi: 'Kogi . K. K.',
  mopamuro: 'Mopa Moro',
  ogorimagongo: 'Ogori Mangogo',
  ogorimangogo: 'Ogori Mangogo',
  igalamelaodolu: 'Igalamela/Odolu',
  adoekiti: 'Ado Ekiti',
  ekitisouthwest: 'Ekiti South West',
  idoosi: 'Ido/Osi',
  irepodunifelodun: 'Irepodun/Ifelodun',
  iseorun: 'Ise/Orun',
  efon: 'Efon',
  efun: 'Efon',
  ayekire: 'Gbonyin',
  gbonyin: 'Gbonyin',
  maiduguri: 'Maiduguri M. C.',
  maidugurimc: 'Maiduguri M. C.',
  uhunmwonde: 'Uhunmwode',
  uhunmwode: 'Uhunmwode',
  kirikasama: 'Kirika Samma',
  kirikasamma: 'Kirika Samma',
  bagudu: 'Bagudo',
  nasarawaegon: 'Nasarawa Eggon',
  damban: 'Dambam',
  dambam: 'Dambam',
  birninmagaji: 'Birnin Magaji',
  birninmagajikiyaw: 'Birnin Magaji',
  pategi: 'Patigi',
  okeero: 'Okeero',
  yalmaltudeba: 'Yalmaltu/ Deba',
  yamaltudeba: 'Yalmaltu/ Deba',
  suletankarkar: 'Sule-Tankarkar',
  sabonbirni: 'S/Birni',
  edati: 'Edatti',
  ardokola: 'Ardokola',
  urueoffongoruko: 'Urue Offong/Oruko',
  jamaare: "Jama'are",
  ilorinsouth: 'Ilorin-South',
  ilorinwest: 'Ilorin-West',
  ilorineast: 'Ilorin East',
  malumfashi: 'Malufashi',
  malufashi: 'Malufashi',
  maiadua: "Mai'adua",
  girei: 'Gire 1',
  gire1: 'Gire 1',
  mayobelwa: 'Mayobelwa',
};

function normalizeKey(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9/]+/gi, ' ')
    .trim()
    .toLowerCase();
}

function matchKey(value) {
  return normalizeKey(value).replace(/[^a-z0-9]+/gi, '');
}

function canonicalLga(name) {
  const key = matchKey(name);
  if (LGA_ALIASES[key]) return LGA_ALIASES[key];
  return String(name || '').trim();
}

function buildLgaUnitLookup(units) {
  const lookup = {};
  Object.entries(units || {}).forEach(([name, row]) => {
    const canonical = canonicalLga(name);
    const payload = { ...row, _key: canonical };
    lookup[canonical] = payload;
    lookup[matchKey(canonical)] = payload;
    lookup[normalizeKey(canonical)] = payload;
    lookup[matchKey(name)] = payload;
  });
  return lookup;
}

function resolveLgaUnit(units, name) {
  if (!units || !name) return null;
  const canonical = canonicalLga(name);
  return units[canonical]
    || units[matchKey(canonical)]
    || units[normalizeKey(canonical)]
    || units[matchKey(name)]
    || null;
}

module.exports = {
  LGA_ALIASES,
  normalizeKey,
  matchKey,
  canonicalLga,
  buildLgaUnitLookup,
  resolveLgaUnit,
};
