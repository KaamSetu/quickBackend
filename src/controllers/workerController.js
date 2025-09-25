import Worker from '../models/Worker.js';
import Job from '../models/Job.js';
import Review from '../models/Review.js';
import OTP from '../models/OTP.js';
import bcrypt from 'bcryptjs';
import { sendSMS } from '../services/smsService.js';
import { generateOTP } from '../utils/otp.js';
import { uploadProfilePicture as uploadProfilePictureToCloudinary, uploadAadhaarDocument as uploadAadhaarDocumentToCloudinary, deleteFromCloudinary, extractPublicId } from '../utils/cloudinaryUpload.js';

// GET /api/workers/profile
export const getProfile = async (req, res) => {
  try {
    const workerId = req.user.userId;
    
    const worker = await Worker.findById(workerId).select('-password');
    
    if (!worker) {
      return res.status(404).json({
        success: false,
        message: 'Worker profile not found. Please try logging in again or contact support if the issue persists.',
        code: 'WORKER_NOT_FOUND',
        redirectToLogin: true
      });
    }

    res.json({
      success: true,
      worker
    });
  } catch (error) {
    console.error('Error fetching worker profile:', error);
    res.status(500).json({
      success: false,
      message: 'We encountered an error while loading your profile. Please try again later.',
      code: 'PROFILE_FETCH_ERROR',
      retryable: true
    });
  }
};

// PUT /api/workers/profile
export const updateProfile = async (req, res) => {
  try {
    const workerId = req.user.userId;
    const updates = req.body;

    // Remove sensitive fields that shouldn't be updated directly
    delete updates.password;
    delete updates._id;
    delete updates.createdAt;
    delete updates.updatedAt;

    // Handle address updates with coordinates
    if (updates.address) {
      // If address has coordinates, structure it properly
      if (updates.address.coordinates) {
        updates.address = {
          city: updates.address.city || updates.address.formatted || updates.address,
          location: {
            lon: updates.address.coordinates.lon || updates.address.coordinates.longitude,
            lat: updates.address.coordinates.lat || updates.address.coordinates.latitude
          }
        };
      } else if (typeof updates.address === 'string') {
        // If it's just a string, store as city without coordinates
        updates.address = {
          city: updates.address
        };
      }
    }

    const worker = await Worker.findByIdAndUpdate(
      workerId,
      { ...updates, updatedAt: new Date() },
      { new: true, runValidators: true }
    ).select('-password');

    if (!worker) {
      return res.status(404).json({
        success: false,
        message: 'Worker profile not found. Please try logging in again or contact support if the issue persists.',
        code: 'WORKER_NOT_FOUND',
        redirectToLogin: true
      });
    }

    res.json({
      success: true,
      message: 'Profile updated successfully',
      worker
    });
  } catch (error) {
    console.error('Error updating worker profile:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating profile'
    });
  }
};

// POST /api/workers/profile-picture
export const uploadProfilePicture = async (req, res) => {
  try {
    const workerId = req.user.userId;
    
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Please select an image file to upload as your profile picture.',
        code: 'NO_FILE_UPLOADED',
        field: 'profilePicture'
      });
    }

    // Get current worker to check for existing profile picture
    const worker = await Worker.findById(workerId)
    
    // Delete old profile picture from Cloudinary if exists
    if (worker.profilePicturePublicId) {
      try {
        await deleteFromCloudinary(worker.profilePicturePublicId)
      } catch (error) {
        console.error('Error deleting old profile picture:', error)
        // Continue with upload even if deletion fails
      }
    }

    // Upload new image to Cloudinary
    const uploadResult = await uploadProfilePictureToCloudinary(req.file.path, workerId)

    const updatedWorker = await Worker.findByIdAndUpdate(
      workerId,
      { 
        profilePicture: uploadResult.url,
        profilePicturePublicId: uploadResult.publicId
      },
      { new: true }
    ).select('-password');

    if (!updatedWorker) {
      return res.status(404).json({
        success: false,
        message: 'Worker not found'
      });
    }

    res.json({
      success: true,
      message: 'Profile picture updated successfully',
      profilePicture: uploadResult.url
    });
  } catch (error) {
    console.error('Error uploading profile picture:', error);
    
    let errorMessage = 'Failed to upload profile picture. ';
    let errorCode = 'UPLOAD_ERROR';
    
    if (error.message.includes('file type')) {
      errorMessage = 'Unsupported file type. Please upload a JPG, JPEG, or PNG image.';
      errorCode = 'INVALID_FILE_TYPE';
    } else if (error.message.includes('File too large')) {
      errorMessage = 'The image is too large. Please upload an image smaller than 5MB.';
      errorCode = 'FILE_TOO_LARGE';
    } else if (error.message.includes('network')) {
      errorMessage = 'Network error while uploading. Please check your connection and try again.';
      errorCode = 'NETWORK_ERROR';
    }
    
    res.status(500).json({
      success: false,
      message: errorMessage,
      code: errorCode,
      retryable: !['INVALID_FILE_TYPE', 'FILE_TOO_LARGE'].includes(errorCode)
    });
  }
};

