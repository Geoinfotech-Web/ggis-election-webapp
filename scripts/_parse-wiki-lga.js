#!/usr/bin/env node
/**
 * Robust LGA extractor for Parsoid Wikipedia HTML.
 */
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '_wiki_raw');

function decode(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNum(s) {
  const t = decode(s);
  if (/tbd|n\/a|not available/i.test(t) && !/\d{2,}/.test(t)) return null;
  // Prefer last number (Parsoid often prefixes RDFa junk)
  const matches = [...t.matchAll(/(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?%?/g)];
  if (!matches.length) return null;
  const last = matches[matches.length - 1];
  const whole = last[1].replace(/,/g, '');
  const frac = last[2] ? `.${last[2]}` : '';
  const n = Number(whole + frac);
  return Number.isFinite(n) ? n : null;
}

function cleanName(s) {
  let t = decode(s);
  // Drop RDFa / template junk prefixes
  const gt = t.lastIndexOf("'}'>");
  if (gt >= 0) t = t.slice(gt + 4);
  const gt2 = t.lastIndexOf("]]}'>");
  if (gt2 >= 0) t = t.slice(gt2 + 5);
  t = t.replace(/\s*\[[^\]]*\]\s*/g, ' ').replace(/\s+/g, ' ').trim();
  // Keep only leading place-name-ish text
  const m = t.match(/^([A-Za-z][A-Za-z0-9 .'/()-]+)/);
  return (m ? m[1] : t).trim().replace(/[.,;:]+$/, '').trim();
}

function partyFromText(h) {
  const u = decode(h).toUpperCase();
  if (/\bAPC\b/.test(u)) return 'APC';
  if (/\bPDP\b/.test(u)) return 'PDP';
  if (/\bNNPP\b/.test(u)) return 'NNPP';
  if (/\bSDP\b/.test(u)) return 'SDP';
  if (/\bAPGA\b/.test(u)) return 'APGA';
  if (/\bADC\b/.test(u)) return 'ADC';
  if (/\bYPP\b/.test(u)) return 'YPP';
  if (/\bPRP\b/.test(u)) return 'PRP';
  if (/\bLP\b/.test(u) || /LABOUR/.test(u)) return 'LP';
  return null;
}

function parseCells(trInner) {
  const cells = [];
  const re = /<(td|th)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(trInner))) cells.push({ text: decode(m[3]), raw: m[3] });
  return cells;
}

function extractAllTr(html) {
  const rows = [];
  const re = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = re.exec(html))) rows.push({ cells: parseCells(m[1]) });
  return rows;
}

function extractLgaBlock(html) {
  const rows = extractAllTr(html);
  let best = null;

  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].cells;
    if (!cells.length || !/^lga$/i.test(cells[0].text)) continue;

    const parties = [];
    for (let c = 1; c < cells.length; c++) {
      const p = partyFromText(cells[c].text);
      if (p) parties.push(p);
    }
    if (parties.length < 2) continue;

    let dataStart = i + 1;
    // skip decorative/subheader rows
    while (dataStart < rows.length) {
      const texts = rows[dataStart].cells.map((x) => x.text);
      const joined = texts.join(' ');
      if (!texts.length || /votes|percentage|^$|#&lt;/i.test(joined) && !/[A-Za-z]{3,}/.test(cleanName(texts[0] || ''))) {
        dataStart += 1;
        continue;
      }
      if (texts.every((c) => /^(votes|percentage|%|)$/i.test(c))) {
        dataStart += 1;
        continue;
      }
      break;
    }

    const lgaRows = [];
    let emptyStreak = 0;
    for (let r = dataStart; r < Math.min(rows.length, dataStart + 80); r++) {
      const rc = rows[r].cells;
      if (!rc.length) {
        emptyStreak += 1;
        if (emptyStreak > 3 && lgaRows.length) break;
        continue;
      }
      emptyStreak = 0;
      const name = cleanName(rc[0].text || rc[0].raw);
      if (!name) continue;
      if (/^totals?$/i.test(name)) break;
      if (/^percentage of the vote/i.test(name)) break;
      if (/no election|cancelled|suspended|not held/i.test(name)) continue;
      if (name.length > 45) continue;
      if (/^(gub\.|sen\.|house|adamawa|bauchi|votes)$/i.test(name)) break;

      const nums = [];
      for (let c = 1; c < rc.length; c++) {
        const n = parseNum(rc[c].raw || rc[c].text);
        if (n != null) nums.push(n);
      }
      // Need at least one votes number per party (pairs may include %)
      if (nums.length < parties.length) continue;
      // Skip pure-TBD rows
      if (nums.every((n) => n <= 100) && nums.length < parties.length * 2) continue;

      const votes = {};
      let ni = 0;
      let ok = true;
      for (const p of parties) {
        if (ni >= nums.length) {
          ok = false;
          break;
        }
        let v = nums[ni++];
        if (ni < nums.length && nums[ni] <= 100) {
          if (v <= 100 && nums[ni] > 150) {
            v = nums[ni++];
            if (ni < nums.length && nums[ni] <= 100) ni++;
          } else {
            ni++;
          }
        }
        // Reject if still looks like a percentage for a major party
        if (v < 200 && parties.length <= 3) {
          // allow small LGAs (Bakassi-style) only if all parties small
        }
        votes[p] = Math.round(v);
      }
      if (!ok || Object.keys(votes).length < 2) continue;
      // Must have at least one party with real vote count
      if (Math.max(...Object.values(votes)) < 50) continue;
      lgaRows.push({ lga: name, votes });
    }

    if (lgaRows.length >= 5 && (!best || lgaRows.length > best.lgaRows.length)) {
      best = { parties, lgaRows };
    }
  }
  return best;
}

function sumVotes(lgaRows) {
  const sums = {};
  for (const r of lgaRows) {
    for (const [p, v] of Object.entries(r.votes)) sums[p] = (sums[p] || 0) + Number(v);
  }
  return sums;
}

const summary = {};
for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.html') && !f.includes('-api'))) {
  const html = fs.readFileSync(path.join(DIR, file), 'utf8');
  const key = file.replace('.html', '');
  const best = extractLgaBlock(html);
  if (!best) {
    console.log(key, 'NO_TABLE');
    summary[key] = null;
    continue;
  }
  const sums = sumVotes(best.lgaRows);
  console.log(key, 'lgas', best.lgaRows.length, 'parties', best.parties.join('+'), 'sums', JSON.stringify(sums));
  console.log(' ', best.lgaRows.map((r) => r.lga).join(' | '));
  fs.writeFileSync(
    path.join(DIR, `${key}-lga.json`),
    JSON.stringify({ parties: best.parties, lgaRows: best.lgaRows, sums }, null, 2),
  );
  summary[key] = { n: best.lgaRows.length, sums, parties: best.parties };
}
fs.writeFileSync(path.join(DIR, '_summary.json'), JSON.stringify(summary, null, 2));
