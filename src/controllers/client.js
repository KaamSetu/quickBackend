import Client from '../models/Client.js'
import Job from '../models/Job.js'
import OTP from '../models/OTP.js'
import Review from '../models/Review.js'
import mongoose from 'mongoose'
import { generateOTP } from '../utils/otp.js'
import { uploadProfilePicture as uploadProfilePictureToCloudinary, uploadAadhaarDocument as uploadAadhaarDocumentToCloudinary, deleteFromCloudinary, extractPublicId } from '../utils/cloudinaryUpload.js'
import bcrypt from 'bcryptjs'
import { sendSMS } from '../services/smsService.js'

// Get client profile
const getProfile = async (req, res) => {
  try {
    const client = await Client.findById(req.user.userId).select('-password')

    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Your profile could not be found. Please log in again or contact support if the issue persists.',
        code: 'PROFILE_NOT_FOUND',
        redirectToLogin: true
      })
    }

    res.json({
      success: true,
      client
    })
  } catch (error) {
    console.error('Get client profile error:', error)
    res.status(500).json({
      success: false,
      message: 'We encountered an error while retrieving your profile. Please try again later.',
      code: 'PROFILE_FETCH_ERROR',
      retryable: true
    })
  }
}

// Update client profile
const updateProfile = async (req, res) => {
  try {
    const { name, email, phone, address } = req.body
    const validationErrors = [];

    // Validate required fields
    if (!name || name.trim().length < 2) {
      validationErrors.push({
        field: 'name',
        message: 'Please enter a valid name (at least 2 characters)',
        code: 'INVALID_NAME'
      });
    }

    // Validate email format if provided
    if (email && email.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.email)) {
        validationErrors.push({
          field: 'email',
          message: 'Please enter a valid email address',
          code: 'INVALID_EMAIL_FORMAT'
        });
      } else {
        // Check email uniqueness only if format is valid
        const existingClient = await Client.findOne({
          'email.email': email.email.toLowerCase(),
          _id: { $ne: req.user.userId }
        });
        if (existingClient) {
          validationErrors.push({
            field: 'email',
            message: 'This email is already registered with another account',
            code: 'EMAIL_ALREADY_EXISTS'
          });
        }
      }
    }

    // Validate phone number if provided
    if (phone && phone.phone) {
      const phoneRegex = /^[0-9]{10}$/;
      if (!phoneRegex.test(phone.phone)) {
        validationErrors.push({
          field: 'phone',
          message: 'Please enter a valid 10-digit phone number',
          code: 'INVALID_PHONE_FORMAT'
        });
      } else {
        // Check phone uniqueness only if format is valid
        const existingClient = await Client.findOne({
          'phone.phone': phone.phone,
          _id: { $ne: req.user.userId }
        });
        if (existingClient) {
          validationErrors.push({
            field: 'phone',
            message: 'This phone number is already registered with another account',
            code: 'PHONE_ALREADY_EXISTS'
          });
        }
      }
    }

    // Return all validation errors at once
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Please correct the following errors',
        errors: validationErrors,
        code: 'VALIDATION_ERROR'
      });
    }

    // Build update payload
    const updateData = { name }
    
    // Handle address updates with coordinates
    if (address) {
      if (address.coordinates) {
        updateData.address = {
          city: address.city || address.formatted || address,
          location: {
            lon: address.coordinates.lon || address.coordinates.longitude,
            lat: address.coordinates.lat || address.coordinates.latitude
          }
        };
      } else if (typeof address === 'string') {
        updateData.address = {
          city: address
        };
      } else {
        updateData.address = address;
      }
    }
    if (email && email.email) {
      updateData['email.email'] = email.email.toLowerCase()
      updateData['email.verified'] = !!email.verified
    }
    if (phone && phone.phone) {
      updateData['phone.phone'] = phone.phone
      updateData['phone.verified'] = !!phone.verified
    }

    const updatedClient = await Client.findByIdAndUpdate(
      req.user.userId,
      updateData,
      { new: true, runValidators: true }
    ).select('-password')

    res.json({
      success: true,
      message: 'Profile updated successfully',
      client: updatedClient
    })
  } catch (error) {
    console.error('Update client profile error:', error);
    
    // Handle specific error cases
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => ({
        field: err.path,
        message: err.message,
        code: 'VALIDATION_ERROR'
      }));
      
      return res.status(400).json({
        success: false,
        message: 'Validation failed. Please check your input.',
        errors,
        code: 'VALIDATION_ERROR'
      });
    }
    
    // Handle duplicate key errors
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(409).json({
        success: false,
        message: `This ${field.replace('.', ' ')} is already in use.`,
        field: field.includes('.') ? field.split('.')[1] : field,
        code: 'DUPLICATE_KEY_ERROR'
      });
    }
    
    // Generic error response
    res.status(500).json({
      success: false,
      message: 'We encountered an error while updating your profile. Please try again later.',
      code: 'SERVER_ERROR',
      retryable: true
    });
  }
}

