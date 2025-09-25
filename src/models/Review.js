import mongoose from 'mongoose';

const reviewSchema = new mongoose.Schema({
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true
  },
  workerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Worker',
    required: true
  },
  jobId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Job',
    required: true
  },
  reviewType: {
    type: String,
    enum: ['worker-to-client', 'client-to-worker'],
    required: true
  },
  rating: {
    type: Number,
    min: 1,
    max: 5,
    required: true
  },
  review: {
    type: String,
    maxlength: 500
  }
}, {
  timestamps: true
});

export default mongoose.model('Review', reviewSchema);