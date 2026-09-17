console.log('ping');
require('fs').writeFileSync(require('path').join(__dirname, '..', '_ping-ok.txt'), 'ok\n');