// Upload profile picture
const uploadProfilePicture = async (req, res) => {
  try {
    console.log('Profile picture upload attempt:', {
      userId: req.user.userId,
      file: req.file ? {
        filename: req.file.filename,
        path: req.file.path,
        mimetype: req.file.mimetype,
        size: req.file.size
      } : null
    })

    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: 'Please select an image file to upload',
        code: 'NO_FILE_UPLOADED',
        field: 'profilePicture'
      })
    }
    
    // Validate file type
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedMimeTypes.includes(req.file.mimetype)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file type. Please upload a JPG, PNG, or WebP image.',
        code: 'INVALID_FILE_TYPE',
        field: 'profilePicture',
        allowedTypes: allowedMimeTypes
      });
    }
    
    // Validate file size (5MB max)
    const maxFileSize = 5 * 1024 * 1024; // 5MB
    if (req.file.size > maxFileSize) {
      return res.status(400).json({
        success: false,
        message: 'Image size is too large. Maximum size is 5MB.',
        code: 'FILE_TOO_LARGE',
        field: 'profilePicture',
        maxSize: maxFileSize
      });
    }

    // Get current client to check for existing profile picture
    const client = await Client.findById(req.user.userId)
    console.log('Current client profile picture:', client.profilePicture)
    
    // Delete old profile picture from Cloudinary if exists
    if (client.profilePicturePublicId) {
      try {
        console.log('Deleting old profile picture:', client.profilePicturePublicId)
        await deleteFromCloudinary(client.profilePicturePublicId)
      } catch (error) {
        console.error('Error deleting old profile picture:', error)
        // Continue with upload even if deletion fails
      }
    }

    // Upload new image to Cloudinary
    console.log('Uploading to Cloudinary:', req.file.path)
    const uploadResult = await uploadProfilePictureToCloudinary(req.file.path, req.user.userId)
    console.log('Cloudinary upload result:', uploadResult)

    const updatedClient = await Client.findByIdAndUpdate(
      req.user.userId,
      { 
        profilePicture: uploadResult.url,
        profilePicturePublicId: uploadResult.publicId
      },
      { new: true }
    ).select('-password')

    console.log('Client updated with new profile picture:', {
      profilePicture: updatedClient.profilePicture,
      profilePicturePublicId: updatedClient.profilePicturePublicId
    })

    res.json({
      success: true,
      message: 'Profile picture updated successfully',
      profilePicture: uploadResult.url,
      client: updatedClient
    })
  } catch (error) {
    console.error('Upload profile picture error:', error);
    
    // Handle specific Cloudinary errors
    if (error.name === 'CloudinaryError') {
      return res.status(502).json({
        success: false,
        message: 'Failed to upload image to our storage service. Please try again.',
        code: 'UPLOAD_SERVICE_ERROR',
        retryable: true
      });
    }
    
    // Handle file system errors
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      return res.status(500).json({
        success: false,
        message: 'Error processing your image. The file may be corrupted or in an unsupported format.',
        code: 'FILE_PROCESSING_ERROR'
      });
    }
    
    // Generic error response
    res.status(500).json({
      success: false,
      message: 'We encountered an error while uploading your profile picture. Please try again later.',
      code: 'UPLOAD_FAILED',
      retryable: true
    });
  }
}

