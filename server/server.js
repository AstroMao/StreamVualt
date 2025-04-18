const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { pipeline } = require('stream');
const { promisify } = require('util');
const session = require('express-session');
// Import required modules
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const unzipper = require('unzipper');
const { authMiddleware, login, logout } = require('./auth');
const { processTranscodingQueue } = require('./transcode');
const db = require('./db');

// Promisify the pipeline function
const pipelineAsync = promisify(pipeline);

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'stream-vault-secret',
  resave: true,
  saveUninitialized: true,
  cookie: { 
    secure: false, // Set to false for Docker environment
    maxAge: parseInt(process.env.SESSION_MAX_AGE) || 24 * 60 * 60 * 1000, // 24 hours
    httpOnly: true,
    sameSite: 'lax' // Allow cross-site requests
  },
  name: 'stream_vault_session' // Custom name for the session cookie
}));

// Debug middleware for session
app.use((req, res, next) => {
  console.log('Session:', req.session);
  next();
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(authMiddleware); // Apply authentication middleware

// Set up static file serving
app.use(express.static(path.join(__dirname, '../public')));
app.use('/media', express.static(path.join(__dirname, '../media')));

// Configure multer for file uploads
// Update multer configuration to allow larger file sizes
const upload = multer({ 
  dest: path.join(__dirname, '../upload'),
  limits: { fileSize: 50 * 1024 * 1024 * 1024 } // 50GB limit
});


// API Routes

// Get all videos (public)
app.get('/api/videos', async (req, res) => {
  try {
    const videos = await db.getAllVideos();
    // Transform snake_case to camelCase for frontend consistency
    const transformedVideos = videos.map(video => ({
      uuid: video.uuid,
      title: video.title,
      description: video.description,
      dateAdded: video.date_added
    }));
    res.json(transformedVideos);
  } catch (err) {
    console.error('Error fetching videos:', err);
    res.status(500).json({ error: 'Failed to fetch videos' });
  }
});

// Get video by UUID (public)
app.get('/api/video/:uuid', async (req, res) => {
  try {
    const { uuid } = req.params;
    const video = await db.getVideoByUuid(uuid);
    
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }
    
    // Check for available quality variants
    const videoPath = path.join(__dirname, '../media', video.path);
    const qualities = [];
    
    // Check for common quality folders
    ['1080p', '720p', '480p', '360p'].forEach(quality => {
      const qualityPath = path.join(videoPath, quality);
      if (fs.existsSync(qualityPath) && fs.existsSync(path.join(qualityPath, 'playlist.m3u8'))) {
        qualities.push(quality);
      }
    });
    
    // Return video details without exposing the actual path
    res.json({
      uuid: video.uuid,
      title: video.title,
      description: video.description,
      dateAdded: video.date_added,
      qualities: qualities
    });
  } catch (err) {
    console.error(`Error fetching video with UUID ${req.params.uuid}:`, err);
    res.status(500).json({ error: 'Failed to fetch video details' });
  }
});

// Get video stream path by UUID (used by player)
app.get('/api/stream/:uuid', async (req, res) => {
  try {
    const { uuid } = req.params;
    const video = await db.getVideoByUuid(uuid);
    
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }
    
    // Return the path to the HLS manifest
    res.json({
      streamUrl: `/media/${video.path}/master.m3u8`
    });
  } catch (err) {
    console.error(`Error fetching stream for UUID ${req.params.uuid}:`, err);
    res.status(500).json({ error: 'Failed to fetch stream information' });
  }
});

