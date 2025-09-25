import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
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
} from '../controllers/workerController.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadsDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'profilePicture') {
      // Allow only image files for profile picture
      if (file.mimetype.startsWith('image/')) {
        cb(null, true);
      } else {
        cb(new Error('Only image files are allowed for profile picture'));
      }
    } else if (file.fieldname === 'aadhaarDocument') {
      // Allow images and PDFs for Aadhaar document
      if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
        cb(null, true);
      } else {
        cb(new Error('Only image files and PDFs are allowed for Aadhaar document'));
      }
    } else {
      cb(new Error('Unexpected field'));
    }
  }
});

// All routes require authentication and worker role
router.use(authenticateToken);
router.use(requireRole('worker'));

// Profile routes
router.get('/profile', getProfile);
router.put('/profile', updateProfile);
router.post('/profile-picture', upload.single('profilePicture'), uploadProfilePicture);

// Statistics
router.get('/stats', getStats);

// OTP verification for profile updates
router.post('/send-email-otp', sendUpdateEmailOtp);
router.post('/send-phone-otp', sendUpdatePhoneOtp);
router.post('/verify-email-otp', verifyEmailOtp);
router.post('/verify-phone-otp', verifyPhoneOtp);

// Password change
router.post('/change-password', changePassword);

// Aadhaar verification
router.post('/aadhaar-verification', upload.single('aadhaarDocument'), uploadAadhaarDocument);

export default router;