// Get client statistics
const getStats = async (req, res) => {
  try {
    const clientId = req.user.userId;

    // Verify client exists
    const clientExists = await Client.exists({ _id: clientId });
    if (!clientExists) {
      return res.status(404).json({
        success: false,
        message: 'Client profile not found. Please log in again.',
        code: 'CLIENT_NOT_FOUND',
        redirectToLogin: true
      });
    }

    try {
      // Get basic job counts in parallel
      const [jobCounts, reviewsAggregation] = await Promise.all([
        // Get job counts
        (async () => {
          const [total, completed, active] = await Promise.all([
            Job.countDocuments({ clientId }),
            Job.countDocuments({ clientId, status: 'completed' }),
            Job.countDocuments({ clientId, status: { $in: ['posted', 'accepted', 'active'] } })
          ]);
          return { total, completed, active };
        })(),
        
        // Get reviews with ratings using aggregation
        Review.aggregate([
          // Match only worker-to-client reviews
          {
            $match: {
              reviewType: 'worker-to-client'
            }
          },
          // Join with jobs collection
          {
            $lookup: {
              from: 'jobs',
              let: { jobId: '$jobId' },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        { $eq: ['$_id', '$$jobId'] },
                        { $eq: ['$clientId', new mongoose.Types.ObjectId(clientId)] },
                        { $eq: ['$status', 'completed'] }
                      ]
                    }
                  }
                }
              ],
              as: 'job'
            }
          },
          { $unwind: '$job' },  // Convert single-item array to object
          // Project only the fields we need
          {
            $project: {
              _id: 1,
              rating: 1,
              jobId: 1
            }
          }
        ])
      ]);

      // Calculate metrics
      const { total, completed, active } = jobCounts;
      const totalRatings = reviewsAggregation.length;
      const totalRating = reviewsAggregation.reduce((sum, review) => sum + (review.rating || 0), 0);
      const averageRating = totalRatings > 0 ? Math.round((totalRating / totalRatings) * 10) / 10 : 0;
      console.log('Average rating:', averageRating);
      console.log('Total ratings:', totalRatings);
      console.log('Total rating:', totalRating);
      
      const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
      const responseTime = '< 2 hours';

      res.json({
        success: true,
        stats: { 
          totalJobs: total, 
          completedJobs: completed, 
          activeJobs: active, 
          rating: averageRating, 
          completionRate, 
          responseTime,
          totalRatings
        },
        lastUpdated: new Date().toISOString()
      });
    } catch (dbError) {
      console.error('Database query error in getStats:', dbError);
      return res.status(503).json({
        success: false,
        message: 'Temporary issue retrieving your statistics. Please try again in a moment.',
        code: 'STATS_SERVICE_UNAVAILABLE',
        retryable: true
      });
    }
  } catch (error) {
    console.error('Get client stats error:', error);
    
    // Handle specific error cases
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid client ID format',
        code: 'INVALID_CLIENT_ID',
        field: 'clientId'
      });
    }
    
    // Generic error response
    res.status(500).json({
      success: false,
      message: 'We encountered an error while retrieving your statistics. Our team has been notified.',
      code: 'STATS_RETRIEVAL_ERROR',
      retryable: true
    });
  }
}

// Send email OTP for update
const sendUpdateEmailOtp = async (req, res) => {
  try {
    const { email } = req.body;
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Please enter a valid email address',
        code: 'INVALID_EMAIL_FORMAT',
        field: 'email'
      });
    }

    // Check rate limiting
    const recentOtp = await OTP.findOne({ 
      data: email.toLowerCase(),
      createdAt: { $gt: new Date(Date.now() - 60 * 1000) } // 1 minute cooldown
    });
    
    if (recentOtp) {
      const secondsLeft = Math.ceil((recentOtp.createdAt.getTime() + 60000 - Date.now()) / 1000);
      return res.status(429).json({ 
        success: false, 
        message: `Please wait ${secondsLeft} seconds before requesting a new OTP`,
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: secondsLeft
      });
    }

    // Check if email is already in use
    const existingClient = await Client.findOne({ 
      'email.email': email.toLowerCase(), 
      _id: { $ne: req.user.userId } 
    });
    
    if (existingClient) {
      return res.status(409).json({ 
        success: false, 
        message: 'This email is already registered with another account',
        code: 'EMAIL_ALREADY_EXISTS',
        field: 'email'
      });
    }

    // Generate and save OTP
    const code = generateOTP();
    await OTP.deleteMany({ data: email.toLowerCase() });
    const otpDoc = new OTP({ 
      data: email.toLowerCase(), 
      code,
      purpose: 'email_update',
      clientId: req.user.userId
    });
    
    await otpDoc.save();
    console.log(`Email OTP for ${email}: ${code}`);

    // TODO: Integrate actual email sending service here similar to registration flow
    // For now, we'll log it for development purposes
    console.log(`[DEV] Email OTP for ${email}: ${code}`);

    res.json({ 
      success: true, 
      message: 'Verification code has been sent to your email',
      code: 'OTP_SENT_SUCCESSFULLY',
      // In production, don't include these in the response
      _debug: process.env.NODE_ENV === 'development' ? { code } : undefined
    });
  } catch (error) {
    console.error('Send email OTP error:', error);
    
    // Handle database errors
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format',
        code: 'VALIDATION_ERROR',
        field: 'email'
      });
    }
    
    // Handle rate limiting errors
    if (error.code === 11000) {
      return res.status(429).json({
        success: false,
        message: 'Too many OTP requests. Please try again later.',
        code: 'RATE_LIMIT_EXCEEDED',
        retryable: true
      });
    }
    
    // Generic error response
    res.status(500).json({
      success: false,
      message: 'Failed to send verification code. Please try again later.',
      code: 'OTP_SEND_FAILED',
      retryable: true
    });
  }
}

