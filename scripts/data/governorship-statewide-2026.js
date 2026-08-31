/**
 * Dashboard year 2026 — election that installed the incumbent governor as of 2026.
 * Mostly 2022–2023 cycle; off-cycle states use their latest declared result.
 */
const Y2022 = require('./governorship-statewide-2022');
const { entry } = require('./governorship-statewide-meta');

module.exports = {
  ...Y2022,
  Edo: entry(
    [
      { name: 'Monday Okpebholo', party: 'APC', votes: 291667 },
      { name: 'Asue Ighodalo', party: 'PDP', votes: 247274 },
      { name: 'Olumide Akpata', party: 'LP', votes: 22763 },
    ],
    'INEC declared results, September 2024 — Channels TV / Vanguard',
    '2024-09-22',
  ),
};
