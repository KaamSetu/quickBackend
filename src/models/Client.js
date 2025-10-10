import mongoose from 'mongoose';

const clientSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true
    },
    verified: {
      type: Boolean,
      default: false
    }
  },
  phone: {
    phone: {
      type: String,
      required: true,
      unique: true
    },
    verified: {
      type: Boolean,
      default: false
    }
  },
  aadhaar: {
    number: {
      type: String,
      unique: true,
      sparse: true // Allows multiple null values
    },
    documentUrl: String,
    documentPublicId: String, // Cloudinary public ID for aadhaar document
    verificationStatus: {
      type: String,
      enum: ['pending', 'verified', 'rejected'],
      default: undefined
    },
    submittedAt: Date
  },
  profilePicture: String,
  profilePicturePublicId: String, // Cloudinary public ID for profile picture
  address: {
    city: String,
    location: {
      lon: Number,
      lat: Number
    }
  },
  password: {
    type: String,
    required: true
  },
  blocked: {
    type: Boolean,
    default: false
  },
  isTemporary: {
    type: Boolean,
    default: true // Auto-delete if not verified
  }
}, {
  timestamps: true
});

// Create TTL index for temporary users (expires after 10 minutes)
clientSchema.index({ createdAt: 1 }, {
  expireAfterSeconds: 600,
  partialFilterExpression: { isTemporary: true }
});

// Remove expiration when user is verified
clientSchema.pre('save', function(next) {
  if (!this.isTemporary) {
    this.expireAt = undefined;
  }
  next();
});

export default mongoose.model('Client', clientSchema);