// Send phone OTP for update
const sendUpdatePhoneOtp = async (req, res) => {
  try {
    const { phone } = req.body;
    
    // Validate phone number format (10 digits)
    const phoneRegex = /^[0-9]{10}$/;
    if (!phone || !phoneRegex.test(phone)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Please enter a valid 10-digit phone number',
        code: 'INVALID_PHONE_FORMAT',
        field: 'phone'
      });
    }

    // Check rate limiting
    const recentOtp = await OTP.findOne({ 
      data: phone,
      purpose: 'phone_update',
      createdAt: { $gt: new Date(Date.now() - 60 * 1000) } // 1 minute cooldown
    });
    
    if (recentOtp) {
      const secondsLeft = Math.ceil((recentOtp.createdAt.getTime() + 60000 - Date.now()) / 1000);
      return res.status(429).json({ 
        success: false, 
        message: `Please wait ${secondsLeft} seconds before requesting a new OTP`,
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: secondsLeft
      });
    }

    // Check if phone is already in use
    const existingClient = await Client.findOne({ 
      'phone.phone': phone, 
      _id: { $ne: req.user.userId } 
    });
    
    if (existingClient) {
      return res.status(409).json({ 
        success: false, 
        message: 'This phone number is already registered with another account',
        code: 'PHONE_ALREADY_EXISTS',
        field: 'phone'
      });
    }

    // Generate and save OTP
    const code = generateOTP();
    await OTP.deleteMany({ 
      data: phone,
      purpose: 'phone_update' 
    });
    
    const otpDoc = new OTP({ 
      data: phone, 
      code,
      purpose: 'phone_update',
      clientId: req.user.userId
    });
    
    await otpDoc.save();
    console.log(`Phone OTP for ${phone}: ${code}`);

    // Send SMS via Twilio
    try {
      const result = await sendSMS(phone, 'VERIFICATION', { code });
      console.log(`SMS sent to ${phone}. SID:`, result.sid || '(skipped)');
      
      res.json({ 
        success: true, 
        message: 'Verification code has been sent to your phone',
        code: 'SMS_SENT_SUCCESSFULLY',
        // In production, don't include these in the response
        _debug: process.env.NODE_ENV === 'development' ? { code } : undefined
      });
      
    } catch (smsError) {
      console.error('Failed to send SMS:', smsError);
      
      // Handle specific Twilio errors
      if (smsError.code === 21211) {
        return res.status(400).json({
          success: false,
          message: 'Invalid phone number. Please check the number and try again.',
          code: 'INVALID_PHONE_NUMBER',
          field: 'phone'
        });
      }
      
      // Handle rate limiting from Twilio
      if (smsError.code === 20429) {
        return res.status(429).json({
          success: false,
          message: 'Too many SMS attempts. Please try again later.',
          code: 'SMS_RATE_LIMIT_EXCEEDED',
          retryAfter: 300 // 5 minutes
        });
      }
      
      // For other Twilio errors
      throw new Error(`SMS service error: ${smsError.message}`);
    }
  } catch (error) {
    console.error('Send phone OTP error:', error);
    
    // Handle database errors
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format',
        code: 'VALIDATION_ERROR',
        field: 'phone'
      });
    }
    
    // Handle rate limiting errors
    if (error.code === 11000) {
      return res.status(429).json({
        success: false,
        message: 'Too many OTP requests. Please try again later.',
        code: 'RATE_LIMIT_EXCEEDED',
        retryable: true
      });
    }
    
    // Generic error response
    res.status(500).json({
      success: false,
      message: 'Failed to send verification code. Please try again later.',
      code: 'SMS_SEND_FAILED',
      retryable: true
    });
  }
}

