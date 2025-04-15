const basicAuth = require('express-basic-auth');
const fs = require('fs');
const path = require('path');
const db = require('./db');

// Custom authentication function that checks against the database
const customAuthenticator = async (username, password, callback) => {
  try {
    const user = await db.verifyUserCredentials(username, password);
    callback(null, !!user);
  } catch (err) {
    console.error('Authentication error:', err);
    callback(err);
  }
};

// Simple authentication middleware
const auth = basicAuth({
  authorizer: customAuthenticator,
  authorizeAsync: true,
  challenge: true,
  realm: 'Stream Vault Admin Area'
});

// Middleware to check if authentication is required
// This allows public access to the player while protecting admin functions
const conditionalAuth = (req, res, next) => {
  // Public routes that don't require authentication
  const publicPaths = [
    '/',
    '/index.html',
    '/login',
    '/player', 
    '/api/videos',
    '/api/video',
    '/api/stream'
  ];
  
  // Protected paths that require authentication
  const protectedPaths = [
    '/library',
    '/admin'
  ];
  
  // Check if the request path starts with any of the public paths
  const isPublicPath = publicPaths.some(path => 
    req.path === '/' || 
    req.path.startsWith(path) && !req.path.includes('/admin/') && !req.path.includes('/library/')
  );
  
  // Check if the path is explicitly protected
  const isProtectedPath = protectedPaths.some(path => 
    req.path.startsWith(path)
  );
  
  if (isPublicPath && !isProtectedPath) {
    return next();
  }
  
  // For non-public paths, apply authentication
  return auth(req, res, next);
};

module.exports = {
  auth,
  conditionalAuth
};
