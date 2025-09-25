import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import {
  createJob,
  getClientJobs,
  cancelJob,
  startJob,
  completeJob,
  rateWorker,
  getAvailableJobs,
  acceptJob,
  getWorkerJobs,
  getCompletionOTP,
  rateClient,
  cancelJobByWorker
} from '../controllers/jobController.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const router = express.Router();

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for job image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  if (file.fieldname === 'image') {
    // Allow only image files for job images
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed for job images'), false);
    }
  } else {
    cb(new Error('Unexpected field'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Client routes
router.post('/create', authenticateToken, requireRole('client'), upload.single('image'), createJob);
router.get('/client', authenticateToken, requireRole('client'), getClientJobs);
router.put('/:jobId/cancel', authenticateToken, requireRole('client'), cancelJob);
router.put('/:jobId/start', authenticateToken, requireRole('client'), startJob);
router.post('/:jobId/complete', authenticateToken, requireRole('client'), completeJob); // Client verifies OTP to complete job
router.post('/:jobId/rate-worker', authenticateToken, requireRole('client'), rateWorker);

// Worker routes
router.get('/available', authenticateToken, requireRole('worker'), getAvailableJobs);
router.post('/:jobId/accept', authenticateToken, requireRole('worker'), acceptJob);
router.put('/:jobId/cancel-worker', authenticateToken, requireRole('worker'), cancelJobByWorker);
router.get('/worker', authenticateToken, requireRole('worker'), getWorkerJobs);
router.get('/:jobId/generate-otp', authenticateToken, requireRole('worker'), getCompletionOTP); // Worker generates OTP
router.post('/:jobId/rate-client', authenticateToken, requireRole('worker'), rateClient);

// Error handling middleware for multer
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File too large. Maximum size is 10MB.'
      });
    }
  }
  
  if (error.message) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
  
  next(error);
});

export default router;