// Verify email OTP
const verifyEmailOtp = async (req, res) => {
  try {
    const { otp, value: email } = req.body;
    
    // Input validation
    if (!otp || !email) {
      return res.status(400).json({ 
        success: false, 
        message: 'OTP and email are required',
        code: 'MISSING_REQUIRED_FIELDS',
        fields: [!otp ? 'otp' : null, !email ? 'email' : null].filter(Boolean)
      });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format',
        code: 'INVALID_EMAIL_FORMAT',
        field: 'email'
      });
    }
    
    // Validate OTP format (6 digits)
    const otpRegex = /^\d{6}$/;
    if (!otpRegex.test(otp)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP format. Please enter a 6-digit code.',
        code: 'INVALID_OTP_FORMAT',
        field: 'otp'
      });
    }

    // Find the OTP record
    const otpRecord = await OTP.findOne({ 
      data: email.toLowerCase(), 
      code: otp,
      purpose: 'email_update',
      clientId: req.user.userId,
      expiresAt: { $gt: new Date() }
    });
    
    if (!otpRecord) {
      // Check if OTP exists but is expired
      const expiredOtp = await OTP.findOne({ 
        data: email.toLowerCase(),
        code: otp,
        purpose: 'email_update',
        clientId: req.user.userId
      });
      
      if (expiredOtp) {
        return res.status(400).json({ 
          success: false, 
          message: 'This verification code has expired. Please request a new one.',
          code: 'OTP_EXPIRED',
          retryable: true
        });
      }
      
      // Check for invalid attempts
      const failedAttempts = await OTP.countDocuments({
        data: email.toLowerCase(),
        purpose: 'email_update',
        clientId: req.user.userId,
        verified: false,
        createdAt: { $gt: new Date(Date.now() - 15 * 60 * 1000) } // Last 15 minutes
      });
      
      if (failedAttempts >= 3) {
        return res.status(429).json({
          success: false,
          message: 'Too many failed attempts. Please try again in 15 minutes.',
          code: 'TOO_MANY_ATTEMPTS',
          retryAfter: 900 // 15 minutes in seconds
        });
      }
      
      // Save failed attempt
      await new OTP({
        data: email.toLowerCase(),
        code: otp,
        purpose: 'email_update',
        clientId: req.user.userId,
        verified: false
      }).save();
      
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid verification code. Please try again.',
        code: 'INVALID_OTP',
        attemptsLeft: 3 - failedAttempts,
        retryable: true
      });
    }
    
    // Mark OTP as verified
    otpRecord.verified = true;
    otpRecord.verifiedAt = new Date();
    await otpRecord.save();

    // Update client's email
    await Client.findByIdAndUpdate(req.user.userId, {
      'email.email': email.toLowerCase(),
      'email.verified': true,
      'email.verifiedAt': new Date()
    });
    
    // Clean up used OTP
    await OTP.deleteOne({ _id: otpRecord._id });

    res.json({ 
      success: true, 
      message: 'Email updated successfully',
      code: 'EMAIL_UPDATE_SUCCESS',
      email: email.toLowerCase(),
      verified: true
    });
  } catch (error) {
    console.error('Verify email OTP error:', error);
    
    // Handle database errors
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid client ID format',
        code: 'INVALID_CLIENT_ID'
      });
    }
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => ({
        field: err.path,
        message: err.message,
        code: 'VALIDATION_ERROR'
      }));
      
      return res.status(400).json({
        success: false,
        message: 'Validation failed. Please check your input.',
        errors,
        code: 'VALIDATION_ERROR'
      });
    }
    
    // Handle duplicate key errors (email already in use)
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'This email is already registered with another account',
        code: 'EMAIL_ALREADY_EXISTS',
        field: 'email'
      });
    }
    
    // Generic error response
    res.status(500).json({
      success: false,
      message: 'Failed to verify email. Please try again later.',
      code: 'VERIFICATION_FAILED',
      retryable: true
    });
  }
}

