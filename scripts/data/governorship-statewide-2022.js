/**
 * Dashboard year 2022 — INEC-declared results from the 2022–2023 governorship cycle.
 * Sources: THISDAYLIVE, BBC Pidgin, Channels TV, Punch, NAN (March & November 2023).
 */
const { entry } = require('./governorship-statewide-meta');

const SRC_MAR2023 = 'INEC declared results, March 2023 — THISDAYLIVE / BBC Pidgin';
const SRC_NOV2023 = 'INEC declared results, November 2023 — Daily Trust / Punch';

module.exports = {
  Abia: entry(
    [
      { name: 'Alex Otti', party: 'LP', votes: 175467 },
      { name: 'Okey Ahiwe', party: 'PDP', votes: 88529 },
      { name: 'Ikechi Emenike', party: 'APC', votes: 24091 },
    ],
    SRC_MAR2023,
    '2023-03-22',
  ),
  Adamawa: entry(
    [
      { name: 'Ahmadu Umaru Fintiri', party: 'PDP', votes: 430861 },
      { name: 'Aishatu Dahiru Ahmed', party: 'APC', votes: 398788 },
    ],
    'INEC declared results (incl. supplementary), April 2023 — Channels TV / BBC Pidgin',
    '2023-04-18',
  ),
  'Akwa Ibom': entry(
    [
      { name: 'Umo Eno', party: 'PDP', votes: 354348 },
      { name: 'Bassey Albert Akpan', party: 'YPP', votes: 136262 },
      { name: 'Akan Udofia', party: 'APC', votes: 129602 },
    ],
    SRC_MAR2023,
    '2023-03-20',
  ),
  Anambra: entry(
    [
      { name: 'Charles Soludo', party: 'APGA', votes: 112229 },
      { name: 'Valentine Ozigbo', party: 'PDP', votes: 53807 },
      { name: 'Andy Uba', party: 'APC', votes: 43285 },
    ],
    'INEC declared results, November 2021 — THISDAYLIVE / Guardian',
    '2021-11-10',
  ),
  Bauchi: entry(
    [
      { name: 'Bala Mohammed', party: 'PDP', votes: 525280 },
      { name: 'Sadique Abubakar', party: 'APC', votes: 432275 },
      { name: 'Halliru Dauda Jika', party: 'NNPP', votes: 60496 },
    ],
    SRC_MAR2023,
    '2023-03-20',
  ),
  Bayelsa: entry(
    [
      { name: 'Douye Diri', party: 'PDP', votes: 175196 },
      { name: 'Timipre Sylva', party: 'APC', votes: 110108 },
      { name: 'Udengs Eradiri', party: 'LP', votes: 905 },
    ],
    SRC_NOV2023,
    '2023-11-13',
  ),
  Benue: entry(
    [
      { name: 'Hyacinth Alia', party: 'APC', votes: 473933 },
      { name: 'Titus Uba', party: 'PDP', votes: 223913 },
    ],
    SRC_MAR2023,
    '2023-03-20',
  ),
  Borno: entry(
    [
      { name: 'Babagana Umara Zulum', party: 'APC', votes: 545542 },
      { name: 'Mohammed Ali Jajari', party: 'PDP', votes: 82147 },
    ],
    SRC_MAR2023,
    '2023-03-20',
  ),
  'Cross River': entry(
    [
      { name: 'Bassey Otu', party: 'APC', votes: 258619 },
      { name: 'Sandy Onor', party: 'PDP', votes: 179636 },
      { name: 'Patrick Dakum', party: 'LP', votes: 5957 },
    ],
    SRC_MAR2023,
    '2023-03-20',
  ),
  Delta: entry(
    [
      { name: 'Sheriff Oborevwori', party: 'PDP', votes: 350234 },
      { name: 'Ovie Omo-Agege', party: 'APC', votes: 240229 },
      { name: 'Ken Pela', party: 'LP', votes: 48027 },
    ],
    SRC_MAR2023,
    '2023-03-20',
  ),
  Ebonyi: entry(
    [
      { name: 'Francis Nwifuru', party: 'APC', votes: 199131 },
      { name: 'Ifeanyichukwu Odii', party: 'PDP', votes: 80191 },
    ],
    SRC_MAR2023,
    '2023-03-20',
  ),
  Edo: entry(
    [
      { name: 'Godwin Obaseki', party: 'PDP', votes: 307955 },
      { name: 'Osagie Ize-Iyamu', party: 'APC', votes: 223619 },
    ],
    'INEC declared results, September 2020 — INEC / Channels TV',
    '2020-09-20',
  ),
  Ekiti: entry(
    [
      { name: 'Biodun Oyebanji', party: 'APC', votes: 187057 },
      { name: 'Segun Oni', party: 'SDP', votes: 82211 },
      { name: 'Bisi Kolawole', party: 'PDP', votes: 67457 },
    ],
    'INEC LGA collation centres — Wikipedia / The Eagle Online, June 2022',
    '2022-06-18',
  ),
  Enugu: entry(
    [
      { name: 'Peter Mbah', party: 'PDP', votes: 160895 },
      { name: 'Chijioke Edeoga', party: 'LP', votes: 157552 },
      { name: 'Uche Nnaji', party: 'APC', votes: 14575 },
    ],
    SRC_MAR2023,
    '2023-03-20',
  ),
  Gombe: entry(
    [
      { name: 'Muhammad Inuwa Yahaya', party: 'APC', votes: 342821 },
      { name: 'Mu\'azu Kumo', party: 'PDP', votes: 233131 },
    ],
    SRC_MAR2023,
    '2023-03-20',
  ),
  Imo: entry(
    [
      { name: 'Hope Uzodimma', party: 'APC', votes: 540308 },
      { name: 'Samuel Anyanwu', party: 'PDP', votes: 71503 },
      { name: 'Athan Achonu', party: 'LP', votes: 64081 },
    ],
    SRC_NOV2023,
    '2023-11-12',
  ),
  Jigawa: entry(
    [
      { name: 'Umar Namadi', party: 'APC', votes: 618449 },
      { name: 'Mustapha Lamido', party: 'PDP', votes: 368726 },
      { name: 'Aminu Ibrahim Ringim', party: 'NNPP', votes: 37156 },
    ],
    SRC_MAR2023,
    '2023-03-20',
  ),
  Kaduna: entry(
    [
      { name: 'Uba Sani', party: 'APC', votes: 730002 },
      { name: 'Isah Ashiru', party: 'PDP', votes: 719196 },
      { name: 'Jonathan Asake', party: 'LP', votes: 58283 },
    ],
    SRC_MAR2023,
    '2023-03-20',
  ),
  Kano: entry(
    [
      { name: 'Abba Kabir Yusuf', party: 'NNPP', votes: 1019602 },
      { name: 'Nasir Yusuf Gawuna', party: 'APC', votes: 890705 },
      { name: 'Sadiq Wali', party: 'PDP', votes: 15957 },
    ],
    SRC_MAR2023,
    '2023-03-20',
  ),
  Katsina: entry(
    [
      { name: 'Dikko Umaru Radda', party: 'APC', votes: 859892 },
      { name: 'Garba Yakubu Lado', party: 'PDP', votes: 486620 },
    ],
    SRC_MAR2023,
    '2023-03-20',
  ),
  Kebbi: entry(
    [
      { name: 'Nasir Idris', party: 'APC', votes: 409225 },
      { name: 'Samai\'la Yombe', party: 'PDP', votes: 360940 },
    ],
    SRC_MAR2023,
    '2023-03-20',
  ),
  Kogi: entry(
    [
      { name: 'Usman Ododo', party: 'APC', votes: 446237 },
      { name: 'Murtala Ajaka', party: 'SDP', votes: 259052 },
      { name: 'Dino Melaye', party: 'PDP', votes: 46362 },
    ],
    SRC_NOV2023,
    '2023-11-12',
  ),
  Kwara: entry(
    [
      { name: 'Abdulrahman Abdulrazaq', party: 'APC', votes: 273424 },
      { name: 'Shuaib Abdullahi Yaman', party: 'PDP', votes: 155490 },
    ],
    SRC_MAR2023,
    '2023-03-20',
  ),
  Lagos: entry(
    [
      { name: 'Babajide Sanwo-Olu', party: 'APC', votes: 762134 },
      { name: 'Gbadebo Rhodes-Vivour', party: 'LP', votes: 312329 },
      { name: 'Abdul-Azeez Olajide Adediran', party: 'PDP', votes: 62449 },
    ],
    SRC_MAR2023,
    '2023-03-20',
  ),
  Nasarawa: entry(
    [
      { name: 'Abdullahi Sule', party: 'APC', votes: 347209 },
      { name: 'David Ombugadu', party: 'PDP', votes: 283016 },
    ],
    SRC_MAR2023,
    '2023-03-20',
  ),
  Niger: entry(
    [
      { name: 'Mohammed Umar Bago', party: 'APC', votes: 469896 },
      { name: 'Isah Liman Kantigi', party: 'PDP', votes: 387476 },
    ],
    SRC_MAR2023,
    '2023-03-20',
  ),
  Ogun: entry(
    [
      { name: 'Dapo Abiodun', party: 'APC', votes: 276298 },
      { name: 'Oladipupo Adebutu', party: 'PDP', votes: 262383 },
      { name: 'Olubiyi Otegbeye', party: 'ADC', votes: 94754 },
    ],
    SRC_MAR2023,
    '2023-03-20',
  ),
  Ondo: entry(
    [
      { name: 'Oluwarotimi Akeredolu', party: 'APC', votes: 292830 },
      { name: 'Eyitayo Jegede', party: 'PDP', votes: 195791 },
      { name: 'Agboola Ajayi', party: 'ZLP', votes: 68833 },
    ],
    'INEC declared results, October 2020 — Channels TV / Punch',
    '2020-10-11',
  ),
  Osun: entry(
    [
      { name: 'Ademola Adeleke', party: 'PDP', votes: 403371 },
      { name: 'Gboyega Oyetola', party: 'APC', votes: 375027 },
    ],
    'INEC declared results, July 2022 — Punch / Guardian / Channels TV',
    '2022-07-17',
  ),
  Oyo: entry(
    [
      { name: 'Seyi Makinde', party: 'PDP', votes: 563756 },
      { name: 'Teslim Folarin', party: 'APC', votes: 256685 },
    ],
    SRC_MAR2023,
    '2023-03-20',
  ),
  Plateau: entry(
    [
      { name: 'Caleb Mutfwang', party: 'PDP', votes: 525299 },
      { name: 'Nentanwe Yilwatda', party: 'APC', votes: 481370 },
      { name: 'Patrick Dakum', party: 'LP', votes: 60310 },
    ],
    SRC_MAR2023,
    '2023-03-20',
  ),
  Rivers: entry(
    [
      { name: 'Siminalayi Fubara', party: 'PDP', votes: 302614 },
      { name: 'Tonye Cole', party: 'APC', votes: 95274 },
      { name: 'Magnus Abe', party: 'SDP', votes: 22224 },
    ],
    SRC_MAR2023,
    '2023-03-20',
  ),
  Sokoto: entry(
    [
      { name: 'Ahmad Aliyu', party: 'APC', votes: 453661 },
      { name: 'Saidu Umar', party: 'PDP', votes: 404632 },
    ],
    SRC_MAR2023,
    '2023-03-20',
  ),
  Taraba: entry(
    [
      { name: 'Agbu Kefas', party: 'PDP', votes: 257926 },
      { name: 'Emmanuel Bwacha', party: 'APC', votes: 202278 },
    ],
    SRC_MAR2023,
    '2023-03-20',
  ),
  Yobe: entry(
    [
      { name: 'Mai Mala Buni', party: 'APC', votes: 317113 },
      { name: 'Sharif Abdullahi', party: 'PDP', votes: 124259 },
    ],
    SRC_MAR2023,
    '2023-03-20',
  ),
  Zamfara: entry(
    [
      { name: 'Dauda Lawal', party: 'PDP', votes: 377726 },
      { name: 'Bello Matawalle', party: 'APC', votes: 311976 },
    ],
    SRC_MAR2023,
    '2023-03-20',
  ),
};
