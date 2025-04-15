/**
 * Migration script to transfer data from JSON file to PostgreSQL database
 * 
 * Usage: node scripts/migrate-to-postgres.js
 */

const fs = require('fs');
const path = require('path');
const db = require('../server/db');

// Path to the JSON database file
const DB_PATH = path.join(__dirname, '../server/video-db.json');

async function migrateData() {
  try {
    console.log('Starting migration from JSON to PostgreSQL...');
    
    // Check if JSON file exists
    if (!fs.existsSync(DB_PATH)) {
      console.error('JSON database file not found. Nothing to migrate.');
      process.exit(1);
    }
    
    // Read JSON data
    const jsonData = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    console.log(`Read JSON data: ${jsonData.videos.length} videos, ${jsonData.users.length} users`);
    
    // Initialize the database (create tables)
    await db.initDB();
    console.log('Database initialized');
    
    // Migrate videos
    console.log('Migrating videos...');
    for (const video of jsonData.videos) {
      try {
        // Convert dateAdded to date_added for PostgreSQL
        const videoData = {
          uuid: video.uuid,
          path: video.path,
          title: video.title || 'Untitled Video',
          description: video.description || '',
          status: video.status || 'pending_transcode'
        };
        
        // Add video to PostgreSQL
        await db.addVideo(videoData);
        
        // Update additional fields if they exist
        if (video.transcodeQuality || video.transcodeProgress || video.encodingOptions) {
          await db.updateVideoTranscodeQuality(
            video.uuid, 
            video.transcodeQuality || 'all',
            video.encodingOptions || null
          );
          
          await db.updateVideoStatus(
            video.uuid,
            video.status || 'pending_transcode',
            video.transcodeProgress || 0
          );
        }
        
        console.log(`Migrated video: ${video.title} (${video.uuid})`);
      } catch (err) {
        console.error(`Error migrating video ${video.uuid}:`, err);
      }
    }
    
    // Migrate users (if not already created by initDB)
    console.log('Migrating users...');
    for (const user of jsonData.users) {
      try {
        // Check if user already exists
        const existingUser = await db.getUserByUsername(user.username);
        
        if (!existingUser) {
          // Execute direct query to insert user
          await db.query(
            'INSERT INTO users (id, username, password, role) VALUES ($1, $2, $3, $4)',
            [user.id, user.username, user.password, user.role]
          );
          console.log(`Migrated user: ${user.username}`);
        } else {
          console.log(`User ${user.username} already exists, skipping`);
        }
      } catch (err) {
        console.error(`Error migrating user ${user.username}:`, err);
      }
    }
    
    console.log('Migration completed successfully!');
    
    // Create backup of the JSON file
    const backupPath = `${DB_PATH}.backup-${Date.now()}`;
    fs.copyFileSync(DB_PATH, backupPath);
    console.log(`Created backup of JSON database at: ${backupPath}`);
    
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

// Run the migration
migrateData();