// Add a new video (admin only)
app.post('/api/admin/videos', upload.single('video'), async (req, res) => {
  try {
    const { title, description } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }
    
    const newUuid = uuidv4();
    const videoFolder = `video_${Date.now()}`;
    const videoPath = path.join(__dirname, '../media', videoFolder);
    fs.mkdirSync(videoPath, { recursive: true });
    
    const fileExt = path.extname(req.file.originalname).toLowerCase();
    
    if (fileExt === '.zip') {
      // Handle zip file upload (HLS package)
      try {
        console.log(`Processing zip file: ${req.file.originalname}`);
        
        // Extract zip contents without preserving top-level directory structure
        const directory = await unzipper.Open.file(req.file.path);
        
        // Get all paths to identify potential common root directory
        const allPaths = directory.files
          .filter(entry => entry.type !== 'Directory')
          .map(entry => entry.path);
        
        console.log(`Found ${allPaths.length} files in zip`);
        
        // Check if all files are in a common directory
        let commonPrefix = '';
        if (allPaths.length > 0) {
          const firstPath = allPaths[0];
          const firstDir = firstPath.split('/')[0];
          
          // If all files start with the same directory, we'll strip it
          if (firstDir && allPaths.every(p => p.startsWith(firstDir + '/'))) {
            commonPrefix = firstDir + '/';
            console.log(`Detected common prefix: ${commonPrefix}`);
          }
        }
        
        // Process each entry in the zip file
        for (const entry of directory.files) {
          // Skip directories, we'll create them as needed
          if (entry.type === 'Directory') continue;
          
          // Remove common prefix if it exists to avoid creating an extra directory
          let relativePath = entry.path;
          if (commonPrefix && relativePath.startsWith(commonPrefix)) {
            relativePath = relativePath.substring(commonPrefix.length);
          }
          
          // Create the target path for the file
          const targetPath = path.join(videoPath, relativePath);
          console.log(`Extracting: ${entry.path} -> ${targetPath}`);
          
          // Ensure the directory exists
          const targetDir = path.dirname(targetPath);
          fs.mkdirSync(targetDir, { recursive: true });
          
          // Extract the file using promisified pipeline
          await pipelineAsync(
            entry.stream(),
            fs.createWriteStream(targetPath)
          );
        }
        
        console.log('Zip extraction completed successfully');
        
        // Remove uploaded zip file after processing
        fs.rmSync(req.file.path);
      } catch (err) {
        console.error('Error extracting zip:', err);
        console.error(err.stack);
        return res.status(500).json({ error: 'Failed to extract HLS package' });
      }
    } else {
      // Handle single video file upload
      const originalPath = path.join(videoPath, 'original');
      fs.mkdirSync(originalPath, { recursive: true });
      // Use stream copy instead of rename to handle cross-filesystem move
      const source = fs.createReadStream(req.file.path);
      const destination = fs.createWriteStream(path.join(originalPath, req.file.originalname));
      await pipelineAsync(source, destination);
      fs.rmSync(req.file.path);
    }
    
    // Add entry to database
    const videoData = {
      uuid: newUuid,
      path: videoFolder,
      title: title || 'Untitled Video',
      description: description || '',
      status: fileExt === '.zip' ? 'ready' : 'pending_transcode'
    };
    
    await db.addVideo(videoData);
    
    res.status(201).json({ 
      message: 'Video added successfully',
      uuid: newUuid
    });
  } catch (error) {
    console.error('Error handling video upload:', error);
    res.status(500).json({ error: 'Failed to process video upload' });
  }
});

// Update video metadata (admin only)
app.put('/api/admin/videos/:uuid', async (req, res) => {
  try {
    const { uuid } = req.params;
    const { title, description } = req.body;
    
    const video = await db.getVideoByUuid(uuid);
    
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }
    
    // Update video metadata
    const metadata = {};
    if (title) metadata.title = title;
    if (description) metadata.description = description;
    
    const updatedVideo = await db.updateVideoMetadata(uuid, metadata);
    
    res.json({ 
      message: 'Video updated successfully',
      video: {
        uuid: updatedVideo.uuid,
        title: updatedVideo.title,
        description: updatedVideo.description,
        dateAdded: updatedVideo.date_added
      }
    });
  } catch (err) {
    console.error(`Error updating video metadata for UUID ${req.params.uuid}:`, err);
    res.status(500).json({ error: 'Failed to update video' });
  }
});

// Delete a video (admin only)
app.delete('/api/admin/videos/:uuid', async (req, res) => {
  try {
    const { uuid } = req.params;
    
    const video = await db.getVideoByUuid(uuid);
    
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }
    
    const videoPath = path.join(__dirname, '../media', video.path);
    
    // Remove video files
    try {
      fs.rmSync(videoPath, { recursive: true, force: true });
    } catch (err) {
      console.error('Error deleting video files:', err);
      // Continue anyway to remove from database
    }
    
    // Remove from database
    await db.deleteVideo(uuid);
    
    res.json({ message: 'Video deleted successfully' });
  } catch (err) {
    console.error(`Error deleting video with UUID ${req.params.uuid}:`, err);
    res.status(500).json({ error: 'Failed to delete video' });
  }
});

// Serve the player page for a specific UUID
app.get('/player/:uuid', async (req, res) => {
  try {
    const { uuid } = req.params;
    
    // Check if the video exists
    const video = await db.getVideoByUuid(uuid);
    
    if (!video) {
      return res.status(404).send('Video not found');
    }
    
    // Serve the player page
    res.sendFile(path.join(__dirname, '../public/player/index.html'));
  } catch (err) {
    console.error(`Error serving player page for UUID ${req.params.uuid}:`, err);
    res.status(500).send('Server error');
  }
});