// GET /api/workers/stats
export const getStats = async (req, res) => {
  try {
    const workerId = req.user.userId;

    // Get total jobs
    const totalJobs = await Job.countDocuments({ workerId });

    // Get completed jobs
    const completedJobs = await Job.countDocuments({ 
      workerId, 
      status: 'completed' 
    });

    // Calculate completion rate
    const completionRate = totalJobs > 0 ? Math.round((completedJobs / totalJobs) * 100) : 0;

    // Get average rating
    const reviews = await Review.find({ 
      workerId, 
      reviewType: 'client-to-worker' 
    });
    
    const averageRating = reviews.length > 0 
      ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length 
      : 0;

    // Get response time (mock data for now)
    const responseTime = "< 2 hours";

    res.json({
      success: true,
      stats: {
        totalJobs,
        completedJobs,
        completionRate,
        rating: Math.round(averageRating * 10) / 10, // Round to 1 decimal place
        responseTime
      }
    });
  } catch (error) {
    console.error('Error fetching worker stats:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching statistics'
    });
  }
};

// POST /api/workers/send-email-otp
export const sendUpdateEmailOtp = async (req, res) => {
  try {
    const { email } = req.body;
    const workerId = req.user.userId;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email address is required to send verification code',
        code: 'EMAIL_REQUIRED',
        field: 'email'
      });
    }

    // Check if email is already in use by another worker
    const existingWorker = await Worker.findOne({ 
      'email.email': email.toLowerCase(),
      _id: { $ne: workerId }
    });

    if (existingWorker) {
      return res.status(409).json({
        success: false,
        message: 'This email is already associated with another account. Please use a different email address.',
        code: 'EMAIL_IN_USE',
        field: 'email',
        canRetry: true
      });
    }

    // Generate and save OTP
    const code = generateOTP();
    await OTP.deleteMany({ data: email.toLowerCase() });
    const otp = new OTP({ data: email.toLowerCase(), code });
    await otp.save();
    // In production, send via email provider
    console.log(`Email OTP for ${email}: ${code}`);

    res.json({
      success: true,
      message: 'OTP sent to email successfully'
    });
  } catch (error) {
    console.error('Error sending email OTP:', error);
    
    let errorMessage = 'Failed to send verification code. ';
    let errorCode = 'OTP_SEND_ERROR';
    let statusCode = 500;
    
    if (error.message.includes('rate limit')) {
      errorMessage = 'Too many attempts. Please wait a few minutes before requesting another code.';
      errorCode = 'RATE_LIMIT_EXCEEDED';
      statusCode = 429;
    } else if (error.message.includes('network')) {
      errorMessage = 'Network error. Please check your internet connection and try again.';
      errorCode = 'NETWORK_ERROR';
    }
    
    res.status(statusCode).json({
      success: false,
      message: errorMessage,
      code: errorCode,
      retryable: statusCode !== 429
    });
  }
};

// POST /api/workers/send-phone-otp
export const sendUpdatePhoneOtp = async (req, res) => {
  try {
    const { phone } = req.body;
    const workerId = req.user.userId;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required to send verification code',
        code: 'PHONE_REQUIRED',
        field: 'phone'
      });
    }

    // Check if phone is already in use by another worker
    const existingWorker = await Worker.findOne({ 
      'phone.phone': phone,
      _id: { $ne: workerId }
    });

    if (existingWorker) {
      return res.status(409).json({
        success: false,
        message: 'This phone number is already associated with another account. Please use a different number.',
        code: 'PHONE_IN_USE',
        field: 'phone',
        canRetry: true
      });
    }

    // Generate and save OTP
    const code = generateOTP();
    await OTP.deleteMany({ data: phone });
    const otp = new OTP({ data: phone, code });
    await otp.save();

    // Send SMS via Twilio
    try {
      const result = await sendSMS(phone, 'VERIFICATION', { code });
      console.log(`SMS sent to ${phone}. SID:`, result.sid || '(skipped)');
    } catch (smsError) {
      console.error('Failed to send SMS:', smsError);
    
      let errorMessage = 'Failed to send verification code to your phone. ';
      let errorCode = 'SMS_SEND_ERROR';
    
      if (smsError.message.includes('invalid phone number')) {
        errorMessage = 'The phone number you entered is invalid. Please check and try again.';
        errorCode = 'INVALID_PHONE_NUMBER';
      } else if (smsError.message.includes('not a mobile number')) {
        errorMessage = 'Please enter a valid mobile phone number to receive the verification code.';
        errorCode = 'INVALID_MOBILE_NUMBER';
      }
    
      return res.status(400).json({
        success: false,
        message: errorMessage,
        code: errorCode,
        field: 'phone',
        canRetry: true
      });
    }

    res.json({
      success: true,
      message: 'OTP sent to phone successfully'
    });
  } catch (error) {
    console.error('Error sending phone OTP:', error);
    res.status(500).json({
      success: false,
      message: 'Error sending OTP'
    });
  }
};

