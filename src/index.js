import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Import routes
import authRoutes from './routes/auth.js';
import jobRoutes from './routes/jobs.js';
import workerRoutes from './routes/workers.js';
import clientRoutes from './routes/client.js';
import { log } from 'console';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
// CORS Middleware

const allowedOrigins = [
  'https://kaamsetu.co.in',
  'https://www.kaamsetu.co.in',
  'https://app.kaamsetu.co.in',
];

const corsOptions = {
  origin: function(origin, callback) {
    // allow requests with no origin (like Postman)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS: ' + origin));
  },
  credentials: true, // allow cookies
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['set-cookie'],
};

// Apply CORS to all routes
app.use(cors(corsOptions));

// Handle OPTIONS preflight requests globally
app.options('*', cors(corsOptions));

// Extra fallback for reverse-proxy issues (Render sometimes strips headers)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});


app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Connect to MongoDB
const MONGODB_URI = process.env.MONGODB_URI ;
console.log(MONGODB_URI);
mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// Routes
app.use('/auth', authRoutes);
app.use('/jobs', jobRoutes);
app.use('/workers', workerRoutes);
app.use('/clients', clientRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Kaamsetu API is running',
    timestamp: new Date().toISOString()
  });
});

// // Serve static assets in production
// if (process.env.NODE_ENV === 'production') {
//   app.use(express.static(path.join(__dirname, '../../client/dist')));
  
//   app.get('*', (req, res) => {
//     res.sendFile(path.resolve(__dirname, '../../client/dist/index.html'));
//   });
// }

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Global error handler:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

export default app;