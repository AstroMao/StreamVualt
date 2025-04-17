const { Pool } = require('pg');
require('dotenv').config();

// Get database configuration from environment variables or use defaults
const pool = new Pool({
  user: process.env.DB_USER || 'video_user',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'video_db',
  password: process.env.DB_PASSWORD || 'db_password',
  port: parseInt(process.env.DB_PORT || '5432'),
});

async function resetDatabase() {
  try {
    console.log('Resetting database...');
    
    // Drop all tables
    await pool.query('DROP TABLE IF EXISTS videos CASCADE');
    await pool.query('DROP TABLE IF EXISTS users CASCADE');
    await pool.query('DROP TABLE IF EXISTS settings CASCADE');
    
    console.log('Tables dropped successfully');
    
    // Disconnect from the database
    await pool.end();
    
    console.log('Database reset complete. Run the server to reinitialize the database with new settings.');
    process.exit(0);
  } catch (err) {
    console.error('Error resetting database:', err);
    process.exit(1);
  }
}

resetDatabase();
