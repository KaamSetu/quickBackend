import express from 'express';
import { register, verifyOTP, login, logout, refreshToken, verifyAuth } from '../controllers/authController.js';

const router = express.Router();

// POST /api/auth/register
router.post('/register', register);

// POST /api/auth/verify-otp
router.post('/verify-otp', verifyOTP);

// POST /api/auth/login
router.post('/login', login);

// POST /api/auth/logout
router.post('/logout', logout);

// POST /api/auth/refresh-token
router.post('/refresh-token', refreshToken);

// GET /api/auth/verify
router.get('/verify', verifyAuth);

export default router;