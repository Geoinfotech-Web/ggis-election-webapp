const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '_wiki_raw');

function extract(code) {
  const html = fs.readFileSync(path.join(DIR, `stears-${code}.html`), 'utf8');
  const marker = 'id="__NEXT_DATA__"';
  const i = html.indexOf(marker);
  if (i < 0) {
    console.log(code, 'no NEXT_DATA');
    return;
  }
  const start = html.indexOf('>', i) + 1;
  const end = html.indexOf('</script>', start);
  const data = JSON.parse(html.slice(start, end));
  fs.writeFileSync(path.join(DIR, `stears-${code}-next.json`), JSON.stringify(data, null, 2));
  const pp = data.props && data.props.pageProps;
  console.log('\n===', code, 'pageProps keys:', Object.keys(pp || {}));

  function walk(o, p, depth) {
    if (depth > 10 || !o || typeof o !== 'object') return;
    if (Array.isArray(o)) {
      if (o.length && o[0] && typeof o[0] === 'object') {
        const k = Object.keys(o[0]);
        const interesting =
          k.some((x) => /name|lga|vote|candidate|party|slug|result/i.test(x));
        if (interesting && o.length >= 3 && o.length <= 80) {
          console.log(code, 'array@', p, 'len', o.length, 'keys', k.join(','));
          console.log(JSON.stringify(o[0], null, 2).slice(0, 600));
        }
      }
      o.forEach((x, idx) => walk(x, `${p}[${idx}]`, depth + 1));
    } else {
      for (const [k, v] of Object.entries(o)) walk(v, `${p}.${k}`, depth + 1);
    }
  }
  walk(pp, 'pageProps', 0);
}

['AD', 'BO', 'EB', 'YO', 'KT'].forEach((c) => {
  const f = path.join(DIR, `stears-${c}.html`);
  if (fs.existsSync(f)) extract(c);
  else console.log('missing', c);
});