// POST /api/workers/verify-email-otp
export const verifyEmailOtp = async (req, res) => {
  try {
    const { otp, value: email } = req.body;
    const workerId = req.user.userId;

    if (!otp || !email) {
      const missingFields = [];
      if (!otp) missingFields.push('verification code');
      if (!email) missingFields.push('email address');
      
      return res.status(400).json({
        success: false,
        message: `${missingFields.join(' and ')} ${missingFields.length === 1 ? 'is' : 'are'} required`,
        code: 'MISSING_FIELDS',
        fields: missingFields.map(f => f.includes(' ') ? f.split(' ')[1] : f)
      });
    }

    // Verify OTP
    const otpRecord = await OTP.findOne({
      data: email.toLowerCase(),
      code: otp,
      expiresAt: { $gt: new Date() }
    });

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        message: 'The verification code is invalid or has expired. Please request a new code.',
        code: 'INVALID_OTP',
        canRetry: true
      });
    }

    // Update worker email
    await Worker.findByIdAndUpdate(workerId, {
      'email.email': email.toLowerCase(),
      'email.verified': true
    });

    // Delete used OTP
    await OTP.deleteOne({ _id: otpRecord._id });

    res.json({
      success: true,
      message: 'Email verified and updated successfully'
    });
  } catch (error) {
    console.error('Error verifying email OTP:', error);
    res.status(500).json({
      success: false,
      message: 'Error verifying OTP'
    });
  }
};

// POST /api/workers/verify-phone-otp
export const verifyPhoneOtp = async (req, res) => {
  try {
    const { otp, value: phone } = req.body;
    const workerId = req.user.userId;

    if (!otp || !phone) {
      return res.status(400).json({
        success: false,
        message: 'OTP and phone number are required'
      });
    }

    // Verify OTP
    const otpRecord = await OTP.findOne({
      data: phone,
      code: otp,
      expiresAt: { $gt: new Date() }
    });

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        message: 'The verification code is invalid or has expired. Please request a new code.',
        code: 'INVALID_OTP',
        canRetry: true
      });
    }

    // Update worker phone
    await Worker.findByIdAndUpdate(workerId, {
      'phone.phone': phone,
      'phone.verified': true
    });

    // Delete used OTP
    await OTP.deleteOne({ _id: otpRecord._id });

    res.json({
      success: true,
      message: 'Phone verified and updated successfully'
    });
  } catch (error) {
    console.error('Error verifying phone OTP:', error);
    res.status(500).json({
      success: false,
      message: 'Error verifying OTP'
    });
  }
};

// POST /api/workers/change-password
export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const workerId = req.user.userId;

    if (!currentPassword || !newPassword) {
      const missingFields = [];
      if (!currentPassword) missingFields.push('current password');
      if (!newPassword) missingFields.push('new password');
      
      return res.status(400).json({
        success: false,
        message: `${missingFields.join(' and ')} ${missingFields.length === 1 ? 'is' : 'are'} required`,
        code: 'MISSING_FIELDS',
        fields: missingFields.map(f => f.split(' ')[1])
      });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({
        success: false,
        message: 'New password must be different from your current password',
        code: 'PASSWORD_SAME_AS_CURRENT',
        field: 'newPassword'
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 8 characters long',
        code: 'PASSWORD_TOO_SHORT',
        minLength: 8,
        field: 'newPassword'
      });
    }

    // Get worker with password
    const worker = await Worker.findById(workerId);
    if (!worker) {
      return res.status(404).json({
        success: false,
        message: 'Worker profile not found. Please try logging in again or contact support if the issue persists.',
        code: 'WORKER_NOT_FOUND',
        redirectToLogin: true
      });
    }

    // Verify current password
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, worker.password);
    if (!isCurrentPasswordValid) {
      return res.status(400).json({
        success: false,
        message: 'The current password you entered is incorrect. Please try again.',
        code: 'INVALID_CURRENT_PASSWORD',
        field: 'currentPassword'
      });
    }

    // Hash new password
    const saltRounds = 12;
    const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);

    // Update password
    await Worker.findByIdAndUpdate(workerId, {
      password: hashedNewPassword
    });

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({
      success: false,
      message: 'Error changing password'
    });
  }
};