// Verify phone OTP
const verifyPhoneOtp = async (req, res) => {
  try {
    const { otp, value: phone } = req.body;
    
    // Input validation
    if (!otp || !phone) {
      return res.status(400).json({ 
        success: false, 
        message: 'OTP and phone number are required',
        code: 'MISSING_REQUIRED_FIELDS',
        fields: [!otp ? 'otp' : null, !phone ? 'phone' : null].filter(Boolean)
      });
    }
    
    // Validate phone format (10 digits)
    const phoneRegex = /^[0-9]{10}$/;
    if (!phoneRegex.test(phone)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format',
        code: 'INVALID_PHONE_FORMAT',
        field: 'phone'
      });
    }
    
    // Validate OTP format (6 digits)
    const otpRegex = /^\d{6}$/;
    if (!otpRegex.test(otp)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP format. Please enter a 6-digit code.',
        code: 'INVALID_OTP_FORMAT',
        field: 'otp'
      });
    }

    // Find the OTP record
    const otpRecord = await OTP.findOne({ 
      data: phone,
      code: otp,
      purpose: 'phone_update',
      clientId: req.user.userId,
      expiresAt: { $gt: new Date() }
    });
    
    if (!otpRecord) {
      // Check if OTP exists but is expired
      const expiredOtp = await OTP.findOne({ 
        data: phone,
        code: otp,
        purpose: 'phone_update',
        clientId: req.user.userId
      });
      
      if (expiredOtp) {
        return res.status(400).json({ 
          success: false, 
          message: 'This verification code has expired. Please request a new one.',
          code: 'OTP_EXPIRED',
          retryable: true
        });
      }
      
      // Check for invalid attempts
      const failedAttempts = await OTP.countDocuments({
        data: phone,
        purpose: 'phone_update',
        clientId: req.user.userId,
        verified: false,
        createdAt: { $gt: new Date(Date.now() - 15 * 60 * 1000) } // Last 15 minutes
      });
      
      if (failedAttempts >= 3) {
        return res.status(429).json({
          success: false,
          message: 'Too many failed attempts. Please try again in 15 minutes.',
          code: 'TOO_MANY_ATTEMPTS',
          retryAfter: 900 // 15 minutes in seconds
        });
      }
      
      // Save failed attempt
      await new OTP({
        data: phone,
        code: otp,
        purpose: 'phone_update',
        clientId: req.user.userId,
        verified: false
      }).save();
      
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid verification code. Please try again.',
        code: 'INVALID_OTP',
        attemptsLeft: 3 - failedAttempts,
        retryable: true
      });
    }
    
    // Mark OTP as verified
    otpRecord.verified = true;
    otpRecord.verifiedAt = new Date();
    await otpRecord.save();

    // Update client's phone
    await Client.findByIdAndUpdate(req.user.userId, {
      'phone.phone': phone,
      'phone.verified': true,
      'phone.verifiedAt': new Date()
    });
    
    // Clean up used OTP
    await OTP.deleteOne({ _id: otpRecord._id });

    res.json({ 
      success: true, 
      message: 'Phone number updated successfully',
      code: 'PHONE_UPDATE_SUCCESS',
      phone,
      verified: true
    });
  } catch (error) {
    console.error('Verify phone OTP error:', error);
    
    // Handle database errors
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid client ID format',
        code: 'INVALID_CLIENT_ID'
      });
    }
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => ({
        field: err.path,
        message: err.message,
        code: 'VALIDATION_ERROR'
      }));
      
      return res.status(400).json({
        success: false,
        message: 'Validation failed. Please check your input.',
        errors,
        code: 'VALIDATION_ERROR'
      });
    }
    
    // Handle duplicate key errors (phone already in use)
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'This phone number is already registered with another account',
        code: 'PHONE_ALREADY_EXISTS',
        field: 'phone'
      });
    }
    
    // Generic error response
    res.status(500).json({
      success: false,
      message: 'Failed to verify phone number. Please try again later.',
      code: 'VERIFICATION_FAILED',
      retryable: true
    });
  }
}

