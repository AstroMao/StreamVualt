const session = require('express-session');
const bcrypt = require('bcrypt');
const db = require('./db');

// Authentication middleware
const authMiddleware = async (req, res, next) => {
  // Public routes that don't require authentication
  const publicPaths = [
    '/login',
    '/player', 
    '/media',
    '/api/login',
    '/api/videos',
    '/api/video',
    '/api/stream',
    '/css',
    '/js',
    '/favicon.ico'
  ];
  
  // Check if the request path starts with any of the public paths
  const isPublicPath = publicPaths.some(path => 
    req.path === path || 
    req.path.startsWith(path)
  );
  
  if (isPublicPath) {
    return next();
  }
  
  // Check if user is authenticated
  if (req.session && req.session.authenticated) {
    return next();
  }
  
  // If API request, return 401 Unauthorized
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  // Otherwise redirect to login page
  res.redirect('/login');
};

// Login handler
const login = async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    // Get user from database
    const user = await db.getUserByUsername(username);
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    // Check if password is correct
    let passwordMatch = false;
    
    // Check if password is hashed (starts with $2b$ for bcrypt)
    if (user.password.startsWith('$2b$')) {
      // Use bcrypt to compare
      passwordMatch = await bcrypt.compare(password, user.password);
    } else {
      // Legacy plain text comparison (for backward compatibility)
      passwordMatch = (user.password === password);
      
      // If match, hash the password for future logins
      if (passwordMatch) {
        const hashedPassword = await hashPassword(password);
        await db.updateUserPassword(username, hashedPassword);
        console.log(`Password hashed for user: ${username}`);
      }
    }
    
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    // Set session
    req.session.authenticated = true;
    req.session.user = {
      id: user.id,
      username: user.username,
      role: user.role
    };
    
    res.json({ success: true });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'An error occurred during login' });
  }
};

// Logout handler
const logout = (req, res) => {
  req.session.destroy();
  res.redirect('/login');
};

// Hash password
const hashPassword = async (password) => {
  const saltRounds = 10;
  return await bcrypt.hash(password, saltRounds);
};

module.exports = {
  authMiddleware,
  login,
  logout,
  hashPassword
};
