const db = require('../server/db');
const bcrypt = require('bcrypt');
require('dotenv').config();

async function main() {
  try {
    console.log('Hashing admin password...');
    await db.hashAdminPassword();
    console.log('Admin password hashed successfully');
    process.exit(0);
  } catch (err) {
    console.error('Error hashing admin password:', err);
    process.exit(1);
  }
}

main();
