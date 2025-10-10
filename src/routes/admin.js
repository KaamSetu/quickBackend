import express from 'express';
import {
  getStats,
  getSkillDistribution,
  getPendingVerifications,
  approveVerification,
  rejectVerification,
  getUsers,
  blockUser,
  unblockUser,
  getJobs,
  getJobsStats,
  getReviews,
  deleteReview,
  verifyAdminPassword
} from '../controllers/adminController.js';

const router = express.Router();

// Public route for admin password verification
router.post('/verify', verifyAdminPassword);

// Dashboard
router.get('/stats', getStats);
router.get('/distribution/skills', getSkillDistribution);

// Aadhaar Verification Center
router.get('/verification/pending', getPendingVerifications);
router.patch('/verification/approve/:id', approveVerification);
router.patch('/verification/reject/:id', rejectVerification);

// User Management
router.get('/users', getUsers);
router.patch('/users/:id/block', blockUser);
router.patch('/users/:id/unblock', unblockUser);

// Job Management
router.get('/jobs', getJobs);
router.get('/jobs/stats', getJobsStats);

// Reviews
router.get('/reviews', getReviews);
router.delete('/reviews/:id', deleteReview);

export default router;