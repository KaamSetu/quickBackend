import express from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { authenticateToken } from '../middleware/auth.js'
import {
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
} from '../controllers/client.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const router = express.Router()

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../../uploads')
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true })
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir)
  },
  filename: (req, file, cb) => {
    // Generate unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname))
  }
})

const fileFilter = (req, file, cb) => {
  // Check file type
  if (file.fieldname === 'profilePicture') {
    // Allow only image files for profile pictures
    if (file.mimetype.startsWith('image/')) {
      cb(null, true)
    } else {
      cb(new Error('Only image files are allowed for profile pictures'), false)
    }
  } else if (file.fieldname === 'aadhaarDocument') {
    // Allow images and PDFs for Aadhaar documents
    if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
      cb(null, true)
    } else {
      cb(new Error('Only image files and PDFs are allowed for Aadhaar documents'), false)
    }
  } else {
    cb(new Error('Unexpected field'), false)
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
})

// Profile routes
router.get('/profile', authenticateToken, getProfile)
router.put('/profile', authenticateToken, updateProfile)
router.post('/profile-picture', authenticateToken, upload.single('profilePicture'), uploadProfilePicture)

// Statistics route
router.get('/stats', authenticateToken, getStats)

// OTP routes for profile updates
router.post('/send-email-otp', authenticateToken, sendUpdateEmailOtp)
router.post('/send-phone-otp', authenticateToken, sendUpdatePhoneOtp)
router.post('/verify-email-otp', authenticateToken, verifyEmailOtp)
router.post('/verify-phone-otp', authenticateToken, verifyPhoneOtp)

// Security routes
router.post('/change-password', authenticateToken, changePassword)

// Document verification routes
router.post('/aadhaar-verification', authenticateToken, upload.single('aadhaarDocument'), uploadAadhaarDocument)

// Error handling middleware for multer
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File too large. Maximum size is 10MB.'
      })
    }
  }
  
  if (error.message) {
    return res.status(400).json({
      success: false,
      message: error.message
    })
  }
  
  next(error)
})

export default router