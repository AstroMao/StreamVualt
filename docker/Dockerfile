FROM node:18-alpine

# Install ffmpeg for video transcoding
RUN apk add --no-cache ffmpeg

# Create app directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy app source
COPY . .

# Create necessary directories
RUN mkdir -p media upload

# Expose port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
