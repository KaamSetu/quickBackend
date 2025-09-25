import Client from '../models/Client.js';
import Worker from '../models/Worker.js';
import OTP from '../models/OTP.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';

// POST /api/auth/register
export const register = async (req, res) => {
  try {
    const { name, email, phone, role, password } = req.body;

    console.log('Registration attempt:', { name, email, phone, role });

    // Validate input
    const missingFields = [];
    if (!name) missingFields.push('name');
    if (!email) missingFields.push('email');
    if (!phone) missingFields.push('phone');
    if (!role) missingFields.push('role');
    if (!password) missingFields.push('password');
    
    if (missingFields.length > 0) {
      console.log('Missing required fields:', missingFields);
      const isAre = missingFields.length === 1 ? 'is' : 'are';
      const fields = missingFields.join(', ').replace(/, ([^,]*)$/, ' and $1');
      return res.status(400).json({
        success: false,
        message: `${fields} ${isAre} required`
      });
    }

    // Validate role
    if (!['client', 'worker'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Please select a valid role (client or worker)'
      });
    }

    // Check if user already exists
    const Model = role === 'client' ? Client : Worker;
    const existingUser = await Model.findOne({
      $or: [
        { 'email.email': email.toLowerCase() },
        { 'phone.phone': phone }
      ]
    });

    if (existingUser) {
      if (existingUser.isTemporary) {
        return res.status(400).json({
          success: false,
          message: 'Please complete your registration first. Check your email for the verification link.'
        });
      }
      
      console.log('User already exists:', email);
      const field = existingUser.email.email === email.toLowerCase() ? 'email' : 'phone';
      return res.status(409).json({
        success: false,
        message: `An account with this ${field} already exists. Try logging in or use a different ${field}.`,
        field
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user data
    const userData = {
      name,
      email: { email: email.toLowerCase(), verified: false },
      phone: { phone, verified: false },
      password: hashedPassword,
      isTemporary: true
    };

    // Remove existing temporary user if exists
    if (existingUser && existingUser.isTemporary) {
      await Model.deleteOne({ _id: existingUser._id });
      console.log('Removed existing temporary user');
    }

    // Create new user
    const user = new Model(userData);
    await user.save();
    console.log('Temporary user created:', user._id);

    // Generate OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

    // Remove existing OTP
    await OTP.deleteMany({ data: email.toLowerCase() });

    // Save OTP
    const otp = new OTP({
      data: email.toLowerCase(),
      code: otpCode
    });
    await otp.save();
    console.log('OTP generated and saved');

    // Send OTP email
    await sendOTPEmail(email, otpCode, name);
    console.log('OTP email sent');

    res.json({
      success: true,
      message: 'Registration initiated. Please verify your email.',
      requiresVerification: true
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during registration'
    });
  }
};

// POST /api/auth/verify-otp
export const verifyOTP = async (req, res) => {
  try {
    const { data, code } = req.body;

    console.log('OTP verification attempt:', { data, code });

    if (!data || !code) {
      const missingFields = [];
      if (!data) missingFields.push('email');
      if (!code) missingFields.push('OTP');
      
      return res.status(400).json({
        success: false,
        message: `${missingFields.join(' and ')} ${missingFields.length === 1 ? 'is' : 'are'} required`,
        code: 'MISSING_FIELDS',
        fields: missingFields
      });
    }

    // Find OTP
    const otpRecord = await OTP.findOne({ data: data.toLowerCase() });

    if (!otpRecord) {
      console.log('OTP not found for:', data);
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP',
        code: 'INVALID_OTP'
      });
    }

    // Check attempts
    if (otpRecord.attempts >= 3) {
      await OTP.deleteOne({ _id: otpRecord._id });
      console.log('Max attempts reached for:', data);
      return res.status(400).json({
        success: false,
        message: 'Too many failed attempts. Please register again.',
        code: 'MAX_ATTEMPTS_REACHED'
      });
    }

    // Verify OTP
    if (otpRecord.code !== code) {
      // Increment failed attempts
      otpRecord.attempts += 1;
      await otpRecord.save();
      
      const remainingAttempts = 3 - otpRecord.attempts;
      let message = 'The OTP you entered is incorrect. ';
      
      if (remainingAttempts > 0) {
        message += `You have ${remainingAttempts} ${remainingAttempts === 1 ? 'attempt' : 'attempts'} remaining.`;
      } else {
        message = 'You have used all your OTP attempts. Please request a new code.';
      }
      
      return res.status(400).json({
        success: false,
        message,
        code: 'INCORRECT_OTP',
        remainingAttempts,
        canRetry: remainingAttempts > 0
      });
    }

    // Find user in both collections
    let user = await Client.findOne({ 'email.email': data.toLowerCase() });
    let role = 'client';

    if (!user) {
      user = await Worker.findOne({ 'email.email': data.toLowerCase() });
      role = 'worker';
    }

    if (!user) {
      console.log('User not found during OTP verification:', data);
      // Don't reveal that the email doesn't exist for security reasons
      console.log('Password reset requested for non-existent email:', email);
      return res.status(200).json({
        success: true,
        message: 'If an account exists with this email, you will receive a password reset link.'
      });
    }

    // Make user permanent and verify email
    user.isTemporary = false;
    user.email.verified = true;
    await user.save();
    console.log('User verified and made permanent:', user._id);

    // Clean up OTP
    await OTP.deleteOne({ _id: otpRecord._id });

    // Generate access token (short-lived)
    const accessToken = jwt.sign(
      { userId: user._id, role },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    
    // Generate refresh token (long-lived)
    const refreshToken = jwt.sign(
      { userId: user._id, role },
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Set access token cookie
    res.cookie('access_token', accessToken, {
      httpOnly: process.env.COOKIE_HTTP_ONLY === 'true',
      secure: process.env.COOKIE_SECURE === 'true',
      sameSite: process.env.COOKIE_SAME_SITE || 'none',
      maxAge: 60 * 60 * 1000 // 1 hour
    });
    
    // Set refresh token cookie
    res.cookie('refresh_token', refreshToken, {
      httpOnly: process.env.COOKIE_HTTP_ONLY === 'true',
      secure: process.env.COOKIE_SECURE === 'true',
      sameSite: process.env.COOKIE_SAME_SITE || 'none',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    res.json({
      success: true,
      message: 'Email verified successfully',
      user: {
        id: user._id,
        name: user.name,
        email: user.email.email,
        role
      },
      role
    });

  } catch (error) {
    console.error('OTP verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during verification'
    });
  }
};

// POST /api/auth/logout
export const logout = async (req, res) => {
  try {
    // Clear all auth cookies
    res.clearCookie('token');
    res.clearCookie('access_token');
    res.clearCookie('refresh_token');
    
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Error during logout'
    });
  }
};

// GET /api/auth/verify
export const verifyAuth = async (req, res) => {
  try {
    // Get access token from cookie
    const accessToken = req.cookies.access_token || req.cookies.token;
    
    if (!accessToken) {
      return res.status(401).json({
        success: false,
        message: 'Not authenticated'
      });
    }
    
    try {
      // Verify the token
      const decoded = jwt.verify(accessToken, process.env.JWT_SECRET);
      
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
          message: 'Invalid token'
        });
      }
      
      // User is authenticated
      return res.json({
        success: true,
        user: {
          id: user._id,
          name: user.name,
          email: user.email.email,
          role: decoded.role,
          profilePicture: user.profilePicture
        }
      });
    } catch (error) {
      // If token is expired but we have a refresh token, try to refresh
      if (error.name === 'TokenExpiredError' && req.cookies.refresh_token) {
        // Call refreshToken function
        return refreshToken(req, res);
      }
      
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
  } catch (error) {
    console.error('Auth verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Error verifying authentication'
    });
  }
};