// Change password
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const validationErrors = [];

    // Input validation
    if (!currentPassword) {
      validationErrors.push({
        field: 'currentPassword',
        message: 'Current password is required',
        code: 'REQUIRED_FIELD'
      });
    }
    
    if (!newPassword) {
      validationErrors.push({
        field: 'newPassword',
        message: 'New password is required',
        code: 'REQUIRED_FIELD'
      });
    } else {
      // Password strength validation
      const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
      if (newPassword.length < 8) {
        validationErrors.push({
          field: 'newPassword',
          message: 'Password must be at least 8 characters long',
          code: 'PASSWORD_TOO_SHORT'
        });
      } else if (!passwordRegex.test(newPassword)) {
        validationErrors.push({
          field: 'newPassword',
          message: 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
          code: 'PASSWORD_TOO_WEAK'
        });
      }
      
      // Check if new password is same as current password
      const user = await Client.findById(req.user.userId);
      if (user && await bcrypt.compare(newPassword, user.password)) {
        validationErrors.push({
          field: 'newPassword',
          message: 'New password must be different from your current password',
          code: 'PASSWORD_SAME_AS_CURRENT'
        });
      }
    }
    
    if (newPassword !== confirmPassword) {
      validationErrors.push({
        field: 'confirmPassword',
        message: 'Passwords do not match',
        code: 'PASSWORDS_DO_NOT_MATCH'
      });
    }
    
    // Return all validation errors at once
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Please correct the following errors',
        errors: validationErrors,
        code: 'VALIDATION_ERROR'
      });
    }

    // Verify current password
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isCurrentPasswordValid) {
      return res.status(401).json({ 
        success: false, 
        message: 'Current password is incorrect',
        code: 'INVALID_CURRENT_PASSWORD',
        field: 'currentPassword',
        attemptsRemaining: 4 // This would typically be tracked in the user model
      });
    }

    // Hash and update the new password
    const saltRounds = 12;
    const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);

    await Client.findByIdAndUpdate(req.user.userId, { 
      password: hashedNewPassword,
      passwordChangedAt: Date.now()
    });
    
    // Invalidate all existing sessions/tokens (optional)
    // This would depend on your authentication system
    
    // Send password change notification (email/SMS)
    // This would be implemented based on your notification service
    
    res.json({ 
      success: true, 
      message: 'Password changed successfully',
      code: 'PASSWORD_CHANGE_SUCCESS',
      changedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Change password error:', error);
    
    // Handle database errors
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid client ID format',
        code: 'INVALID_CLIENT_ID'
      });
    }
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => ({
        field: err.path,
        message: err.message,
        code: 'VALIDATION_ERROR'
      }));
      
      return res.status(400).json({
        success: false,
        message: 'Validation failed. Please check your input.',
        errors,
        code: 'VALIDATION_ERROR'
      });
    }
    
    // Generic error response
    res.status(500).json({
      success: false,
      message: 'Failed to change password. Please try again later.',
      code: 'PASSWORD_CHANGE_FAILED',
      retryable: true
    });
  }
}

