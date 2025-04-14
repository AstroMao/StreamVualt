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
      let videoBitrate = '5000k'; // Default bitrate
      
      // Try to get the actual bitrate from metadata
      if (metadata.format && metadata.format.bit_rate) {
        const bitrate = parseInt(metadata.format.bit_rate);
        videoBitrate = `${Math.round(bitrate / 1000)}k`;
      }
      
      // Generate thumbnail
      await generateThumbnail(videoPath, outputDir);
      
      // Create a quality folder
      const qualityName = height >= 720 ? '1080p' : (height >= 480 ? '720p' : '480p');
      const qualityDir = path.join(outputDir, qualityName);
      if (!fs.existsSync(qualityDir)) {
        fs.mkdirSync(qualityDir, { recursive: true });
      }
      
      // Create a single HLS stream in the quality folder
      const playlistPath = path.join(qualityDir, 'playlist.m3u8');
      
      // Create HLS stream - using simpler options
      const ffmpegCommand = ffmpeg(videoPath);
      
      // Use a simpler approach - just copy the streams
      ffmpegCommand.outputOptions([
        '-c copy',             // Copy both video and audio codecs
        '-hls_time 10',        // 10 second segments
        '-hls_list_size 0',    // Keep all segments
        '-hls_segment_filename', path.join(qualityDir, 'segment%03d.ts')
      ]);
      
      // Create a simple master playlist
      const masterPlaylist = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=${parseInt(videoBitrate) * 1000},RESOLUTION=${width}x${height}
${qualityName}/playlist.m3u8
`;
      
      // Write master playlist
      fs.writeFileSync(path.join(outputDir, 'master.m3u8'), masterPlaylist);
      
      // Set output and run the command
      await new Promise((resolve, reject) => {
        ffmpegCommand.output(playlistPath)
          .on('progress', (progress) => {
            // Update status in database
            updateVideoStatus(videoUuid, 'transcoding', progress.percent);
            console.log(`Processing: ${progress.percent}% done`);
          })
          .on('end', () => {
            console.log(`Transcoding complete`);
            resolve();
          })
          .on('error', (err) => {
            console.error(`Error:`, err);
            reject(err);
          })
          .run();
      });
      
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
