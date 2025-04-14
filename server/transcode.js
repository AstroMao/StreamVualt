const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { v4: uuidv4 } = require('uuid');

// Read the video database
const readVideoDB = () => {
  try {
    const data = fs.readFileSync(path.join(__dirname, 'video-db.json'), 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading video database:', err);
    return { videos: [] };
  }
};

// Write to the video database
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

// Update video status in the database
const updateVideoStatus = (uuid, status, progress = 0) => {
  const db = readVideoDB();
  const videoIndex = db.videos.findIndex(v => v.uuid === uuid);
  
  if (videoIndex === -1) {
    console.error(`Video with UUID ${uuid} not found`);
    return false;
  }
  
  db.videos[videoIndex].status = status;
  db.videos[videoIndex].transcodeProgress = progress;
  
  return writeVideoDB(db);
};

// Get video metadata using ffprobe
const getVideoMetadata = (videoPath) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(metadata);
    });
  });
};

// Generate thumbnail from video
const generateThumbnail = (videoPath, outputPath, timeInSeconds = 5) => {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .screenshots({
        timestamps: [timeInSeconds],
        filename: 'thumbnail.jpg',
        folder: outputPath,
        size: '640x360'
      })
      .on('end', () => {
        resolve(path.join(outputPath, 'thumbnail.jpg'));
      })
      .on('error', (err) => {
        reject(err);
      });
  });
};

// Create HLS stream with multiple quality variants
const createHLSStream = (videoUuid, videoPath, outputDir) => {
  return new Promise(async (resolve, reject) => {
    try {
      // Get video metadata
      const metadata = await getVideoMetadata(videoPath);
      const { width, height } = metadata.streams[0];
      
      // Generate thumbnail
      await generateThumbnail(videoPath, outputDir);
      
      // Define quality variants based on original video resolution
      const qualities = [];
      
      // Only add qualities that are lower than or equal to the original resolution
      if (height >= 1080) {
        qualities.push({
          name: '1080p',
          resolution: '1920x1080',
          videoBitrate: '5000k',
          audioBitrate: '192k'
        });
      }
      
      if (height >= 720) {
        qualities.push({
          name: '720p',
          resolution: '1280x720',
          videoBitrate: '2800k',
          audioBitrate: '128k'
        });
      }
      
      // Always include 480p as the lowest quality
      qualities.push({
        name: '480p',
        resolution: '854x480',
        videoBitrate: '1400k',
        audioBitrate: '96k'
      });
      
      // Create directories for each quality
      for (const quality of qualities) {
        const qualityDir = path.join(outputDir, quality.name);
        if (!fs.existsSync(qualityDir)) {
          fs.mkdirSync(qualityDir, { recursive: true });
        }
      }
      
      // Create master playlist content
      let masterPlaylist = '#EXTM3U\n#EXT-X-VERSION:3\n';
      
      // Process each quality variant sequentially
      let overallProgress = 0;
      
      for (let i = 0; i < qualities.length; i++) {
        const quality = qualities[i];
        const qualityDir = path.join(outputDir, quality.name);
        const playlistPath = path.join(qualityDir, 'playlist.m3u8');
        
        // Add to master playlist
        const [width, height] = quality.resolution.split('x');
        masterPlaylist += `#EXT-X-STREAM-INF:BANDWIDTH=${parseInt(quality.videoBitrate) * 1000},RESOLUTION=${quality.resolution}\n`;
        masterPlaylist += `${quality.name}/playlist.m3u8\n`;
        
        // Create HLS stream for this quality
        const ffmpegCommand = ffmpeg(videoPath);
        
        // For the highest quality, just copy the streams if resolution matches
        if (i === 0 && Math.abs(parseInt(width) - metadata.streams[0].width) < 100) {
          ffmpegCommand.outputOptions([
            '-c copy',             // Copy both video and audio codecs
            '-hls_time 10',        // 10 second segments
            '-hls_list_size 0',    // Keep all segments
            '-hls_segment_filename', path.join(qualityDir, 'segment%03d.ts')
          ]);
        } else {
          // For lower qualities, we need to transcode
          ffmpegCommand.outputOptions([
            '-c:v copy',           // Try to copy video codec
            '-c:a copy',           // Copy audio codec
            '-hls_time 10',        // 10 second segments
            '-hls_list_size 0',    // Keep all segments
            '-hls_segment_filename', path.join(qualityDir, 'segment%03d.ts')
          ]);
        }
        
        // Process this quality variant
        await new Promise((resolve, reject) => {
          ffmpegCommand.output(playlistPath)
            .on('progress', (progress) => {
              // Calculate overall progress
              const qualityProgress = progress.percent / 100;
              const qualityWeight = 1 / qualities.length;
              overallProgress = Math.round((i * qualityWeight + qualityProgress * qualityWeight) * 100);
              
              // Update status in database
              updateVideoStatus(videoUuid, 'transcoding', overallProgress);
              
              console.log(`[${quality.name}] Processing: ${progress.percent}% done (Overall: ${overallProgress}%)`);
            })
            .on('end', () => {
              console.log(`[${quality.name}] Transcoding complete`);
              resolve();
            })
            .on('error', (err) => {
              console.error(`[${quality.name}] Error:`, err);
              reject(err);
            })
            .run();
        });
      }
      
      // Write master playlist
      fs.writeFileSync(path.join(outputDir, 'master.m3u8'), masterPlaylist);
      
      // Update video status to ready
      updateVideoStatus(videoUuid, 'ready', 100);
      
      resolve();
    } catch (error) {
      console.error('Transcoding error:', error);
      updateVideoStatus(videoUuid, 'error', 0);
      reject(error);
    }
  });
};

// Process videos that need transcoding
const processTranscodingQueue = async () => {
  const db = readVideoDB();
  const pendingVideos = db.videos.filter(v => v.status === 'pending_transcode');
  
  if (pendingVideos.length === 0) {
    console.log('No videos pending transcoding');
    return;
  }
  
  console.log(`Found ${pendingVideos.length} videos pending transcoding`);
  
  for (const video of pendingVideos) {
    try {
      console.log(`Starting transcoding for video: ${video.title} (${video.uuid})`);
      
      // Update status to transcoding
      updateVideoStatus(video.uuid, 'transcoding', 0);
      
      const videoFolder = path.join(__dirname, '../media', video.path);
      const originalDir = path.join(videoFolder, 'original');
      
      // Find the first video file in the original directory
      const files = fs.readdirSync(originalDir);
      const videoFile = files.find(file => {
        const ext = path.extname(file).toLowerCase();
        return ['.mp4', '.mkv', '.mov', '.avi', '.webm'].includes(ext);
      });
      
      if (!videoFile) {
        console.error(`No valid video file found in ${originalDir}`);
        updateVideoStatus(video.uuid, 'error', 0);
        continue;
      }
      
      const videoPath = path.join(originalDir, videoFile);
      
      // Start transcoding
      await createHLSStream(video.uuid, videoPath, videoFolder);
      
      console.log(`Transcoding complete for video: ${video.title} (${video.uuid})`);
    } catch (error) {
      console.error(`Error processing video ${video.uuid}:`, error);
      updateVideoStatus(video.uuid, 'error', 0);
    }
  }
};

// Export functions
module.exports = {
  processTranscodingQueue,
  createHLSStream,
  generateThumbnail,
  getVideoMetadata,
  updateVideoStatus
};
