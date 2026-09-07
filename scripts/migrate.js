require('dotenv').config();
const { initializeEditorialStore } = require('../src/editorial-store');

initializeEditorialStore()
  .then((status) => {
    if (!status.enabled) throw new Error('Set EDITORIAL_DATABASE_URL before running migrations.');
    console.log('Editorial database migrations are current.');
  })
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });

