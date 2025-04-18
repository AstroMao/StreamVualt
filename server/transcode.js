const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');

// Update video status in the database
const updateVideoStatus = async (uuid, status, progress = 0) => {
  try {
    await db.updateVideoStatus(uuid, status, progress);
    return true;
  } catch (err) {
    console.error(`Error updating status for video with UUID ${uuid}:`, err);
    return false;
  }
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
const createHLSStream = (videoUuid, videoPath, outputDir, requestedQuality = 'all', encodingOptions = {}) => {
  return new Promise(async (resolve, reject) => {
    try {
      // Set active transcoding flag
      activeTranscoding = true;
      
      // Reset transcoding stats
      updateTranscodingStats({
        videoCodec: '',
        speed: '',
        resourceUsage: ''
      });
      
      // Add initial log
      addTranscodingLog(`Starting transcoding for ${path.basename(videoPath)}`);
      // Get video metadata
      const metadata = await getVideoMetadata(videoPath);
      const { width, height } = metadata.streams[0];
      
      // Generate thumbnail
      await generateThumbnail(videoPath, outputDir);
      
      // Get video codec information
      const videoCodec = metadata.streams[0].codec_name || 'unknown';
      const audioCodec = metadata.streams.find(s => s.codec_type === 'audio')?.codec_name || 'unknown';
      console.log(`Original video codec: ${videoCodec}, audio codec: ${audioCodec}`);
      addTranscodingLog(`Original video codec: ${videoCodec}, audio codec: ${audioCodec}`);
      updateTranscodingStats({ videoCodec: `${videoCodec} → ${encodingOptions.videoCodec || 'libx264'}` });
      
      // Define quality variants based on original video resolution
      const allQualities = [];
      
      // Only add qualities that are lower than or equal to the original resolution
      if (height >= 900) {
        allQualities.push({
          name: '1080p',
          resolution: '1920x1080',
          videoBitrate: '5000k',
          audioBitrate: '192k',
          crf: 23  // Constant Rate Factor (lower = better quality, higher = smaller file)
        });
      }
      
      if (height >= 720) {
        allQualities.push({
          name: '720p',
          resolution: '1280x720',
          videoBitrate: '2800k',
          audioBitrate: '128k',
          crf: 23
        });
      }
      
      if (height >= 480) {
        allQualities.push({
          name: '480p',
          resolution: '854x480',
          videoBitrate: '1400k',
          audioBitrate: '96k',
          crf: 23
        });
      }
      
      // Always include 360p as the lowest quality for mobile devices
      allQualities.push({
        name: '360p',
        resolution: '640x360',
        videoBitrate: '800k',
        audioBitrate: '96k',
        crf: 23
      });
      
      // Filter qualities based on the requested quality and selected resolutions
      let qualities = [];
      if (requestedQuality === 'all') {
        // If specific resolutions are selected in settings, filter by them
        if (encodingOptions.selectedResolutions && Array.isArray(encodingOptions.selectedResolutions)) {
          qualities = allQualities.filter(q => encodingOptions.selectedResolutions.includes(q.name));
          console.log(`Using selected resolutions: ${encodingOptions.selectedResolutions.join(', ')}`);
        } else {
          qualities = allQualities;
        }
      } else {
        // Find the specific quality requested
        const requestedQualityObj = allQualities.find(q => q.name === requestedQuality);
        if (requestedQualityObj) {
          qualities = [requestedQualityObj];
        } else {
          // If requested quality not found, use all available qualities
          console.warn(`Requested quality "${requestedQuality}" not found, using all available qualities`);
          
          // Filter by selected resolutions if available
          if (encodingOptions.selectedResolutions && Array.isArray(encodingOptions.selectedResolutions)) {
            qualities = allQualities.filter(q => encodingOptions.selectedResolutions.includes(q.name));
          } else {
            qualities = allQualities;
          }
        }
      }
      
      // Ensure we have at least one quality
      if (qualities.length === 0) {
        console.warn('No qualities selected, using all available qualities');
        qualities = allQualities;
      }
      
      console.log(`Transcoding with qualities: ${qualities.map(q => q.name).join(', ')}`);
      addTranscodingLog(`Transcoding with qualities: ${qualities.map(q => q.name).join(', ')}`);
      
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
        
        // Determine encoding settings
        const encodingPreset = encodingOptions.preset || 'medium'; // slow = better quality but slower encoding
        const videoCodecToUse = encodingOptions.videoCodec || 'libx264'; // Default to H.264
        const audioCodecToUse = encodingOptions.audioCodec || 'aac'; // Default to AAC
        
        // For the highest quality, just copy the streams if resolution matches closely and format is compatible
        // Unless forceTranscode is true
        const isHighestQuality = i === 0;
        const resolutionMatches = Math.abs(parseInt(width) - metadata.streams[0].width) < 100;
        const canCopyVideo = videoCodec === 'h264' || videoCodec === 'hevc';
        const canCopyAudio = audioCodec === 'aac' || audioCodec === 'mp3';
        const forceTranscode = encodingOptions.forceTranscode === true;
        
        if (isHighestQuality && resolutionMatches && canCopyVideo && canCopyAudio && !forceTranscode) {
          console.log(`Using stream copy for highest quality (${quality.name})`);
          addTranscodingLog(`Using stream copy for highest quality (${quality.name})`);
          ffmpegCommand.outputOptions([
            '-c copy',             // Copy both video and audio codecs (efficient for highest quality)
            '-hls_time 10',        // 10 second segments
            '-hls_list_size 0',    // Keep all segments
            '-hls_segment_filename', path.join(qualityDir, 'segment%03d.ts')
          ]);
        } else {
          // For lower qualities or incompatible formats, properly transcode with specific settings
          console.log(`Transcoding for ${quality.name} using ${videoCodecToUse}`);
          addTranscodingLog(`Transcoding for ${quality.name} using ${videoCodecToUse}`);
          
          // Base output options
          const outputOptions = [
            `-c:v ${videoCodecToUse}`,  // Video codec
            `-vf scale=${width}:${height}`, // Scale to target resolution
          ];
          
          // Add GPU-specific options if using NVENC
          if (videoCodecToUse.includes('nvenc')) {
            outputOptions.push(
              '-rc:v vbr_hq',      // High quality variable bitrate mode
              '-rc-lookahead:v 32', // Lookahead frames for better quality
              '-spatial_aq:v 1',    // Spatial adaptive quantization
              '-temporal_aq:v 1'    // Temporal adaptive quantization
            );
          }
          
          // Add quality settings based on codec
          if (videoCodecToUse === 'libx264' || videoCodecToUse === 'libx265') {
            // For x264/x265, use CRF for quality control
            outputOptions.push(
              `-crf ${quality.crf}`,       // Constant Rate Factor for quality
              `-maxrate ${quality.videoBitrate}`, // Max bitrate
              `-bufsize ${parseInt(quality.videoBitrate) * 2}k`, // Buffer size
              `-preset ${encodingPreset}`, // Encoding preset (balance between speed and quality)
              '-profile:v main',     // H.264/H.265 profile
              '-level 4.1',          // Compatibility level
              '-movflags +faststart' // Optimize for web streaming
            );
          } else {
            // For other codecs, use standard bitrate control
            outputOptions.push(`-b:v ${quality.videoBitrate}`);
          }
          
          // Audio settings
          outputOptions.push(
            `-c:a ${audioCodecToUse}`,    // Audio codec
            `-b:a ${quality.audioBitrate}`, // Audio bitrate
            '-ar 48000',           // Audio sample rate
            '-ac 2'                // 2 audio channels (stereo)
          );
          
          // HLS settings
          outputOptions.push(
            '-hls_time 10',        // 10 second segments
            '-hls_list_size 0',    // Keep all segments
            '-hls_segment_type mpegts', // Use MPEG-TS segments
            '-hls_playlist_type vod', // Video on demand playlist
            '-hls_segment_filename', path.join(qualityDir, 'segment%03d.ts')
          );
          
          ffmpegCommand.outputOptions(outputOptions);
        }
        
        // Apply CPU usage limit if specified
        if (encodingOptions.cpuUsage && parseInt(encodingOptions.cpuUsage) > 0) {
          const cpuUsage = parseInt(encodingOptions.cpuUsage);
          
          // Get available CPU cores
          const os = require('os');
          const availableCores = os.cpus().length;
          
          // Calculate threads based on percentage (minimum 1 thread)
          const threads = Math.max(1, Math.floor(availableCores * (cpuUsage / 100)));
          
          // Apply thread limit to ffmpeg command
          // Note: We need to add this to the main command options, not just output options
          ffmpegCommand.addOptions([`-threads ${threads}`]);
          ffmpegCommand.outputOptions([`-threads ${threads}`]);
          
          // Also limit CPU affinity if possible (Linux only)
          try {
            const { execSync } = require('child_process');
            // Check if taskset is available
            execSync('which taskset', { stdio: 'pipe' });
            // We'll apply taskset when we get the process ID in the 'start' event
          } catch (err) {
            // taskset not available, just use thread limiting
          }
          
          addTranscodingLog(`Limiting CPU usage to ${cpuUsage}% (${threads} of ${availableCores} cores)`);
          updateTranscodingStats({ resourceUsage: `${cpuUsage}% (${threads} cores)` });
        } else {
          // Default resource usage display
          updateTranscodingStats({ resourceUsage: encodingOptions.useGPU ? 'GPU (NVENC)' : 'CPU (all cores)' });
        }
        
        // Process this quality variant
        await new Promise((resolve, reject) => {
          const ffmpegProcess = ffmpegCommand.output(playlistPath)
            .on('start', (commandLine) => {
              addTranscodingLog(`FFmpeg command: ${commandLine}`, 'info');
              
              // Store the ffmpeg process for pause/resume functionality
              currentFfmpegProcess = ffmpegProcess;
              
              // Get the process ID for pause/resume functionality
              if (ffmpegProcess && ffmpegProcess._events && ffmpegProcess._events.error) {
                // Try to get the process ID from the fluent-ffmpeg object
                try {
                  // Access the internal ffmpeg process to get its PID
                  const childProcess = ffmpegProcess.ffmpegProc;
                  if (childProcess && childProcess.pid) {
                    addTranscodingLog(`FFmpeg process started with PID: ${childProcess.pid}`, 'info');
                    // Store the PID directly on the ffmpegProcess object
                    ffmpegProcess.pid = childProcess.pid;
                  }
                } catch (err) {
                  addTranscodingLog(`Warning: Could not get FFmpeg process ID: ${err.message}`, 'warning');
                }
              }
              
              updateTranscodingStats({ status: 'active' });
            })
            .on('stderr', (stderrLine) => {
              // Extract useful information from ffmpeg output
              if (stderrLine.includes('fps=') && stderrLine.includes('speed=')) {
                try {
                  const speedMatch = stderrLine.match(/speed=([0-9.]+)x/);
                  if (speedMatch && speedMatch[1]) {
                    const speed = `${speedMatch[1]}x`;
                    updateTranscodingStats({ speed });
                  }
                } catch (e) {
                  // Ignore parsing errors
                }
              }
              
              // Add to logs if it contains useful information
              if (stderrLine.includes('fps=') || 
                  stderrLine.includes('stream') || 
                  stderrLine.includes('error') || 
                  stderrLine.includes('warning')) {
                addTranscodingLog(stderrLine, stderrLine.includes('error') ? 'error' : 'info');
              }
            })
            .on('progress', (progress) => {
              // Calculate overall progress
              const qualityProgress = progress.percent / 100;
              const qualityWeight = 1 / qualities.length;
              overallProgress = Math.round((i * qualityWeight + qualityProgress * qualityWeight) * 100);
              
              // Update status in database
              updateVideoStatus(videoUuid, 'transcoding', overallProgress);
              
              console.log(`[${quality.name}] Processing: ${progress.percent}% done (Overall: ${overallProgress}%)`);
              addTranscodingLog(`[${quality.name}] Processing: ${progress.percent}% done (Overall: ${overallProgress}%)`);
            })
            .on('end', () => {
              console.log(`[${quality.name}] Transcoding complete`);
              addTranscodingLog(`[${quality.name}] Transcoding complete`);
              resolve();
            })
            .on('error', (err) => {
              console.error(`[${quality.name}] Error:`, err);
              addTranscodingLog(`[${quality.name}] Error: ${err.message}`, 'error');
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

// Store transcoding logs and stats
const transcodingLogs = [];
let logIdCounter = 0;
let activeTranscoding = false;
let pausedTranscoding = false;
let currentFfmpegProcess = null;
let transcodingStats = {
  videoCodec: '',
  speed: '',
  resourceUsage: '',
  status: 'idle' // idle, active, paused
};

// Add a log entry
const addTranscodingLog = (message, type = 'info') => {
  const log = {
    id: ++logIdCounter,
    timestamp: new Date(),
    message,
    type
  };
  transcodingLogs.push(log);
  
  // Keep only the last 1000 logs
  if (transcodingLogs.length > 1000) {
    transcodingLogs.shift();
  }
  
  return log;
};

// Update transcoding stats
const updateTranscodingStats = (stats) => {
  transcodingStats = { ...transcodingStats, ...stats };
};

// Get transcoding logs since a specific ID
const getTranscodingLogs = (sinceId = 0) => {
  return {
    active: activeTranscoding,
    logs: transcodingLogs.filter(log => log.id > sinceId),
    stats: transcodingStats
  };
};

/**
 * Process videos that need transcoding
 * @param {Object} options - Options for the transcoding process
 * @param {string} options.videoCodec - Video codec to use (e.g., 'libx264', 'libx265', 'h264_nvenc', 'hevc_nvenc')
 * @param {string} options.audioCodec - Audio codec to use (e.g., 'aac', 'libopus')
 * @param {string} options.preset - Encoding preset (e.g., 'ultrafast', 'fast', 'medium', 'slow')
 * @param {boolean} options.forceTranscode - Force transcoding even for highest quality
 * @param {boolean} options.useGPU - Use GPU acceleration if available
 * @param {boolean} options.autoTranscode - Automatically transcode videos after upload
 * @param {number} options.cpuThreads - Number of CPU threads to use (0 = automatic)
 * @returns {Promise<void>}
 */
const processTranscodingQueue = async (options = {}) => {
  try {
    const pendingVideos = await db.getVideosByStatus('pending_transcode');
    
    if (pendingVideos.length === 0) {
      console.log('No videos pending transcoding');
      return;
    }
    
    console.log(`Found ${pendingVideos.length} videos pending transcoding`);
    console.log(`Encoding options: ${JSON.stringify(options)}`);
    
    // Set default encoding options
    const encodingOptions = {
      videoCodec: options.videoCodec || 'libx264',
      audioCodec: options.audioCodec || 'aac',
      preset: options.preset || 'medium',
      forceTranscode: options.forceTranscode || false,
      useGPU: options.useGPU || false,
      autoTranscode: options.autoTranscode !== undefined ? options.autoTranscode : true
    };

    // Check if GPU acceleration is requested and available
    if (encodingOptions.useGPU) {
      try {
        // Check for NVIDIA GPU using a synchronous approach
        const { execSync } = require('child_process');
        try {
          // Try to run nvidia-smi to check for NVIDIA GPU
          execSync('nvidia-smi', { stdio: 'pipe' });
          console.log('NVIDIA GPU detected, using hardware acceleration');
          
          // Use NVIDIA hardware acceleration
          encodingOptions.videoCodec = encodingOptions.videoCodec === 'libx265' ? 'hevc_nvenc' : 'h264_nvenc';
          
          // Add log entry
          addTranscodingLog('NVIDIA GPU detected, using hardware acceleration (NVENC)');
        } catch (gpuError) {
          console.log('NVIDIA GPU not detected or drivers not installed, falling back to CPU encoding');
          
          // Try to detect available encoders
          try {
            const encoders = execSync('ffmpeg -encoders', { stdio: 'pipe' }).toString();
            
            // Check for alternative encoders
            if (encoders.includes('h264_vaapi')) {
              console.log('VAAPI encoder detected, using hardware acceleration');
              encodingOptions.videoCodec = 'h264_vaapi';
              addTranscodingLog('Using VAAPI hardware acceleration');
            } else if (encoders.includes('h264_qsv')) {
              console.log('QuickSync encoder detected, using hardware acceleration');
              encodingOptions.videoCodec = 'h264_qsv';
              addTranscodingLog('Using QuickSync hardware acceleration');
            } else if (encoders.includes('h264_amf')) {
              console.log('AMD encoder detected, using hardware acceleration');
              encodingOptions.videoCodec = 'h264_amf';
              addTranscodingLog('Using AMD hardware acceleration');
            } else if (encoders.includes('h264_v4l2m2m')) {
              console.log('V4L2 encoder detected, using hardware acceleration');
              encodingOptions.videoCodec = 'h264_v4l2m2m';
              addTranscodingLog('Using V4L2 hardware acceleration');
            } else {
              // Fall back to CPU encoding
              encodingOptions.videoCodec = encodingOptions.videoCodec === 'libx265' ? 'libx265' : 'libx264';
              addTranscodingLog('No hardware acceleration available, using CPU encoding');
            }
          } catch (encoderError) {
            // Fall back to CPU encoding
            encodingOptions.videoCodec = encodingOptions.videoCodec === 'libx265' ? 'libx265' : 'libx264';
            addTranscodingLog('Error detecting encoders, using CPU encoding');
          }
        }
      } catch (err) {
        console.log('Error checking for GPU, falling back to CPU encoding:', err);
        encodingOptions.videoCodec = encodingOptions.videoCodec === 'libx265' ? 'libx265' : 'libx264';
        addTranscodingLog('Error checking for GPU, using CPU encoding');
      }
    }
    
    for (const video of pendingVideos) {
      try {
        console.log(`Starting transcoding for video: ${video.title} (${video.uuid})`);
        
        // Update status to transcoding
        await updateVideoStatus(video.uuid, 'transcoding', 0);
        
        const videoFolder = path.join(__dirname, '../media', video.path);
        const originalDir = path.join(videoFolder, 'original');
        
        // Ensure directories exist
        if (!fs.existsSync(videoFolder)) {
          fs.mkdirSync(videoFolder, { recursive: true });
          console.log(`Created video folder: ${videoFolder}`);
        }
        
        if (!fs.existsSync(originalDir)) {
          console.error(`Original directory not found: ${originalDir}`);
          await updateVideoStatus(video.uuid, 'error', 0);
          continue;
        }
        
        // Find the first video file in the original directory
        const files = fs.readdirSync(originalDir);
        const videoFile = files.find(file => {
          const ext = path.extname(file).toLowerCase();
          return ['.mp4', '.mkv', '.mov', '.avi', '.webm', '.flv', '.ts'].includes(ext);
        });
        
        if (!videoFile) {
          console.error(`No valid video file found in ${originalDir}`);
          await updateVideoStatus(video.uuid, 'error', 0);
          continue;
        }
        
        const videoPath = path.join(originalDir, videoFile);
        
        // Verify the file exists and is readable
        try {
          fs.accessSync(videoPath, fs.constants.R_OK);
        } catch (err) {
          console.error(`Cannot access video file: ${videoPath}`, err);
          await updateVideoStatus(video.uuid, 'error', 0);
          continue;
        }
        
        // Get the requested transcode quality (if any)
        const requestedQuality = video.transcode_quality || 'all';
        console.log(`Requested transcode quality: ${requestedQuality}`);
        
        // Parse encoding options from the database if available
        let videoEncodingOptions = { ...encodingOptions };
        
        if (video.encoding_options) {
          try {
            // If encoding_options is a string, parse it; otherwise use it directly
            const parsedOptions = typeof video.encoding_options === 'string' 
              ? JSON.parse(video.encoding_options) 
              : video.encoding_options;
            
            videoEncodingOptions = {
              ...encodingOptions,
              ...parsedOptions
            };
          } catch (err) {
            console.error(`Error parsing encoding options for video ${video.uuid}:`, err);
            // Continue with default options
          }
        }
        
        // Check if auto-transcoding is enabled
        if (videoEncodingOptions.autoTranscode) {
          // Start transcoding with the requested quality and encoding options
          await createHLSStream(video.uuid, videoPath, videoFolder, requestedQuality, videoEncodingOptions);
        } else {
          console.log(`Auto-transcoding disabled for video: ${video.title} (${video.uuid})`);
          await updateVideoStatus(video.uuid, 'ready', 100);
        }
        
        console.log(`Transcoding complete for video: ${video.title} (${video.uuid})`);
      } catch (error) {
        console.error(`Error processing video ${video.uuid}:`, error);
        await updateVideoStatus(video.uuid, 'error', 0);
      }
    }
  } catch (err) {
    console.error('Error processing transcoding queue:', err);
  }
};

// Pause transcoding process
const pauseTranscoding = () => {
  if (!activeTranscoding || pausedTranscoding) {
    return { success: false, message: 'No active transcoding process to pause' };
  }
  
  // Check if we have a valid process to pause
  if (!currentFfmpegProcess || !currentFfmpegProcess.pid) {
    addTranscodingLog('Cannot pause: No valid ffmpeg process found', 'error');
    return { success: false, message: 'No valid ffmpeg process found' };
  }
  
  pausedTranscoding = true;
  updateTranscodingStats({ status: 'paused' });
  addTranscodingLog('Attempting to pause transcoding process...', 'info');
  
  // Signal to ffmpeg to pause
  try {
    // Log the PID we're trying to pause
    addTranscodingLog(`Sending SIGSTOP to process with PID: ${currentFfmpegProcess.pid}`, 'info');
    
    // Send SIGSTOP signal to pause the process
    process.kill(currentFfmpegProcess.pid, 'SIGSTOP');
    
    addTranscodingLog('Transcoding process paused successfully', 'info');
    return { success: true, message: 'Transcoding paused' };
  } catch (err) {
    addTranscodingLog(`Error pausing transcoding: ${err.message}`, 'error');
    // Reset the paused state since we failed
    pausedTranscoding = false;
    updateTranscodingStats({ status: 'active' });
    return { success: false, message: `Failed to pause: ${err.message}` };
  }
};

// Resume transcoding process
const resumeTranscoding = () => {
  if (!activeTranscoding || !pausedTranscoding) {
    return { success: false, message: 'No paused transcoding process to resume' };
  }
  
  // Check if we have a valid process to resume
  if (!currentFfmpegProcess || !currentFfmpegProcess.pid) {
    addTranscodingLog('Cannot resume: No valid ffmpeg process found', 'error');
    return { success: false, message: 'No valid ffmpeg process found' };
  }
  
  addTranscodingLog('Attempting to resume transcoding process...', 'info');
  
  // Signal to ffmpeg to resume
  try {
    // Log the PID we're trying to resume
    addTranscodingLog(`Sending SIGCONT to process with PID: ${currentFfmpegProcess.pid}`, 'info');
    
    // Send SIGCONT signal to resume the process
    process.kill(currentFfmpegProcess.pid, 'SIGCONT');
    
    pausedTranscoding = false;
    updateTranscodingStats({ status: 'active' });
    addTranscodingLog('Transcoding process resumed successfully', 'info');
    return { success: true, message: 'Transcoding resumed' };
  } catch (err) {
    addTranscodingLog(`Error resuming transcoding: ${err.message}`, 'error');
    return { success: false, message: `Failed to resume: ${err.message}` };
  }
};

// Reset active transcoding flag when done
const resetTranscoding = () => {
  activeTranscoding = false;
  pausedTranscoding = false;
  currentFfmpegProcess = null;
  updateTranscodingStats({ status: 'idle' });
  addTranscodingLog('Transcoding process completed', 'info');
};

// Export functions
module.exports = {
  processTranscodingQueue,
  createHLSStream,
  generateThumbnail,
  getVideoMetadata,
  updateVideoStatus,
  getTranscodingLogs,
  addTranscodingLog,
  resetTranscoding,
  pauseTranscoding,
  resumeTranscoding
};