// Serve the library page (protected)
app.get('/library', (req, res) => {
  res.redirect('/admin/library');
});

// Serve the admin library page (protected)
app.get('/admin/library', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin/library/index.html'));
});

// Serve the admin settings page (protected)
app.get('/admin/settings', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin/settings/index.html'));
});

// Serve the login page
app.get('/login', (req, res) => {
  // If already authenticated, redirect to library
  if (req.session && req.session.authenticated) {
    return res.redirect('/library');
  }
  res.sendFile(path.join(__dirname, '../public/login/index.html'));
});

// Handle login
app.post('/api/login', login);

// Handle logout
app.get('/logout', logout);

// Redirect root to login page
app.get('/', (req, res) => {
  res.redirect('/login');
});

// Redirect admin page to library (since we're combining them)
app.get('/admin', (req, res) => {
  res.redirect('/library');
});

// Get video transcoding status
app.get('/api/video/:uuid/status', async (req, res) => {
  try {
    const { uuid } = req.params;
    const video = await db.getVideoByUuid(uuid);
    
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }
    
    res.json({
      status: video.status || 'unknown',
      progress: video.transcode_progress || 0
    });
  } catch (err) {
    console.error(`Error getting status for video with UUID ${req.params.uuid}:`, err);
    res.status(500).json({ error: 'Failed to get video status' });
  }
});

// Start transcoding process (admin only)
app.post('/api/admin/transcode', async (req, res) => {
  try {
    const { videoId, quality, encodingOptions } = req.body || {};
    
    // Get transcoding settings from database
    let transcodingSettings = {
      defaultQuality: 'all',
      enableHls: true,
      useGPU: false,
      autoTranscode: true,
      selectedResolutions: ['1080p', '720p', '480p', '360p']
    };
    
    try {
      const settingsResult = await db.query('SELECT * FROM settings WHERE name = $1', ['transcoding']);
      if (settingsResult.rows.length > 0) {
        transcodingSettings = settingsResult.rows[0].value;
      }
    } catch (err) {
      console.error('Error fetching transcoding settings:', err);
    }
    
    // Parse encoding options
    const transcodingOptions = {
      videoCodec: 'libx264',
      audioCodec: 'aac',
      preset: 'medium',
      forceTranscode: false,
      useGPU: transcodingSettings.useGPU || false,
      autoTranscode: transcodingSettings.autoTranscode !== false,
      selectedResolutions: transcodingSettings.selectedResolutions || ['1080p', '720p', '480p', '360p']
    };
    
    // Add encoding options if provided
    if (encodingOptions) {
      // Video codec (e.g., libx264, libx265)
      if (encodingOptions.videoCodec) {
        transcodingOptions.videoCodec = encodingOptions.videoCodec;
      }
      
      // Audio codec (e.g., aac, libopus)
      if (encodingOptions.audioCodec) {
        transcodingOptions.audioCodec = encodingOptions.audioCodec;
      }
      
      // Encoding preset (e.g., ultrafast, fast, medium, slow)
      if (encodingOptions.preset) {
        transcodingOptions.preset = encodingOptions.preset;
      }
      
      // Force transcoding even for highest quality
      if (encodingOptions.forceTranscode === true) {
        transcodingOptions.forceTranscode = true;
      }
      
      // Override GPU setting if specified
      if (encodingOptions.useGPU !== undefined) {
        transcodingOptions.useGPU = encodingOptions.useGPU;
      }
      
      // Override auto-transcode setting if specified
      if (encodingOptions.autoTranscode !== undefined) {
        transcodingOptions.autoTranscode = encodingOptions.autoTranscode;
      }
      
      // Override selected resolutions if specified
      if (encodingOptions.selectedResolutions && Array.isArray(encodingOptions.selectedResolutions)) {
        transcodingOptions.selectedResolutions = encodingOptions.selectedResolutions;
      }
    }
    
    console.log('Transcoding options:', transcodingOptions);
    
    // Start the transcoding process in the background
    if (videoId) {
      // If a specific videoId is provided, only transcode that video
      const video = await db.getVideoByUuid(videoId);
      
      if (!video) {
        return res.status(404).json({ error: 'Video not found' });
      }
      
      // Update video status to pending_transcode and store the requested quality
      await db.updateVideoStatus(videoId, 'pending_transcode', 0);
      await db.updateVideoTranscodeQuality(videoId, quality || 'all', transcodingOptions);
      
      // Start the transcoding process for this video
      processTranscodingQueue(transcodingOptions).catch(err => {
        console.error('Error in transcoding queue:', err);
      });
      
      return res.json({ 
        message: 'Transcoding process started for video: ' + videoId,
        options: transcodingOptions
      });
    } else {
      // Start the transcoding process for all pending videos
      processTranscodingQueue(transcodingOptions).catch(err => {
        console.error('Error in transcoding queue:', err);
      });
      
      res.json({ 
        message: 'Transcoding process started for all pending videos',
        options: transcodingOptions
      });
    }
  } catch (err) {
    console.error('Error starting transcoding process:', err);
    res.status(500).json({ error: 'Failed to start transcoding process' });
  }
});

