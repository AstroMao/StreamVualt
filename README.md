# Stream Vault

A secure video streaming platform with UUID-based URLs for private video sharing.

## Overview

Stream Vault is a lightweight video streaming platform that allows you to:

- Upload and manage video content in multiple formats
- Stream videos using HLS (HTTP Live Streaming)
- Share videos via UUID-based URLs instead of exposing file paths
- Manage videos through a simple authenticated interface

This project is designed to be simple yet functional, focusing on the core features needed for video streaming without unnecessary complexity.

## Features

- **UUID-based URLs**: Videos are accessed via UUIDs rather than direct file paths
- **HLS Streaming**: Videos are served using HTTP Live Streaming for adaptive playback
- **VideoJS Player**: Feature-rich player with quality selection and playback controls
- **Multi-Format Upload**: Support for both regular video files and pre-packaged HLS content
- **Secure Library**: Protected video management interface with authentication
- **Basic Authentication**: Protect admin functions with simple username/password
- **Responsive Design**: Works on desktop and mobile devices

## Project Structure

```
stream-vault/
├── public/              # Static files
│   ├── player/          # VideoJS player
│   ├── library/         # Video management interface (protected)
│   ├── login/           # Authentication page
│   └── index.html       # Home page
├── server/              # Backend code
│   ├── server.js        # Express server
│   ├── auth.js          # Authentication
│   └── video-db.json    # Video metadata storage
├── media/               # Video storage directory
│   └── video_timestamp/ # Each video gets its own directory
│       ├── original/    # Original uploaded videos (for non-HLS)
│       ├── 1080p/       # HLS quality variants (for HLS packages)
│       ├── 720p/
│       ├── 480p/
│       └── master.m3u8  # HLS manifest
├── upload/              # Temporary upload directory
├── package.json         # Project dependencies
└── nginx.conf           # Nginx configuration
```

## Installation

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/stream-vault.git
   cd stream-vault
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create necessary directories:
   ```
   mkdir -p media upload
   ```

4. Update the Nginx configuration:
   - Edit `nginx.conf` to update the paths to your actual directories
   - Copy the configuration to your Nginx sites directory

5. Start the server:
   ```
   npm start
   ```

## Usage

### Accessing the Platform

- **Home Page**: `http://your-server/`
- **Library (Protected)**: `http://your-server/library`
- **Video Player**: `http://your-server/player/{uuid}`

### Authentication

Default login:
- Username: `admin`
- Password: `password`

**Important**: Change these credentials in `server/auth.js` before deploying to production.

### Adding Videos

1. Log in and access the library
2. Click "Upload Video"
3. Fill in the title and description
4. Select a file to upload:
   - Regular video file (MP4, MKV, etc.)
   - Zip file containing HLS package
5. Click "Upload"

### Video Status

- **Ready**: HLS packages are immediately available for streaming
- **Pending Transcode**: Regular video files need transcoding before streaming

### Sharing Videos

After uploading a video, you can share it by copying the player URL from the admin interface. The URL will look like:

```
http://your-server/player/550e8400-e29b-41d4-a716-446655440000
```

## Customization

### Changing Authentication

Edit `server/auth.js` to update the username and password:

```javascript
const auth = basicAuth({
  users: { 'your-username': 'your-password' },
  challenge: true,
  realm: 'Stream Vault Admin Area'
});
```

### Modifying the Player

The VideoJS player can be customized by editing `public/player/index.html`. Refer to the [VideoJS documentation](https://videojs.com/guides/) for more options.

## Future Enhancements

Potential improvements for future versions:

### Transcoding Feature Implementation
- Automated video transcoding for non-HLS uploads
- Multiple quality variants (1080p, 720p, 480p)
- Thumbnail generation from video frames
- Progress tracking for transcoding jobs

### Database Enhancement
- Migration to a proper database system (PostgreSQL, MongoDB)
- Improved metadata storage and retrieval
- Search and filtering capabilities
- Video categorization and tagging
- User management and permissions

### Additional Features
- Adaptive bitrate streaming improvements
- Subtitle and caption support
- Analytics and viewing statistics
- Playlists and collections
- API for third-party integrations

## License

This project is licensed under the MIT License - see the LICENSE file for details.
