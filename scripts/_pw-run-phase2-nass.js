async (page) => {
  const { execSync } = require('child_process');
  const fs = require('fs');
  const path = require('path');
  const root = 'C:\\Users\\Geoinfotech\\Documents\\GIS Team\\Election Dashboard';
  const logPath = path.join(root, 'scripts', '_phase2-log.txt');
  const lines = [];
  function run(cmd) {
    lines.push('> ' + cmd);
    try {
      const out = execSync(cmd, {
        cwd: root,
        encoding: 'utf8',
        timeout: 600000,
        maxBuffer: 20 * 1024 * 1024,
      });
      lines.push(out);
      return out;
    } catch (e) {
      const msg = (e.stdout || '') + (e.stderr || '') + String(e);
      lines.push('ERR ' + msg);
      throw e;
    }
  }
  lines.push('node ' + run('node -v').trim());
  run('node scripts/_split-stears-nass-dump.js');
  // Ensure house-2019 is real house data; rebuild from page if needed happens separately
  run('node scripts/_build-stears-nass-votes.js');
  fs.writeFileSync(logPath, lines.join('\n'), 'utf8');
  return {
    ok: true,
    logPath,
    logTail: lines.join('\n').slice(-4000),
    nassFiles: fs.existsSync(path.join(root, 'scripts', '_wiki_raw', 'stears-nass'))
      ? fs.readdirSync(path.join(root, 'scripts', '_wiki_raw', 'stears-nass'))
      : [],
  };
}
