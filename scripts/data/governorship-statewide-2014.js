/**
 * Dashboard year 2014 — INEC-declared results from the 2014–2015 governorship cycle.
 * Sources: The Cable, Daily Post, INEC/Wikipedia state election pages.
 */
const { entry } = require('./governorship-statewide-meta');

const SRC_2015 = 'INEC declared results, April 2015 — The Cable / Daily Post Nigeria';

module.exports = {
  Ekiti: entry(
    [
      { name: 'Ayodele Fayose', party: 'PDP', votes: 203090 },
      { name: 'Kayode Fayemi', party: 'APC', votes: 120433 },
      { name: 'Opeyemi Bamidele', party: 'LP', votes: 18135 },
    ],
    'INEC LGA collation centres — The Cable / Vanguard, 21 June 2014',
    '2014-06-21',
  ),
  Osun: entry(
    [
      { name: 'Rauf Aregbesola', party: 'APC', votes: 394684 },
      { name: 'Olusola Adeyeye', party: 'PDP', votes: 304376 },
      { name: 'Iyiola Omisore', party: 'SDP', votes: 128889 },
    ],
    'INEC declared results, August 2014 — Punch / Guardian',
    '2014-08-09',
  ),
  Abia: entry(
    [
      { name: 'Okezie Ikpeazu', party: 'PDP', votes: 264713 },
      { name: 'Alex Otti', party: 'APGA', votes: 180882 },
    ],
    SRC_2015,
    '2015-04-11',
  ),
  Adamawa: entry(
    [
      { name: 'Mohammed Umar Jibrilla', party: 'APC', votes: 362329 },
      { name: 'Bindo Umaru Jibrilla', party: 'PDP', votes: 327476 },
    ],
    SRC_2015,
    '2015-04-11',
  ),
  'Akwa Ibom': entry(
    [
      { name: 'Udom Emmanuel', party: 'PDP', votes: 470075 },
      { name: 'Bassey Albert', party: 'APC', votes: 248120 },
    ],
    SRC_2015,
    '2015-04-11',
  ),
  Anambra: entry(
    [
      { name: 'Willie Obiano', party: 'APGA', votes: 234071 },
      { name: 'Chris Ngige', party: 'APC', votes: 175061 },
    ],
    'INEC declared results, November 2013 — INEC / Wikipedia',
    '2013-11-16',
  ),
  Bauchi: entry(
    [
      { name: 'Mohammed Abubakar', party: 'APC', votes: 533239 },
      { name: 'Isa Yuguda', party: 'PDP', votes: 466302 },
    ],
    SRC_2015,
    '2015-04-11',
  ),
  Bayelsa: entry(
    [
      { name: 'Seriake Dickson', party: 'PDP', votes: 271923 },
      { name: 'Timipre Sylva', party: 'APC', votes: 248096 },
    ],
    'INEC declared results, December 2015 — Premium Times',
    '2015-12-05',
  ),
  Benue: entry(
    [
      { name: 'Samuel Ortom', party: 'APC', votes: 422582 },
      { name: 'Gabriel Suswam', party: 'PDP', votes: 313867 },
    ],
    SRC_2015,
    '2015-04-11',
  ),
  Borno: entry(
    [
      { name: 'Kashim Shettima', party: 'APC', votes: 480146 },
      { name: 'Gambo Lawan', party: 'PDP', votes: 128018 },
    ],
    SRC_2015,
    '2015-04-11',
  ),
  'Cross River': entry(
    [
      { name: 'Ben Ayade', party: 'PDP', votes: 342016 },
      { name: 'Bassey Otu', party: 'APC', votes: 118111 },
    ],
    SRC_2015,
    '2015-04-11',
  ),
  Delta: entry(
    [
      { name: 'Ifeanyi Okowa', party: 'PDP', votes: 724680 },
      { name: 'Great Ogboru', party: 'LP', votes: 130028 },
      { name: 'Oghenetega Emerhor', party: 'APC', votes: 67825 },
    ],
    SRC_2015,
    '2015-04-11',
  ),
  Ebonyi: entry(
    [
      { name: 'Dave Umahi', party: 'PDP', votes: 289867 },
      { name: 'Edward Nkwegu', party: 'LP', votes: 124817 },
      { name: 'Julius Ucha', party: 'APC', votes: 27583 },
    ],
    SRC_2015,
    '2015-04-11',
  ),
  Edo: entry(
    [
      { name: 'Adams Oshiomhole', party: 'APC', votes: 319986 },
      { name: 'Osagie Ize-Iyamu', party: 'PDP', votes: 253369 },
    ],
    'INEC declared results, September 2016 — INEC',
    '2016-09-28',
  ),
  Enugu: entry(
    [
      { name: 'Ifeanyi Ugwuanyi', party: 'PDP', votes: 482277 },
      { name: 'Okey Ezea', party: 'APC', votes: 43839 },
    ],
    SRC_2015,
    '2015-04-11',
  ),
  Gombe: entry(
    [
      { name: 'Ibrahim Dankwambo', party: 'PDP', votes: 361245 },
      { name: 'Inuwa Yahaya', party: 'APC', votes: 334178 },
    ],
    SRC_2015,
    '2015-04-11',
  ),
  Imo: entry(
    [
      { name: 'Rochas Okorocha', party: 'APC', votes: 416996 },
      { name: 'Emeka Ihedioha', party: 'PDP', votes: 320705 },
    ],
    SRC_2015,
    '2015-04-11',
  ),
  Jigawa: entry(
    [
      { name: 'Badaru Abubakar', party: 'APC', votes: 644048 },
      { name: 'Aminu Ibrahim Ringim', party: 'PDP', votes: 462110 },
    ],
    SRC_2015,
    '2015-04-11',
  ),
  Kaduna: entry(
    [
      { name: 'Nasir el-Rufai', party: 'APC', votes: 1117635 },
      { name: 'Mukhtar Ramalan Yero', party: 'PDP', votes: 485833 },
    ],
    SRC_2015,
    '2015-04-11',
  ),
  Kano: entry(
    [
      { name: 'Abdullahi Ganduje', party: 'APC', votes: 870472 },
      { name: 'Salihu Sagir Takai', party: 'PDP', votes: 345395 },
    ],
    SRC_2015,
    '2015-04-11',
  ),
  Katsina: entry(
    [
      { name: 'Aminu Masari', party: 'APC', votes: 943085 },
      { name: 'Musa Nashuni', party: 'PDP', votes: 476768 },
    ],
    SRC_2015,
    '2015-04-11',
  ),
  Kebbi: entry(
    [
      { name: 'Atiku Bagudu', party: 'APC', votes: 477376 },
      { name: 'Sarkin Bello', party: 'PDP', votes: 293443 },
    ],
    SRC_2015,
    '2015-04-11',
  ),
  Kogi: entry(
    [
      { name: 'Yahaya Bello', party: 'APC', votes: 406222 },
      { name: 'Musa Wada', party: 'PDP', votes: 189704 },
    ],
    'INEC declared results, November 2015 — Vanguard',
    '2015-11-21',
  ),
  Kwara: entry(
    [
      { name: 'Abdulfatah Ahmed', party: 'PDP', votes: 306866 },
      { name: 'Lada Musa', party: 'APC', votes: 201424 },
    ],
    SRC_2015,
    '2015-04-11',
  ),
  Lagos: entry(
    [
      { name: 'Akinwunmi Ambode', party: 'APC', votes: 811994 },
      { name: 'Jimi Agbaje', party: 'PDP', votes: 659788 },
    ],
    SRC_2015,
    '2015-04-11',
  ),
  Nasarawa: entry(
    [
      { name: 'Umaru Tanko Al-Makura', party: 'APC', votes: 309746 },
      { name: 'Labaran Maku', party: 'APGA', votes: 178983 },
    ],
    SRC_2015,
    '2015-04-11',
  ),
  Niger: entry(
    [
      { name: 'Abubakar Bello', party: 'APC', votes: 593702 },
      { name: 'Umar Nasko', party: 'PDP', votes: 239772 },
    ],
    SRC_2015,
    '2015-04-11',
  ),
  Ogun: entry(
    [
      { name: 'Ibikunle Amosun', party: 'APC', votes: 306988 },
      { name: 'Gboyega Nasir Isiaka', party: 'PDP', votes: 201440 },
    ],
    SRC_2015,
    '2015-04-11',
  ),
  Ondo: entry(
    [
      { name: 'Olusegun Mimiko', party: 'LP', votes: 367901 },
      { name: 'Olusola Oke', party: 'ACN', votes: 275901 },
    ],
    'INEC declared results, October 2012 — INEC',
    '2012-10-20',
  ),
  Oyo: entry(
    [
      { name: 'Abiola Ajimobi', party: 'APC', votes: 327310 },
      { name: 'Rashidi Ladoja', party: 'Accord', votes: 254520 },
    ],
    SRC_2015,
    '2015-04-11',
  ),
  Plateau: entry(
    [
      { name: 'Simon Lalong', party: 'APC', votes: 537050 },
      { name: 'Gyang Chung', party: 'PDP', votes: 361614 },
    ],
    SRC_2015,
    '2015-04-11',
  ),
  Rivers: entry(
    [
      { name: 'Nyesom Wike', party: 'PDP', votes: 692588 },
      { name: 'Dakuku Peterside', party: 'APC', votes: 106659 },
    ],
    'INEC declared results, April 2015 — Channels TV / Punch',
    '2015-04-11',
  ),
  Sokoto: entry(
    [
      { name: 'Aliyu Wamakko', party: 'APC', votes: 487180 },
      { name: 'Aminu Tambuwal', party: 'PDP', votes: 361604 },
    ],
    SRC_2015,
    '2015-04-11',
  ),
  Taraba: entry(
    [
      { name: 'Darius Ishaku', party: 'PDP', votes: 369651 },
      { name: 'Danbaba Suntai', party: 'PDP', votes: 275621 },
    ],
    'INEC declared results, April 2015 (supplementary) — Premium Times',
    '2015-04-25',
  ),
  Yobe: entry(
    [
      { name: 'Ibrahim Geidam', party: 'APC', votes: 334847 },
      { name: 'Adamu Maina Waziri', party: 'PDP', votes: 179700 },
    ],
    SRC_2015,
    '2015-04-11',
  ),
  Zamfara: entry(
    [
      { name: 'Abdulaziz Yari', party: 'APC', votes: 716964 },
      { name: 'Mahmud Shinkafi', party: 'PDP', votes: 201938 },
    ],
    SRC_2015,
    '2015-04-11',
  ),
};
