import mongoose from 'mongoose';
import { SKILLS } from '../shared/constants.js';

const jobSchema = new mongoose.Schema({
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true
  },
  workerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Worker',
    default: null
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  image: String,
  imagePublicId: String, // Cloudinary public ID for job image
  skill: {
    type: String,
    enum: SKILLS,
    required: true
  },
  urgency: {
    type: Boolean,
    default: false
  },
  address: {
    city: String,
    location: {
      lat: Number,
      lon: Number
    }
  },
  status: {
    type: String,
    enum: ['posted', 'assigned', 'active', 'completed'],
    default: 'posted'
  },
  completionDate: Date,
  completionOTP: {
    type: String,
    default: null
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'completed', 'failed'],
    default: 'pending'
  },
  paymentId: String // Cashfree payment ID
}, {
  timestamps: true
});

export default mongoose.model('Job', jobSchema);