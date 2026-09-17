/**
 * Build presidential-2023-lga.json + check from agent-tools dump WITHOUT spawning
 * a nested node process (parent shell harness is wedged).
 * Intended to be `eval`/`Function`-run only if a JS host becomes available.
 * Prefer: node scripts/_offline-write-pres-lga.js when shell works.
 */
module.exports = { note: 'see _offline-write-pres-lga.js' };
