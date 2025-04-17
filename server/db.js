const { Pool } = require('pg');

// Get database configuration from environment variables or use defaults
const pool = new Pool({
  user: process.env.DB_USER || 'video_user',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'video_db',
  password: process.env.DB_PASSWORD || 'db_password',
  port: parseInt(process.env.DB_PORT || '5432'),
});

// Generic query function
async function query(text, params) {
  try {
    const result = await pool.query(text, params);
    return result;
  } catch (err) {
    console.error('Database query error:', err);
    throw err;
  }
}

// Initialize the database tables
async function initDB() {
  try {
    // Create videos table
    await query(`
      CREATE TABLE IF NOT EXISTS videos (
        uuid UUID PRIMARY KEY,
        path VARCHAR(255) NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        date_added TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(50) NOT NULL,
        transcode_quality VARCHAR(50),
        transcode_progress INTEGER,
        encoding_options JSONB
      );
    `);

    // Create users table
    await query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL
      );
    `);
    
    // Create settings table
    await query(`
      CREATE TABLE IF NOT EXISTS settings (
        name VARCHAR(50) PRIMARY KEY,
        value JSONB NOT NULL
      );
    `);

    // Check if default users exist, if not create them
    const usersExist = await query('SELECT COUNT(*) FROM users');
    if (parseInt(usersExist.rows[0].count) === 0) {
      // Get admin credentials from environment variables or use defaults
      const adminUsername = process.env.ADMIN_USERNAME || 'admin';
      const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
      
      // Insert default users
      await query(`
        INSERT INTO users (username, password, role) VALUES
        ($1, $2, 'admin'),
        ('user', 'user123', 'user')
      `, [adminUsername, adminPassword]);
      console.log('Default users created');
    }

    console.log('Database initialized');
  } catch (err) {
    console.error('Error initializing database:', err);
    throw err;
  }
}

// Video-related functions

// Get all videos
async function getAllVideos() {
  try {
    const result = await query('SELECT uuid, title, description, date_added FROM videos');
    return result.rows;
  } catch (err) {
    console.error('Error getting all videos:', err);
    throw err;
  }
}

// Get video by UUID
async function getVideoByUuid(uuid) {
  try {
    const result = await query('SELECT * FROM videos WHERE uuid = $1', [uuid]);
    return result.rows[0] || null;
  } catch (err) {
    console.error(`Error getting video with UUID ${uuid}:`, err);
    throw err;
  }
}

// Add a new video
async function addVideo(videoData) {
  try {
    const { uuid, path, title, description, status } = videoData;
    const result = await query(
      'INSERT INTO videos (uuid, path, title, description, date_added, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [uuid, path, title, description, new Date().toISOString(), status]
    );
    return result.rows[0];
  } catch (err) {
    console.error('Error adding video:', err);
    throw err;
  }
}

// Update video metadata
async function updateVideoMetadata(uuid, metadata) {
  try {
    const { title, description } = metadata;
    const updates = [];
    const values = [uuid];
    let valueIndex = 2;

    if (title !== undefined) {
      updates.push(`title = $${valueIndex++}`);
      values.push(title);
    }

    if (description !== undefined) {
      updates.push(`description = $${valueIndex++}`);
      values.push(description);
    }

    if (updates.length === 0) {
      return null; // Nothing to update
    }

    const result = await query(
      `UPDATE videos SET ${updates.join(', ')} WHERE uuid = $1 RETURNING *`,
      values
    );
    return result.rows[0];
  } catch (err) {
    console.error(`Error updating video metadata for UUID ${uuid}:`, err);
    throw err;
  }
}

// Update video status
async function updateVideoStatus(uuid, status, progress = 0) {
  try {
    const result = await query(
      'UPDATE videos SET status = $1, transcode_progress = $2 WHERE uuid = $3 RETURNING *',
      [status, progress, uuid]
    );
    return result.rows[0];
  } catch (err) {
    console.error(`Error updating video status for UUID ${uuid}:`, err);
    throw err;
  }
}

// Update video transcode quality
async function updateVideoTranscodeQuality(uuid, quality, encodingOptions = null) {
  try {
    const result = await query(
      'UPDATE videos SET transcode_quality = $1, encoding_options = $2 WHERE uuid = $3 RETURNING *',
      [quality, encodingOptions ? JSON.stringify(encodingOptions) : null, uuid]
    );
    return result.rows[0];
  } catch (err) {
    console.error(`Error updating transcode quality for UUID ${uuid}:`, err);
    throw err;
  }
}

// Delete a video
async function deleteVideo(uuid) {
  try {
    const result = await query('DELETE FROM videos WHERE uuid = $1 RETURNING *', [uuid]);
    return result.rows[0];
  } catch (err) {
    console.error(`Error deleting video with UUID ${uuid}:`, err);
    throw err;
  }
}

// Get videos by status
async function getVideosByStatus(status) {
  try {
    const result = await query('SELECT * FROM videos WHERE status = $1', [status]);
    return result.rows;
  } catch (err) {
    console.error(`Error getting videos with status ${status}:`, err);
    throw err;
  }
}

// User-related functions

// Get user by username
async function getUserByUsername(username) {
  try {
    const result = await query('SELECT * FROM users WHERE username = $1', [username]);
    return result.rows[0] || null;
  } catch (err) {
    console.error(`Error getting user with username ${username}:`, err);
    throw err;
  }
}

// Verify user credentials
async function verifyUserCredentials(username, password) {
  try {
    const user = await getUserByUsername(username);
    if (!user) return null;
    
    // Check if password is hashed (starts with $2b$ for bcrypt)
    if (user.password.startsWith('$2b$')) {
      // Use bcrypt to compare
      const bcrypt = require('bcrypt');
      const match = await bcrypt.compare(password, user.password);
      return match ? user : null;
    } else {
      // Legacy plain text comparison (for backward compatibility)
      if (user.password === password) {
        return user;
      }
      return null;
    }
  } catch (err) {
    console.error('Error verifying user credentials:', err);
    throw err;
  }
}

// Update user password
async function updateUserPassword(username, hashedPassword) {
  try {
    const result = await query(
      'UPDATE users SET password = $1 WHERE username = $2 RETURNING *',
      [hashedPassword, username]
    );
    return result.rows[0];
  } catch (err) {
    console.error(`Error updating password for user ${username}:`, err);
    throw err;
  }
}

// Hash admin password
async function hashAdminPassword() {
  try {
    const bcrypt = require('bcrypt');
    const saltRounds = 10;
    
    // Get admin user
    const admin = await getUserByUsername('admin');
    if (!admin) {
      console.log('Admin user not found');
      return;
    }
    
    // Skip if password is already hashed
    if (admin.password.startsWith('$2b$')) {
      console.log('Admin password is already hashed');
      return;
    }
    
    // Hash the password
    const hashedPassword = await bcrypt.hash(admin.password, saltRounds);
    
    // Update the password
    await updateUserPassword('admin', hashedPassword);
    
    console.log('Admin password hashed successfully');
  } catch (err) {
    console.error('Error hashing admin password:', err);
    throw err;
  }
}

// Export all functions
module.exports = {
  query,
  initDB,
  getAllVideos,
  getVideoByUuid,
  addVideo,
  updateVideoMetadata,
  updateVideoStatus,
  updateVideoTranscodeQuality,
  deleteVideo,
  getVideosByStatus,
  getUserByUsername,
  verifyUserCredentials,
  updateUserPassword,
  hashAdminPassword
};
