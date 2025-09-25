import mongoose from 'mongoose';

const otpSchema = new mongoose.Schema({
  data: {
    type: String,
    required: true // email or phone
  },
  code: {
    type: String,
    required: true
  },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    expires: 0
  },
  attempts: {
    type: Number,
    default: 0,
    max: 3
  },
  resendCount: {
    type: Number,
    default: 0,
    max: 5
  }
}, {
  timestamps: true
});

export default mongoose.model('OTP', otpSchema);