// POST /api/auth/refresh-token
export const refreshToken = async (req, res) => {
  try {
    // Get refresh token from cookie
    const refreshToken = req.cookies.refresh_token;
    
    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token is required'
      });
    }
    
    // Verify refresh token
    const decoded = jwt.verify(
      refreshToken,
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET
    );
    
    // Find user
    let user;
    if (decoded.role === 'client') {
      user = await Client.findById(decoded.userId);
    } else if (decoded.role === 'worker') {
      user = await Worker.findById(decoded.userId);
    }
    
    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'This password reset link is invalid or has expired. Please request a new one.',
        code: 'INVALID_OR_EXPIRED_TOKEN',
        canRetry: true
      });
    }
    
    // Generate new access token
    const accessToken = jwt.sign(
      { userId: user._id, role: decoded.role },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    
    // Generate new refresh token
    const newRefreshToken = jwt.sign(
      { userId: user._id, role: decoded.role },
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    // Common cookie options from environment variables
    const cookieOptions = {
      httpOnly: process.env.COOKIE_HTTP_ONLY === 'true',
      secure: process.env.COOKIE_SECURE === 'true',
      sameSite: process.env.COOKIE_SAME_SITE || 'none',
      domain: process.env.COOKIE_DOMAIN || 'localhost',
      path: '/',
    };
    
    // In production, ensure secure and sameSite are properly set
    if (process.env.NODE_ENV === 'production') {
      cookieOptions.secure = true;
      if (process.env.COOKIE_SAME_SITE === 'none') {
        cookieOptions.sameSite = 'none';
      }
    }

    // Set access token cookie
    res.cookie('access_token', accessToken, {
      ...cookieOptions,
      maxAge: 60 * 60 * 1000, // 1 hour
    });
    
    // Set refresh token cookie
    res.cookie('refresh_token', newRefreshToken, {
      ...cookieOptions,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });
    
    res.json({
      success: true,
      message: 'Token refreshed successfully'
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(401).json({
      success: false,
      message: 'Invalid refresh token'
    });
  }
};

// POST /api/auth/login
export const login = async (req, res) => {
  try {
    const { data, password, rememberMe } = req.body;

    console.log('Login attempt:', { data, rememberMe });

    if (!data || !password) {
      const missingFields = [];
      if (!data) missingFields.push('email/phone');
      if (!password) missingFields.push('password');
      
      return res.status(400).json({
        success: false,
        message: `${missingFields.join(' and ')} ${missingFields.length === 1 ? 'is' : 'are'} required`
      });
    }

    // Find user in both collections
    let user = await Client.findOne({
      $or: [
        { 'email.email': data.toLowerCase() },
        { 'phone.phone': data }
      ]
    });
    let role = 'client';

    if (!user) {
      user = await Worker.findOne({
        $or: [
          { 'email.email': data.toLowerCase() },
          { 'phone.phone': data }
        ]
      });
      role = 'worker';
    }

    if (user && user.isTemporary) {
      console.log('Temporary user found, please complete registration:', data);
      return res.status(401).json({
        success: false,
        message: 'Please complete your registration first. Check your email for the verification link.',
        code: 'REGISTRATION_INCOMPLETE'
      });
    }
    
    if (!user) {
      console.log('User not found:', data);
      return res.status(404).json({
        success: false,
        message: 'No account found with this email/phone. Please check your details or sign up.',
        code: 'USER_NOT_FOUND'
      });
    }

    // Check if email is verified
    if (!user.email.verified) {
      return res.status(403).json({
        success: false,
        message: 'Please verify your email before logging in. Check your inbox for the verification link or request a new one.',
        code: 'EMAIL_NOT_VERIFIED'
      });
    }

    // Check password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      console.log('Invalid password for user:', user._id);
      return res.status(401).json({
        success: false,
        message: 'Incorrect password. Please try again or reset your password.',
        code: 'INVALID_CREDENTIALS',
        remainingAttempts: 4 // This should be implemented based on your security requirements
      });
    }

    // Generate access token (short-lived)
    const accessToken = jwt.sign(
      { userId: user._id, role },
      process.env.JWT_SECRET,
      { expiresIn: '1h' } // 1 hour
    );
    
    // Generate refresh token (long-lived)
    const refreshToken = jwt.sign(
      { userId: user._id, role },
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
      { expiresIn: rememberMe ? '30d' : '7d' }
    );

    // Set access token as HTTP-only cookie
    res.cookie('access_token', accessToken, {
      httpOnly: process.env.COOKIE_HTTP_ONLY === 'true',
      secure: process.env.COOKIE_SECURE === 'true',
      sameSite: process.env.COOKIE_SAME_SITE || 'none',
      maxAge: 60 * 60 * 1000 // 1 hour
    });
    
    // Set refresh token as HTTP-only cookie
    res.cookie('refresh_token', refreshToken, {
      httpOnly: process.env.COOKIE_HTTP_ONLY === 'true',
      secure: process.env.COOKIE_SECURE === 'true',
      sameSite: process.env.COOKIE_SAME_SITE || 'none',
      maxAge: rememberMe ? 30 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000 // 30 or 7 days
    });

    console.log('Login successful for user:', user._id);

    res.json({
      success: true,
      message: 'Login successful',
      user: {
        id: user._id,
        name: user.name,
        email: user.email.email,
        role,
        profilePicture: user.profilePicture
      },
      role
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
};

// Email service function
const sendOTPEmail = async (email, otp, name) => {
  try {
    // Configure your email transporter
    const transporter = nodemailer.createTransport({
      service: 'gmail', // or your email service
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Verify Your Email - Kaamsetu',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Welcome to Kaamsetu, ${name}!</h2>
          <p>Your OTP for email verification is:</p>
          <div style="background: #f4f4f4; padding: 20px; text-align: center; font-size: 24px; font-weight: bold; color: #333; border-radius: 5px;">
            ${otp}
          </div>
          <p style="color: #666; margin-top: 20px;">This OTP will expire in 10 minutes.</p>
          <p style="color: #666;">If you didn't request this, please ignore this email.</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log('OTP email sent successfully to:', email);
  } catch (error) {
    console.error('Error sending OTP email:', error);
    throw error;
  }
};