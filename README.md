# Stream Vault

A simple video streaming platform with UUID-based URLs for secure video sharing.

## Overview

Stream Vault is a lightweight video streaming platform that allows you to:

- Upload and manage video content
- Stream videos using HLS (HTTP Live Streaming)
- Share videos via UUID-based URLs instead of exposing file paths
- Manage videos through a simple admin interface.

This project is designed to be simple yet functional, focusing on the core features needed for video streaming without unnecessary complexity.

## Features

- **UUID-based URLs**: Videos are accessed via UUIDs rather than direct file paths
- **HLS Streaming**: Videos are served using HTTP Live Streaming for adaptive playback
- **VideoJS Player**: Feature-rich player with quality selection and playback controls
- **Simple Admin Interface**: Upload, edit, and delete videos
- **Basic Authentication**: Protect admin functions with simple username/password
- **Responsive Design**: Works on desktop and mobile devices

## Project Structure

```
stream-vault/
├── public/              # Static files
│   ├── player/          # VideoJS player
│   ├── admin/           # Admin interface
│   └── index.html       # Home page
├── server/              # Backend code
│   ├── server.js        # Express server
│   ├── auth.js          # Authentication
│   └── video-db.json    # Video metadata storage
├── media/               # Video storage directory
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
- **Admin Interface**: `http://your-server/admin`
- **Video Player**: `http://your-server/player/{uuid}`

### Admin Credentials

Default login:
- Username: `admin`
- Password: `password`

**Important**: Change these credentials in `server/auth.js` before deploying to production.

### Adding Videos

1. Access the admin interface
2. Click "Upload New Video"
3. Fill in the title and description
4. Select a video file to upload
5. Click "Upload"

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

- Automated video transcoding
- Thumbnail generation
- User accounts and permissions
- Advanced analytics
- Playlists and categories

## License

This project is licensed under the MIT License - see the LICENSE file for details.