// Settings API endpoints

// Get transcoding settings
app.get('/api/settings/transcoding', async (req, res) => {
  try {
    // Query the database for settings
    const result = await db.query('SELECT * FROM settings WHERE name = $1', ['transcoding']);
    
    // If settings don't exist, return defaults
    if (!result.rows.length) {
      return res.json({
        defaultQuality: 'all',
        enableHls: true,
        useGPU: false,
        autoTranscode: true,
        selectedResolutions: ['1080p', '720p', '480p', '360p']
      });
    }
    
    // Return the settings
    res.json(result.rows[0].value);
  } catch (err) {
    console.error('Error fetching transcoding settings:', err);
    res.status(500).json({ error: 'Failed to fetch transcoding settings' });
  }
});

// Update transcoding settings
app.put('/api/settings/transcoding', async (req, res) => {
  try {
    const settings = req.body;
    
    // Validate settings
    if (!settings) {
      return res.status(400).json({ error: 'No settings provided' });
    }
    
    // Upsert the settings
    await db.query(
      'INSERT INTO settings (name, value) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET value = $2',
      ['transcoding', settings]
    );
    
    res.json({ message: 'Transcoding settings updated successfully' });
  } catch (err) {
    console.error('Error updating transcoding settings:', err);
    res.status(500).json({ error: 'Failed to update transcoding settings' });
  }
});

// Get current user
app.get('/api/user', (req, res) => {
  if (!req.session || !req.session.authenticated || !req.session.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  // Return user info (excluding sensitive data)
  res.json({
    username: req.session.user.username,
    role: req.session.user.role
  });
});

// Change password endpoint
app.post('/api/settings/change-password', async (req, res) => {
  try {
    const { username, currentPassword, newPassword } = req.body;
    
    if (!username || !currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Verify current password
    const user = await db.verifyUserCredentials(username, currentPassword);
    
    if (!user) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    
    // Hash the new password
    const bcrypt = require('bcrypt');
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
    
    // Update password
    await db.updateUserPassword(username, hashedPassword);
    
    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error('Error changing password:', err);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// Start the server
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  
  // Initialize the database with a delay to ensure the database is ready
  try {
    console.log('Waiting for database to be ready...');
    // Wait for 5 seconds before initializing the database
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    await db.initDB();
    console.log('Database initialized successfully');
    
    // Hash admin password if it's not already hashed
    try {
      await db.hashAdminPassword();
    } catch (err) {
      console.error('Error hashing admin password:', err);
    }
    
    // Check for videos that need transcoding on startup
    setTimeout(async () => {
      console.log('Checking for videos that need transcoding...');
      
      // Get transcoding settings from database or environment variables
      let transcodingSettings = {
        defaultQuality: process.env.DEFAULT_QUALITY || 'all',
        enableHls: true,
        useGPU: process.env.USE_GPU === 'true',
        autoTranscode: process.env.AUTO_TRANSCODE !== 'false',
        selectedResolutions: ['1080p', '720p', '480p', '360p']
      };
      
      try {
        const settingsResult = await db.query('SELECT * FROM settings WHERE name = $1', ['transcoding']);
        if (settingsResult.rows.length > 0) {
          transcodingSettings = settingsResult.rows[0].value;
        }
      } catch (err) {
        console.error('Error fetching transcoding settings:', err);
      }
      
      // Default encoding options for startup transcoding
      const defaultOptions = {
        videoCodec: 'libx264',
        audioCodec: 'aac',
        preset: 'medium',
        forceTranscode: false,
        useGPU: transcodingSettings.useGPU || false,
        autoTranscode: transcodingSettings.autoTranscode !== false,
        selectedResolutions: transcodingSettings.selectedResolutions || ['1080p', '720p', '480p', '360p']
      };
      
      processTranscodingQueue(defaultOptions).catch(err => {
        console.error('Error in transcoding queue:', err);
      });
    }, 5000); // Wait 5 seconds after server start
  } catch (err) {
    console.error('Error initializing database:', err);
  }
});
