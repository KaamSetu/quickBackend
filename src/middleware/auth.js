import jwt from 'jsonwebtoken';
import Client from '../models/Client.js';
import Worker from '../models/Worker.js';

export const authenticateToken = async (req, res, next) => {
  try {
    // Check for token in Authorization header first (Bearer token)
    let token = null;
    const authHeader = req.headers['authorization'];
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else {
      // Fall back to access_token cookie, then token cookie for backward compatibility
      token = req.cookies.access_token || req.cookies.token;
    }

    if (!token) {
      console.log('No token provided');
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.'
      });
    }

    // Verify the token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      // If token is expired but we have a refresh token, try to refresh
      if (error.name === 'TokenExpiredError' && req.cookies.refresh_token) {
        return refreshAndContinue(req, res, next);
      }
      throw error;
    }

    // Find user based on role
    let user;
    if (decoded.role === 'client') {
      user = await Client.findById(decoded.userId);
    } else if (decoded.role === 'worker') {
      user = await Worker.findById(decoded.userId);
    }

    if (!user || user.isTemporary) {
      console.log('User not found or temporary:', decoded.userId);
      return res.status(401).json({
        success: false,
        message: 'Invalid token.'
      });
    }

    // Block access for users marked as blocked
    if (user.blocked) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been restricted. Contact support for assistance.'
      });
    }

    req.user = {
      userId: user._id,
      role: decoded.role,
      email: user.email.email,
      name: user.name
    };
    
    // Refresh the access token on every API call to extend session
    refreshAccessToken(req, res);

    console.log('User authenticated:', req.user);
    next();
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(401).json({
      success: false,
      message: 'Invalid token.'
    });
  }
};

// Helper function to refresh access token on every API call
const refreshAccessToken = (req, res) => {
  try {
    // Generate a new access token
    const accessToken = jwt.sign(
      { userId: req.user.userId, role: req.user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1h' } // 1 hour
    );
    
    // Set the new access token as a cookie
    res.cookie('access_token', accessToken, {
      httpOnly: process.env.COOKIE_HTTP_ONLY === 'true',
      secure: process.env.COOKIE_SECURE === 'true',
      sameSite: process.env.COOKIE_SAME_SITE || 'none',
      maxAge: 60 * 60 * 1000 // 1 hour
    });
  } catch (error) {
    console.error('Error refreshing access token:', error);
    // Continue with the request even if token refresh fails
  }
};

// Helper function to refresh tokens when access token is expired
const refreshAndContinue = async (req, res, next) => {
  try {
    const refreshToken = req.cookies.refresh_token;
    
    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No refresh token.'
      });
    }
    
    // Verify refresh token
    const decoded = jwt.verify(
      refreshToken,
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET
    );
    
    // Find user based on role
    let user;
    if (decoded.role === 'client') {
      user = await Client.findById(decoded.userId);
    } else if (decoded.role === 'worker') {
      user = await Worker.findById(decoded.userId);
    }
    
    if (!user || user.isTemporary) {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token.'
      });
    }
    
    // Generate new access token
    const accessToken = jwt.sign(
      { userId: user._id, role: decoded.role },
      process.env.JWT_SECRET,
      { expiresIn: '1h' } // 1 hour
    );
    
    // Generate new refresh token
    const newRefreshToken = jwt.sign(
      { userId: user._id, role: decoded.role },
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
      { expiresIn: '7d' } // 7 days
    );
    
    // Set new tokens as cookies
    res.cookie('access_token', accessToken, {
      httpOnly: process.env.COOKIE_HTTP_ONLY === 'true',
      secure: process.env.COOKIE_SECURE === 'true',
      sameSite: process.env.COOKIE_SAME_SITE || 'none',
      maxAge: 60 * 60 * 1000 // 1 hour
    });
    
    res.cookie('refresh_token', newRefreshToken, {
      httpOnly: process.env.COOKIE_HTTP_ONLY === 'true',
      secure: process.env.COOKIE_SECURE === 'true',
      sameSite: process.env.COOKIE_SAME_SITE || 'none',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
    
    // Set user in request
    req.user = {
      userId: user._id,
      role: decoded.role,
      email: user.email.email,
      name: user.name
    };
    
    console.log('Tokens refreshed for user:', req.user);
    next();
  } catch (error) {
    console.error('Error refreshing tokens:', error);
    return res.status(401).json({
      success: false,
      message: 'Invalid refresh token.'
    });
  }
};

// Role-specific middleware
export const requireRole = (role) => {
  return (req, res, next) => {
    if (req.user.role !== role) {
      return res.status(403).json({
        success: false,
        message: `Access denied. ${role} role required.`
      });
    }
    next();
  };
};