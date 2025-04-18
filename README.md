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
- **Nginx Integration**: Serves static files and proxies requests to the Node.js server

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
├── docker/              # Docker-relate
│   ├── nginx.conf           # Nginx configuration
│   ├── Dockerfile           # Node.js application Dockerfile
│   ├── Dockerfile.nginx     # Nginx Dockerfile
│   └── docker-compose.yml   # Docker Compose configuration
├── upload/              # Temporary upload directory
└── package.json         # Project dependencies
```

## Installation

### Standard Installation

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

4. Update the Nginx configuration (optional):
   - Edit `nginx.conf` to update the paths to your actual directories
   - Copy the configuration to your Nginx sites directory

5. Start the server:
   ```
   npm start
   ```

### Container Installation (Docker or Podman)

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/stream-vault.git
   cd stream-vault
   ```

2. Create a `.env` file based on `.env.example`:
   ```
   cp .env.example .env
   ```

3. Configure the environment variables in the `.env` file:
   - Set `NGINX_PORT` to specify the port Nginx will listen on (default: 8080)
   - Set other variables as needed for your environment

#### Using Docker

4. Build and start the containers using npm scripts:
   ```
   npm run docker:build
   npm run docker:up
   ```
   
   Or directly with Docker Compose:
   ```
   docker-compose up -d
   ```

5. The application will be available at http://localhost:8080 (or the port you specified in NGINX_PORT)

6. To stop the containers:
   ```
   npm run docker:down
   ```
   
   Or directly with Docker Compose:
   ```
   docker-compose down
   ```

7. To view logs:
   ```
   npm run docker:logs
   ```
   
   Or directly with Docker Compose:
   ```
   docker-compose logs -f
   ```

#### Using Podman

4. Install podman-compose if you don't have it already:
   ```
   npm run podman:install
   ```
   
   Or install it manually:
   ```
   pip3 install podman-compose
   ```

5. Build and start the containers using npm scripts:
   ```
   npm run podman:build
   npm run podman:up
   ```
   
   Or directly with Podman Compose:
   ```
   podman-compose up -d
   ```

6. The application will be available at http://localhost:8080 (or the port you specified in NGINX_PORT)

7. To stop the containers:
   ```
   npm run podman:down
   ```
   
   Or directly with Podman Compose:
   ```
   podman-compose down
   ```

8. To view logs:
   ```
   npm run podman:logs
   ```
   
   Or directly with Podman Compose:
   ```
   podman-compose logs -f
   ```

> **Note**: Podman is a daemonless container engine that's compatible with Docker images and Docker Compose files. It's a good alternative if you prefer a rootless container solution.

### Migrating from JSON to PostgreSQL

If you're upgrading from a previous version that used JSON file storage, you can migrate your data to PostgreSQL:

1. Install PostgreSQL and make sure it's running
2. Update your environment variables or db.js configuration to connect to your PostgreSQL instance
3. Run the migration script:
   ```
   npm run migrate
   ```
   
   Or directly:
   ```
   node scripts/migrate-to-postgres.js
   ```
   
4. The script will:
   - Transfer all videos and users to the PostgreSQL database
   - Create a backup of your original JSON database file
   - Log the migration process

## Usage

### Accessing the Platform

- **Home Page**: `http://your-server/`
- **Library (Protected)**: `http://your-server/library`
- **Video Player**: `http://your-server/player/{uuid}`

### Authentication

The system uses secure session-based authentication with bcrypt password hashing. During database initialization, two default users are created:
- Username: `admin`, Password: `admin123`, Role: `admin`

The first time you log in with these credentials, the passwords will be automatically hashed for security.

To change your password:
1. Log in to the system
2. Go to Settings > Account
3. Use the Change Password form

For advanced user management:
1. Connect to your PostgreSQL database
2. Use the `users` table to modify existing users or add new ones
3. Passwords are securely hashed using bcrypt
4. You can use the `scripts/hash-admin-password.js` script to pre-hash passwords before deployment:
   ```
   node scripts/hash-admin-password.js
   ```

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

To add or modify users:

1. Connect to your PostgreSQL database
2. Insert or update records in the `users` table:

```sql
-- Add a new user
INSERT INTO users (username, password, role) 
VALUES ('new_username', 'initial_password', 'admin');

-- Then use the password hashing script to secure the password:
node scripts/hash-admin-password.js
```

Alternatively, you can use the Settings page to change your password after logging in.

### Modifying the Player

The VideoJS player can be customized by editing `public/player/index.html`. Refer to the [VideoJS documentation](https://videojs.com/guides/) for more options.

### Configuring Nginx

The Nginx configuration can be customized by editing the `nginx.conf` file. When using Docker, you can change the port Nginx listens on by setting the `NGINX_PORT` environment variable in your `.env` file (default is 8080).

## Future Enhancements

Potential improvements for future versions:

### Transcoding Feature Implementation
- Automated video transcoding for non-HLS uploads ✅
- Multiple quality variants (1080p, 720p, 480p) ✅
- Thumbnail generation from video frames ✅
- Progress tracking for transcoding jobs ✅
- Video upload date display in library view ✅

### Database Enhancement
- Migration to a proper database system (PostgreSQL) ✅
- Improved metadata storage and retrieval ✅
- Search and filtering capabilities
- Video categorization and tagging
- User management and permissions

### Containerization
- Docker setup for easy deployment ✅
- Docker Compose for orchestration ✅
- Nginx integration for serving static files ✅
- Production-ready configuration ✅

### Additional Features
- Adaptive bitrate streaming improvements
- Subtitle and caption support
- Analytics and viewing statistics
- Playlists and collections
- API for third-party integrations

## License

This project is licensed under the MIT License - see the LICENSE file for details.
