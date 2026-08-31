/**
 * Dashboard year 2018 — INEC-declared results from the 2016–2019 governorship cycle.
 * Sources: INEC, Wikipedia state election pages, Channels TV, Punch, Daily Trust.
 */
const { entry } = require('./governorship-statewide-meta');

module.exports = {
  Abia: entry(
    [
      { name: 'Okezie Ikpeazu', party: 'PDP', votes: 261127 },
      { name: 'Uchechukwu Sampson Ogah', party: 'APC', votes: 99574 },
      { name: 'Alex Otti', party: 'APGA', votes: 64366 },
    ],
    'INEC declared results, March 2019 — INEC / Wikipedia',
    '2019-03-09',
  ),
  Adamawa: entry(
    [
      { name: 'Ahmadu Umaru Fintiri', party: 'PDP', votes: 376552 },
      { name: 'Bindo Jibrilla', party: 'APC', votes: 336386 },
      { name: 'Abdul-Aziz Nyako', party: 'ADC', votes: 113237 },
    ],
    'INEC declared results (incl. supplementary), March 2019 — Daily Trust',
    '2019-03-09',
  ),
  'Akwa Ibom': entry(
    [
      { name: 'Udom Emmanuel', party: 'PDP', votes: 519712 },
      { name: 'Nsima Ekere', party: 'APC', votes: 171978 },
    ],
    'INEC declared results, March 2019 — Channels TV',
    '2019-03-09',
  ),
  Anambra: entry(
    [
      { name: 'Willie Obiano', party: 'APGA', votes: 234071 },
      { name: 'Tony Nwoye', party: 'APC', votes: 98752 },
      { name: 'Oseloka Obaze', party: 'PDP', votes: 70293 },
    ],
    'INEC declared results, November 2017 — Punch / Guardian',
    '2017-11-18',
  ),
  Bauchi: entry(
    [
      { name: 'Bala Mohammed', party: 'PDP', votes: 515113 },
      { name: 'Mohammed Abdullahi Abubakar', party: 'APC', votes: 500625 },
    ],
    'INEC declared results (incl. supplementary), March 2019 — Daily Trust',
    '2019-03-09',
  ),
  Bayelsa: entry(
    [
      { name: 'David Lyon', party: 'APC', votes: 352552 },
      { name: 'Douye Diri', party: 'PDP', votes: 143172 },
    ],
    'INEC declared results, November 2019 — THISDAYLIVE',
    '2019-11-16',
  ),
  Benue: entry(
    [
      { name: 'Samuel Ortom', party: 'PDP', votes: 434473 },
      { name: 'Emmanuel Jime', party: 'APC', votes: 345155 },
    ],
    'INEC declared results (incl. supplementary), March 2019 — THISDAYLIVE',
    '2019-03-09',
  ),
  Borno: entry(
    [
      { name: 'Babagana Umara Zulum', party: 'APC', votes: 1175440 },
      { name: 'Mohammad Imam', party: 'PDP', votes: 66115 },
    ],
    'INEC declared results, March 2019 — Premium Times',
    '2019-03-09',
  ),
  'Cross River': entry(
    [
      { name: 'Ben Ayade', party: 'PDP', votes: 381484 },
      { name: 'John Owan Enoh', party: 'APC', votes: 131161 },
    ],
    'INEC declared results, March 2019 — INEC',
    '2019-03-09',
  ),
  Delta: entry(
    [
      { name: 'Ifeanyi Okowa', party: 'PDP', votes: 925274 },
      { name: 'Great Ogboru', party: 'APC', votes: 215938 },
    ],
    'INEC declared results, March 2019 — INEC',
    '2019-03-09',
  ),
  Ebonyi: entry(
    [
      { name: 'Dave Umahi', party: 'PDP', votes: 393043 },
      { name: 'Sonni Ogbuoji', party: 'APC', votes: 81703 },
    ],
    'INEC declared results, March 2019 — Independent Newspapers',
    '2019-03-09',
  ),
  Edo: entry(
    [
      { name: 'Godwin Obaseki', party: 'APC', votes: 319483 },
      { name: 'Osagie Ize-Iyamu', party: 'PDP', votes: 253173 },
    ],
    'INEC declared results, September 2016 — INEC',
    '2016-09-28',
  ),
  Ekiti: entry(
    [
      { name: 'Kayode Fayemi', party: 'APC', votes: 197459 },
      { name: 'Kolapo Olushola', party: 'PDP', votes: 178121 },
      { name: 'Opeyemi Bamidele', party: 'LP', votes: 9205 },
    ],
    'INEC LGA collation centres — Tribune Online / Vanguard, July 2018',
    '2018-07-14',
  ),
  Enugu: entry(
    [
      { name: 'Ifeanyi Ugwuanyi', party: 'PDP', votes: 449935 },
      { name: 'Ayogu Eze', party: 'APC', votes: 10423 },
      { name: 'Nwankpa Emmanuel Benedict', party: 'APGA', votes: 2547 },
    ],
    'INEC declared results, March 2019 — INEC / Wikipedia',
    '2019-03-09',
  ),
  Gombe: entry(
    [
      { name: 'Muhammad Inuwa Yahaya', party: 'APC', votes: 364179 },
      { name: 'Usman Bayero Nafada', party: 'PDP', votes: 222868 },
    ],
    'INEC declared results, March 2019 — Punch / INEC',
    '2019-03-09',
  ),
  Imo: entry(
    [
      { name: 'Emeka Ihedioha', party: 'PDP', votes: 273404 },
      { name: 'Uche Nwosu', party: 'AA', votes: 190364 },
      { name: 'Ifeanyi Ararume', party: 'APGA', votes: 114676 },
    ],
    'INEC declared results, March 2019 — Punch',
    '2019-03-09',
  ),
  Jigawa: entry(
    [
      { name: 'Mohammed Badaru Abubakar', party: 'APC', votes: 810933 },
      { name: 'Aminu Ibrahim Ringim', party: 'PDP', votes: 288356 },
    ],
    'INEC declared results, March 2019 — Daily Post',
    '2019-03-09',
  ),
  Kaduna: entry(
    [
      { name: 'Nasir Ahmad el-Rufai', party: 'APC', votes: 1045427 },
      { name: 'Isah Ashiru', party: 'PDP', votes: 814168 },
      { name: 'Haruna Saeed', party: 'SDP', votes: 9828 },
    ],
    'INEC declared results, March 2019 — Daily Trust / Guardian',
    '2019-03-09',
  ),
  Kano: entry(
    [
      { name: 'Abdullahi Ganduje', party: 'APC', votes: 1033695 },
      { name: 'Abba Kabir Yusuf', party: 'PDP', votes: 1024713 },
    ],
    'INEC declared results (incl. supplementary), March 2019 — Punch',
    '2019-03-09',
  ),
  Katsina: entry(
    [
      { name: 'Aminu Bello Masari', party: 'APC', votes: 1178864 },
      { name: 'Garba Yakubu Lado', party: 'PDP', votes: 488621 },
    ],
    'INEC declared results, March 2019 — Daily Trust',
    '2019-03-09',
  ),
  Kebbi: entry(
    [
      { name: 'Abubakar Atiku Bagudu', party: 'APC', votes: 673717 },
      { name: 'Isa Mohammed Galaudu', party: 'PDP', votes: 106633 },
    ],
    'INEC declared results, March 2019 — Daily Post',
    '2019-03-09',
  ),
  Kogi: entry(
    [
      { name: 'Yahaya Bello', party: 'APC', votes: 406222 },
      { name: 'Musa Wada', party: 'PDP', votes: 189704 },
    ],
    'INEC declared results, November 2019 — Vanguard',
    '2019-11-16',
  ),
  Kwara: entry(
    [
      { name: 'Abdulrahman Abdulrazaq', party: 'APC', votes: 331546 },
      { name: 'Razak Atunwa', party: 'PDP', votes: 114754 },
    ],
    'INEC declared results, March 2019 — INEC',
    '2019-03-09',
  ),
  Lagos: entry(
    [
      { name: 'Babajide Sanwo-Olu', party: 'APC', votes: 739445 },
      { name: 'Jimi Agbaje', party: 'PDP', votes: 206141 },
    ],
    'INEC declared results, March 2019 — Punch / Guardian',
    '2019-03-09',
  ),
  Nasarawa: entry(
    [
      { name: 'Abdullahi Sule', party: 'APC', votes: 327229 },
      { name: 'David Ombugadu', party: 'PDP', votes: 184281 },
      { name: 'Labaran Maku', party: 'APGA', votes: 132784 },
    ],
    'INEC declared results, March 2019 — INEC',
    '2019-03-09',
  ),
  Niger: entry(
    [
      { name: 'Abubakar Sani Bello', party: 'APC', votes: 526412 },
      { name: 'Umar Nasko', party: 'PDP', votes: 298065 },
    ],
    'INEC declared results, March 2019 — Ripples Nigeria',
    '2019-03-09',
  ),
  Ogun: entry(
    [
      { name: 'Dapo Abiodun', party: 'APC', votes: 241670 },
      { name: 'Adekunle Akinlade', party: 'APM', votes: 222153 },
      { name: 'Gboyega Nasir Isiaka', party: 'ADC', votes: 110422 },
    ],
    'INEC declared results, March 2019 — Daily Post / INEC',
    '2019-03-09',
  ),
  Ondo: entry(
    [
      { name: 'Oluwarotimi Akeredolu', party: 'APC', votes: 244842 },
      { name: 'Eyitayo Jegede', party: 'PDP', votes: 150380 },
      { name: 'Olusola Oke', party: 'AD', votes: 126889 },
    ],
    'INEC declared results, November 2016 — Channels TV / Punch',
    '2016-11-26',
  ),
  Osun: entry(
    [
      { name: 'Gboyega Oyetola', party: 'APC', votes: 255505 },
      { name: 'Ademola Adeleke', party: 'PDP', votes: 255023 },
      { name: 'Iyiola Omisore', party: 'SDP', votes: 128889 },
    ],
    'INEC declared results (incl. rerun), September 2018 — Punch / Guardian',
    '2018-09-27',
  ),
  Oyo: entry(
    [
      { name: 'Seyi Makinde', party: 'PDP', votes: 515621 },
      { name: 'Adebayo Adelabu', party: 'APC', votes: 357982 },
    ],
    'INEC declared results, March 2019 — INEC',
    '2019-03-09',
  ),
  Plateau: entry(
    [
      { name: 'Simon Lalong', party: 'APC', votes: 595582 },
      { name: 'Jeremiah Useni', party: 'PDP', votes: 546813 },
    ],
    'INEC declared results (incl. supplementary), March 2019 — Punch',
    '2019-03-09',
  ),
  Rivers: entry(
    [
      { name: 'Nyesom Wike', party: 'PDP', votes: 886264 },
      { name: 'Biokpomabo Awara', party: 'AAC', votes: 173859 },
    ],
    'INEC declared results, April 2019 — Channels TV / Punch',
    '2019-04-03',
  ),
  Sokoto: entry(
    [
      { name: 'Aminu Tambuwal', party: 'PDP', votes: 512002 },
      { name: 'Ahmad Aliyu', party: 'APC', votes: 511660 },
    ],
    'INEC declared results (incl. supplementary), March 2019 — Punch / Vanguard',
    '2019-03-09',
  ),
  Taraba: entry(
    [
      { name: 'Darius Ishaku', party: 'PDP', votes: 520433 },
      { name: 'Sani Abubakar Danladi', party: 'APC', votes: 362735 },
    ],
    'INEC declared results, March 2019 — INEC / Premium Times',
    '2019-03-09',
  ),
  Yobe: entry(
    [
      { name: 'Mai Mala Buni', party: 'APC', votes: 444013 },
      { name: 'Umar Iliya Damagum', party: 'PDP', votes: 95703 },
    ],
    'INEC declared results, March 2019 — Daily Trust',
    '2019-03-09',
  ),
  Zamfara: entry(
    [
      { name: 'Bello Matawalle', party: 'PDP', votes: 189452 },
      { name: 'Mukhtar Shehu Idris', party: 'APC', votes: 534541 },
    ],
    'INEC declared results, May 2019 — Channels TV / INEC',
    '2019-03-09',
  ),
};
