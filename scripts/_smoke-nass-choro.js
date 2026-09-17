'use strict';
/** Quick smoke test for Senate/House/Assembly choropleth packs. */
const { loadNassChoropleth } = require('../election-results-data');

const sen = loadNassChoropleth('sen', '2023', null);
const lagos = loadNassChoropleth('sen', '2023', 'Lagos');
const house = loadNassChoropleth('reps', '2023', null);
const assembly = loadNassChoropleth('assembly', '2023', null);

console.log(
  JSON.stringify(
    {
      sen: {
        ok: sen.ok,
        level: sen.level,
        seatTotal: sen.seatTotal,
        states: Object.keys(sen.units || {}).length,
        lagosParty: sen.units?.Lagos?.party,
        lagosSeats: sen.units?.Lagos?.seatCount,
      },
      senLagos: {
        ok: lagos.ok,
        level: lagos.level,
        districts: Object.keys(lagos.units || {}),
        seatTotal: lagos.seatTotal,
      },
      house: { ok: house.ok, seatTotal: house.seatTotal, states: Object.keys(house.units || {}).length },
      assembly: { ok: assembly.ok, message: assembly.message },
    },
    null,
    2
  )
);