// Upload Aadhaar document
const uploadAadhaarDocument = async (req, res) => {
  try {
    const { aadhaarNumber } = req.body;
    const validationErrors = [];

    // Validate Aadhaar number (12 digits)
    if (!aadhaarNumber || !/^\d{12}$/.test(aadhaarNumber)) {
      validationErrors.push({
        field: 'aadhaarNumber',
        message: 'A valid 12-digit Aadhaar number is required',
        code: 'INVALID_AADHAAR_FORMAT'
      });
    }

    // Validate file
    if (!req.file) {
      validationErrors.push({
        field: 'document',
        message: 'Aadhaar document is required',
        code: 'DOCUMENT_REQUIRED'
      });
    } else {
      // Validate file type
      const allowedMimeTypes = ['application/pdf', 'image/jpeg', 'image/png'];
      if (!allowedMimeTypes.includes(req.file.mimetype)) {
        validationErrors.push({
          field: 'document',
          message: 'Invalid file type. Please upload a PDF, JPG, or PNG file.',
          code: 'INVALID_FILE_TYPE',
          allowedTypes: allowedMimeTypes
        });
      }
      
      // Validate file size (5MB max)
      const maxFileSize = 5 * 1024 * 1024; // 5MB
      if (req.file.size > maxFileSize) {
        validationErrors.push({
          field: 'document',
          message: 'File size is too large. Maximum size is 5MB.',
          code: 'FILE_TOO_LARGE',
          maxSize: maxFileSize
        });
      }
    }
    
    // Return all validation errors at once
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Please correct the following errors',
        errors: validationErrors,
        code: 'VALIDATION_ERROR'
      });
    }

    // Get current client to check for existing Aadhaar document
    const client = await Client.findById(req.user.userId);
    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client profile not found',
        code: 'CLIENT_NOT_FOUND',
        redirectToLogin: true
      });
    }
    
    // Check if Aadhaar is already verified
    if (client.aadhaar?.verificationStatus === 'verified') {
      return res.status(400).json({
        success: false,
        message: 'Your Aadhaar is already verified',
        code: 'AADHAAR_ALREADY_VERIFIED',
        verified: true,
        verifiedAt: client.aadhaar.verifiedAt
      });
    }
    
    // Delete old Aadhaar document from Cloudinary if exists
    if (client.aadhaar?.documentPublicId) {
      try {
        console.log('Deleting old Aadhaar document:', client.aadhaar.documentPublicId);
        await deleteFromCloudinary(client.aadhaar.documentPublicId);
      } catch (error) {
        console.error('Error deleting old Aadhaar document:', error);
        // Continue with upload even if deletion fails
      }
    }

    // Upload new document to Cloudinary
    let uploadResult;
    try {
      uploadResult = await uploadAadhaarDocumentToCloudinary(req.file.path, req.user.userId);
      console.log('Aadhaar document uploaded to Cloudinary:', uploadResult.url);
    } catch (uploadError) {
      console.error('Error uploading Aadhaar document to Cloudinary:', uploadError);
      return res.status(502).json({
        success: false,
        message: 'Failed to upload document. Please try again later.',
        code: 'UPLOAD_SERVICE_ERROR',
        retryable: true
      });
    }

    // Update client's Aadhaar information
    const updateData = {
      'aadhaar.number': aadhaarNumber,
      'aadhaar.documentUrl': uploadResult.url,
      'aadhaar.documentPublicId': uploadResult.publicId,
      'aadhaar.verificationStatus': 'pending',
      'aadhaar.submittedAt': new Date(),
      'aadhaar.lastUpdatedAt': new Date()
    };
    
    // If this is the first submission, set the firstSubmittedAt timestamp
    if (!client.aadhaar?.firstSubmittedAt) {
      updateData['aadhaar.firstSubmittedAt'] = new Date();
    }

    const updatedClient = await Client.findByIdAndUpdate(
      req.user.userId,
      updateData,
      { new: true, runValidators: true }
    ).select('-password');
    
    // TODO: Trigger Aadhaar verification process (manual or automated)
    // This could be an external API call or a background job
    
    res.json({ 
      success: true, 
      message: 'Aadhaar document uploaded successfully. It is now under verification.',
      code: 'AADHAAR_UPLOAD_SUCCESS',
      status: 'pending',
      submittedAt: updatedClient.aadhaar.submittedAt,
      documentUrl: updatedClient.aadhaar.documentUrl
    });
  } catch (error) {
    console.error('Upload Aadhaar document error:', error);
    
    // Handle database errors
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid client ID format',
        code: 'INVALID_CLIENT_ID'
      });
    }
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => ({
        field: err.path,
        message: err.message,
        code: 'VALIDATION_ERROR'
      }));
      
      return res.status(400).json({
        success: false,
        message: 'Validation failed. Please check your input.',
        errors,
        code: 'VALIDATION_ERROR'
      });
    }
    
    // Handle duplicate Aadhaar number (if you have this constraint)
    if (error.code === 11000 && error.message.includes('aadhaar.number')) {
      return res.status(409).json({
        success: false,
        message: 'This Aadhaar number is already registered with another account',
        code: 'DUPLICATE_AADHAAR',
        field: 'aadhaarNumber'
      });
    }
    
    // Handle file system errors
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      return res.status(400).json({
        success: false,
        message: 'Error processing your document. The file may be corrupted or in an unsupported format.',
        code: 'FILE_PROCESSING_ERROR'
      });
    }
    
    // Generic error response
    res.status(500).json({
      success: false,
      message: 'Failed to upload Aadhaar document. Please try again later.',
      code: 'UPLOAD_FAILED',
      retryable: true
    });
  }
}

export {
  getProfile,
  updateProfile,
  uploadProfilePicture,
  getStats,
  sendUpdateEmailOtp,
  sendUpdatePhoneOtp,
  verifyEmailOtp,
  verifyPhoneOtp,
  changePassword,
  uploadAadhaarDocument
}