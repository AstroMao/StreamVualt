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

// Helper function to read the video database
const readVideoDB = () => {
  try {
    const data = fs.readFileSync(path.join(__dirname, 'video-db.json'), 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading video database:', err);
    return { videos: [] };
  }
};

// Helper function to write to the video database
const writeVideoDB = (data) => {
  try {
    fs.writeFileSync(
      path.join(__dirname, 'video-db.json'),
      JSON.stringify(data, null, 2),
      'utf8'
    );
    return true;
  } catch (err) {
    console.error('Error writing to video database:', err);
    return false;
  }
};

// API Routes

// Get all videos (public)
app.get('/api/videos', (req, res) => {
  const db = readVideoDB();
  // Return only necessary information, not the file paths
  const videos = db.videos.map(video => ({
    uuid: video.uuid,
    title: video.title,
    description: video.description,
    dateAdded: video.dateAdded
  }));
  res.json(videos);
});

// Get video by UUID (public)
app.get('/api/video/:uuid', (req, res) => {
  const { uuid } = req.params;
  const db = readVideoDB();
  const video = db.videos.find(v => v.uuid === uuid);
  
  if (!video) {
    return res.status(404).json({ error: 'Video not found' });
  }
  
  // Return video details without exposing the actual path
  res.json({
    uuid: video.uuid,
    title: video.title,
    description: video.description,
    dateAdded: video.dateAdded
  });
});

// Get video stream path by UUID (used by player)
app.get('/api/stream/:uuid', (req, res) => {
  const { uuid } = req.params;
  const db = readVideoDB();
  const video = db.videos.find(v => v.uuid === uuid);
  
  if (!video) {
    return res.status(404).json({ error: 'Video not found' });
  }
  
  // Return the path to the HLS manifest
  res.json({
    streamUrl: `/media/${video.path}/master.m3u8`
  });
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
    const db = readVideoDB();
    db.videos.push({
      uuid: newUuid,
      path: videoFolder,
      title: title || 'Untitled Video',
      description: description || '',
      dateAdded: new Date().toISOString(),
      status: fileExt === '.zip' ? 'ready' : 'pending_transcode'
    });
    
    if (writeVideoDB(db)) {
      res.status(201).json({ 
        message: 'Video added successfully',
        uuid: newUuid
      });
    } else {
      res.status(500).json({ error: 'Failed to add video to database' });
    }
  } catch (error) {
    console.error('Error handling video upload:', error);
    res.status(500).json({ error: 'Failed to process video upload' });
  }
});

// Update video metadata (admin only)
app.put('/api/admin/videos/:uuid', (req, res) => {
  const { uuid } = req.params;
  const { title, description } = req.body;
  
  const db = readVideoDB();
  const videoIndex = db.videos.findIndex(v => v.uuid === uuid);
  
  if (videoIndex === -1) {
    return res.status(404).json({ error: 'Video not found' });
  }
  
  // Update video metadata
  if (title) db.videos[videoIndex].title = title;
  if (description) db.videos[videoIndex].description = description;
  
  if (writeVideoDB(db)) {
    res.json({ 
      message: 'Video updated successfully',
      video: {
        uuid: db.videos[videoIndex].uuid,
        title: db.videos[videoIndex].title,
        description: db.videos[videoIndex].description,
        dateAdded: db.videos[videoIndex].dateAdded
      }
    });
  } else {
    res.status(500).json({ error: 'Failed to update video' });
  }
});

// Delete a video (admin only)
app.delete('/api/admin/videos/:uuid', (req, res) => {
  const { uuid } = req.params;
  
  const db = readVideoDB();
  const videoIndex = db.videos.findIndex(v => v.uuid === uuid);
  
  if (videoIndex === -1) {
    return res.status(404).json({ error: 'Video not found' });
  }
  
  const videoPath = path.join(__dirname, '../media', db.videos[videoIndex].path);
  
  // Remove video files
  try {
    fs.rmSync(videoPath, { recursive: true, force: true });
  } catch (err) {
    console.error('Error deleting video files:', err);
    // Continue anyway to remove from database
  }
  
  // Remove from database
  db.videos.splice(videoIndex, 1);
  
  if (writeVideoDB(db)) {
    res.json({ message: 'Video deleted successfully' });
  } else {
    res.status(500).json({ error: 'Failed to update database after deletion' });
  }
});

// Serve the player page for a specific UUID
app.get('/player/:uuid', (req, res) => {
  const { uuid } = req.params;
  
  // Check if the video exists
  const db = readVideoDB();
  const video = db.videos.find(v => v.uuid === uuid);
  
  if (!video) {
    return res.status(404).send('Video not found');
  }
  
  // Serve the player page
  res.sendFile(path.join(__dirname, '../public/player/index.html'));
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
app.get('/api/video/:uuid/status', (req, res) => {
  const { uuid } = req.params;
  const db = readVideoDB();
  const video = db.videos.find(v => v.uuid === uuid);
  
  if (!video) {
    return res.status(404).json({ error: 'Video not found' });
  }
  
  res.json({
    status: video.status || 'unknown',
    progress: video.transcodeProgress || 0
  });
});

// Start transcoding process (admin only)
app.post('/api/admin/transcode', (req, res) => {
  // Start the transcoding process in the background
  processTranscodingQueue().catch(err => {
    console.error('Error in transcoding queue:', err);
  });
  
  res.json({ message: 'Transcoding process started' });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  
  // Check for videos that need transcoding on startup
  setTimeout(() => {
    console.log('Checking for videos that need transcoding...');
    processTranscodingQueue().catch(err => {
      console.error('Error in transcoding queue:', err);
    });
  }, 5000); // Wait 5 seconds after server start
});