// POST /api/workers/aadhaar-verification
export const uploadAadhaarDocument = async (req, res) => {
  try {
    const workerId = req.user.userId;
    const { aadhaarNumber } = req.body;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Please upload a clear photo or scan of your Aadhaar card',
        code: 'DOCUMENT_REQUIRED',
        field: 'aadhaarDocument'
      });
    }

    if (!aadhaarNumber) {
      return res.status(400).json({
        success: false,
        message: 'Aadhaar number is required',
        code: 'AADHAAR_REQUIRED',
        field: 'aadhaarNumber'
      });
    }

    // Remove any spaces or dashes from the Aadhaar number
    const cleanAadhaarNumber = aadhaarNumber.replace(/\s|-/g, '');
    
    if (cleanAadhaarNumber.length !== 12 || !/^\d{12}$/.test(cleanAadhaarNumber)) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid 12-digit Aadhaar number without spaces or special characters',
        code: 'INVALID_AADHAAR_FORMAT',
        field: 'aadhaarNumber'
      });
    }

    // Get current worker to check for existing aadhaar document
    const worker = await Worker.findById(workerId)
    
    // Delete old aadhaar document from Cloudinary if exists
    if (worker.aadhaar?.imagePublicId) {
      try {
        await deleteFromCloudinary(worker.aadhaar.imagePublicId)
      } catch (error) {
        console.error('Error deleting old aadhaar document:', error)
        // Continue with upload even if deletion fails
      }
    }

    // Upload new document to Cloudinary
    let uploadResult;
    try {
      uploadResult = await uploadAadhaarDocumentToCloudinary(req.file.path, workerId);
    } catch (uploadError) {
      console.error('Error uploading Aadhaar document:', uploadError);
      
      let errorMessage = 'Failed to upload Aadhaar document. ';
      let errorCode = 'UPLOAD_ERROR';
      
      if (uploadError.message.includes('file type')) {
        errorMessage = 'Unsupported file type. Please upload a JPG, JPEG, or PNG image of your Aadhaar card.';
        errorCode = 'INVALID_FILE_TYPE';
      } else if (uploadError.message.includes('File too large')) {
        errorMessage = 'The file is too large. Please upload an image smaller than 5MB.';
        errorCode = 'FILE_TOO_LARGE';
      } else if (uploadError.message.includes('network')) {
        errorMessage = 'Network error while uploading. Please check your connection and try again.';
        errorCode = 'NETWORK_ERROR';
      }
      
      return res.status(500).json({
        success: false,
        message: errorMessage,
        code: errorCode,
        retryable: !['INVALID_FILE_TYPE', 'FILE_TOO_LARGE'].includes(errorCode)
      });
    }

    // Update worker with Aadhaar information
    await Worker.findByIdAndUpdate(workerId, {
      aadhaar: {
        number: cleanAadhaarNumber,
        image: uploadResult.url,
        imagePublicId: uploadResult.publicId,
        verified: false,
        submittedAt: new Date()
      },
      verificationStatus: 'pending' // Update verification status
    });

    res.json({
      success: true,
      message: 'Aadhaar document submitted successfully. Our team will review your details and verify your account within 24-48 hours.',
      status: 'pending',
      nextSteps: [
        'Keep your original Aadhaar card handy for verification',
        'You will receive a notification once verification is complete',
        'Contact support if you need to update your submitted documents'
      ]
    });
  } catch (error) {
    console.error('Error in Aadhaar verification:', error);
    
    // Handle specific error cases
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation error: ' + errors.join(', '),
        code: 'VALIDATION_ERROR',
        fields: Object.keys(error.errors)
      });
    }
    
    // Handle duplicate key errors
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'This Aadhaar number is already in use. Please contact support if this is an error.',
        code: 'DUPLICATE_AADHAAR',
        supportContactRequired: true
      });
    }
    
    // Generic error response
    res.status(500).json({
      success: false,
      message: 'We encountered an error while processing your Aadhaar verification. Please try again later.',
      code: 'VERIFICATION_ERROR',
      retryable: true
    });
  }
};