const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { pipeline } = require('stream');
const { promisify } = require('util');
// Import required modules
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const unzipper = require('unzipper');
const { conditionalAuth } = require('./auth');
const { processTranscodingQueue } = require('./transcode');
const db = require('./db');

// Promisify the pipeline function
const pipelineAsync = promisify(pipeline);

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(conditionalAuth); // Apply conditional authentication

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
    res.json(videos);
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
      fs.renameSync(req.file.path, path.join(originalPath, req.file.originalname));
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
  res.sendFile(path.join(__dirname, '../public/library/index.html'));
});

// Serve the login page
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/login/index.html'));
});

// Handle logout
app.get('/logout', (req, res) => {
  // In a real app, you'd clear the session here
  // For basic auth, we'll just redirect to home
  res.redirect('/');
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
    
    // Parse encoding options
    const transcodingOptions = {};
    
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

// Start the server
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  
  // Initialize the database
  try {
    await db.initDB();
    console.log('Database initialized successfully');
    
    // Check for videos that need transcoding on startup
    setTimeout(() => {
      console.log('Checking for videos that need transcoding...');
      
      // Default encoding options for startup transcoding
      const defaultOptions = {
        videoCodec: 'libx264',
        audioCodec: 'aac',
        preset: 'medium',
        forceTranscode: false
      };
      
      processTranscodingQueue(defaultOptions).catch(err => {
        console.error('Error in transcoding queue:', err);
      });
    }, 5000); // Wait 5 seconds after server start
  } catch (err) {
    console.error('Error initializing database:', err);
  }
});
