#!/usr/bin/env node
/**
 * Generate a scrypt password hash for admin-credentials.json
 *
 * Usage:
 *   node scripts/hash-admin-password.js
 *   node scripts/hash-admin-password.js "your-password"
 */
const readline = require('readline/promises');
const { stdin: input, stdout: output } = require('process');
const { hashPassword } = require('../src/admin-auth');

async function main() {
  let password = process.argv[2];
  if (!password) {
    const rl = readline.createInterface({ input, output });
    try {
      password = await rl.question('Password: ');
    } finally {
      rl.close();
    }
  }
  if (!password) {
    console.error('Password is required.');
    process.exitCode = 1;
    return;
  }
  const hash = await hashPassword(password);
  console.log(hash);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
