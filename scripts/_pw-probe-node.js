async (page) => {
  // Probe whether filename-loaded runners get Node APIs
  let fsOk = false;
  let nodeVer = null;
  let err = null;
  try {
    const fs = require('fs');
    const { execSync } = require('child_process');
    fsOk = true;
    nodeVer = execSync('node -v', { encoding: 'utf8' }).trim();
    const root = 'C:\\Users\\Geoinfotech\\Documents\\GIS Team\\Election Dashboard';
    fs.writeFileSync(root + '\\scripts\\_shell_ok.txt', 'ok ' + nodeVer + ' ' + new Date().toISOString());
  } catch (e) {
    err = String(e);
  }
  return { fsOk, nodeVer, err, url: page.url() };
}
