import Job from '../models/Job.js';
import Client from '../models/Client.js';
import Worker from '../models/Worker.js';
import Review from '../models/Review.js';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { uploadJobImage, deleteFromCloudinary, extractPublicId } from '../utils/cloudinaryUpload.js';
import { calculateJobDistances, isValidCoordinates } from '../utils/distance.js';

// POST /api/jobs/create
export const createJob = async (req, res) => {
  try {
    const { skill, title, description, urgency } = req.body;
    let { address } = req.body;
    const clientId = req.user.userId; // From auth middleware

    console.log('Job creation attempt:', { clientId, skill, title });

    if (!skill || !title || !description) {
      return res.status(400).json({
        success: false,
        message: 'Skill, title, and description are required'
      });
    }

    // Parse address if it's a JSON string (from FormData)
    if (typeof address === 'string') {
      try {
        address = JSON.parse(address);
      } catch (parseError) {
        console.error('Error parsing address:', parseError);
        return res.status(400).json({
          success: false,
          message: 'Invalid address format'
        });
      }
    }

    if (!address || (!address.city && !address.location)) {
      return res.status(400).json({
        success: false,
        message: 'Address is required for job posting'
      });
    }

    // Create job data
    const jobData = {
      clientId,
      title,
      description,
      skill,
      urgency: urgency || false,
      status: 'posted',
      address
    };

    // Create job first to get the actual job ID
    const job = new Job(jobData);
    await job.save();
    console.log('Job created:', job._id);

    // Handle image upload if file is provided - upload directly with job ID
    if (req.file) {
      try {
        const uploadResult = await uploadJobImage(req.file.path, job._id.toString());
        job.image = uploadResult.url;
        job.imagePublicId = uploadResult.publicId;
        await job.save();
        console.log('Image uploaded for job:', job._id);
      } catch (uploadError) {
        console.error('Image upload error:', uploadError);
        // Don't fail the entire job creation if image upload fails
        console.log('Job created without image due to upload error');
      }
    }

    // TODO: Integrate Cashfree payment here
    // For now, we'll simulate successful payment
    job.paymentStatus = 'completed';
    job.paymentId = `pay_${crypto.randomUUID()}`;
    await job.save();

    console.log('Job posted successfully with payment');

    res.json({
      success: true,
      message: 'Job posted successfully',
      job: {
        id: job._id,
        title: job.title,
        status: job.status,
        image: job.image
      }
    });

  } catch (error) {
    console.error('Job creation error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while creating job'
    });
  }
};

// GET /api/jobs/client - Fetch jobs for client dashboard
export const getClientJobs = async (req, res) => {
  try {
    const clientId = req.user.userId;
    const { page = 1, limit = 10, status } = req.query;

    console.log('Fetching client jobs:', { clientId, page, limit, status });

    // Build query
    const query = { clientId };
    if (status && status !== 'all') {
      query.status = status;
    }

    // Execute query with pagination
    const skip = (page - 1) * limit;
    const jobs = await Job.find(query)
      .populate('workerId', 'name email.email phone.phone profilePicture skills')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean(); // Convert to plain JavaScript objects

    const total = await Job.countDocuments(query);

    // Get all job IDs to fetch their ratings in a single query
    const jobIds = jobs.map(job => job._id);
    
    // Get all reviews for these jobs
    const reviews = await Review.find({
      jobId: { $in: jobIds },
      reviewType: 'client-to-worker'
    });

    // Create a map of jobId to its review
    const reviewMap = new Map();
    reviews.forEach(review => {
      reviewMap.set(review.jobId.toString(), {
        rating: review.rating,
        review: review.review,
        createdAt: review.createdAt
      });
    });

    // Add review info to each job
    const jobsWithRatings = jobs.map(job => {
      const review = reviewMap.get(job._id.toString());
      return {
        ...job,
        workerRating: review?.rating || 0,
        workerReview: review?.review || "",
        reviewDate: review?.createdAt || null
      };
    });

    // Get job statistics
    const stats = await Job.aggregate([
      { $match: { clientId: new mongoose.Types.ObjectId(clientId) } },
      { $group: {
        _id: '$status',
        count: { $sum: 1 }
      }}
    ]);

    console.log(`Found ${jobs.length} jobs for client ${clientId}`);

    res.json({
      success: true,
      jobs: jobsWithRatings,
      stats,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Error fetching client jobs:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching jobs'
    });
  }
};

// PUT /api/jobs/:jobId/cancel
export const cancelJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    const clientId = req.user.userId;

    console.log('Job deletion attempt:', { jobId, clientId });

    const job = await Job.findOne({ _id: jobId, clientId });

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    // Only allow cancellation of posted or assigned jobs
    if (!['posted', 'assigned'].includes(job.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel a job that is already ${job.status}`
      });
    }

    // Delete job image from Cloudinary if exists
    if (job.imagePublicId) {
      try {
        await deleteFromCloudinary(job.imagePublicId);
      } catch (error) {
        console.error('Error deleting job image from Cloudinary:', error);
        // Continue with deletion even if image deletion fails
      }
    }

    // Delete the job from database
    await Job.findByIdAndDelete(jobId);

    console.log('Job deleted successfully:', jobId);

    res.json({
      success: true,
      message: 'Job cancelled successfully',
      job: {
        id: job._id,
        status: job.status
      }
    });

  } catch (error) {
    console.error('Job cancellation error:', error);
    res.status(500).json({
      success: false,
      message: 'Error cancelling job'
    });
  }
};

// PUT /api/jobs/:jobId/start
export const startJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    const clientId = req.user.userId;

    console.log('Job start attempt:', { jobId, clientId });

    const job = await Job.findOne({ _id: jobId, clientId })
      .populate('workerId', 'name phone.phone');

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    if (job.status !== 'assigned') {
      return res.status(400).json({
        success: false,
        message: 'Job must be assigned to start'
      });
    }

    // Update job status to active
    job.status = 'active';
    job.startedAt = new Date();
    await job.save();

    console.log('Job started:', { jobId });

    res.json({
      success: true,
      message: 'Job started successfully',
      worker: job.workerId
    });

  } catch (error) {
    console.error('Job start error:', error);
    res.status(500).json({
      success: false,
      message: 'Error starting job'
    });
  }
};

// POST /api/jobs/:jobId/complete - Client verifies OTP to complete job
export const completeJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { otp } = req.body;
    const clientId = req.user.userId;

    if (!otp) {
      return res.status(400).json({
        success: false,
        message: 'OTP is required to complete the job'
      });
    }

    console.log('Job completion OTP verification attempt:', { jobId, clientId });

    // Find job by ID and client ID
    const job = await Job.findOne({ _id: jobId, clientId });

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    if (job.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Job must be active to complete'
      });
    }

    // Check if OTP exists in the job
    if (!job.completionOTP) {
      return res.status(400).json({
        success: false,
        message: 'No OTP generated for this job. Ask the worker to generate one.'
      });
    }

    // Verify OTP
    if (job.completionOTP !== otp) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP. Please check and try again.'
      });
    }

    // Mark job as completed
    job.status = 'completed';
    job.completedAt = new Date();
    
    // Clear the OTP after successful verification
    job.completionOTP = undefined;
    
    await job.save();

    // Update worker's completed jobs count
    const worker = await Worker.findById(job.workerId);
    if (worker) {
      worker.completedJobs = (worker.completedJobs || 0) + 1;
      await worker.save();
    }

    console.log('Job marked as completed by client:', jobId);

    res.json({
      success: true,
      message: 'Job completed successfully',
      job: {
        id: job._id,
        status: job.status,
        completedAt: job.completedAt
      }
    });

  } catch (error) {
    console.error('Job completion error:', error);
    res.status(500).json({
      success: false,
      message: 'Error completing job'
    });
  }
};

// POST /api/jobs/:jobId/rate-worker
export const rateWorker = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { rating, review } = req.body;
    const clientId = req.user.userId;

    console.log('Worker rating attempt:', { jobId, rating, clientId });

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: 'Rating must be between 1 and 5'
      });
    }

    const job = await Job.findOne({ _id: jobId, clientId });

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    if (job.status !== 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Can only rate completed jobs'
      });
    }

    if (!job.workerId) {
      return res.status(400).json({
        success: false,
        message: 'No worker assigned to this job'
      });
    }

    // Check if already rated
    const existingReview = await Review.findOne({
      jobId,
      clientId,
      reviewType: 'client-to-worker'
    });

    if (existingReview) {
      return res.status(400).json({
        success: false,
        message: 'Worker already rated for this job'
      });
    }

    // Create review
    const newReview = new Review({
      clientId,
      workerId: job.workerId,
      jobId,
      reviewType: 'client-to-worker',
      rating,
      review: review || ''
    });

    await newReview.save();
    console.log('Worker rated successfully:', newReview._id);

    res.json({
      success: true,
      message: 'Worker rated successfully',
      review: {
        id: newReview._id,
        rating: newReview.rating
      }
    });

  } catch (error) {
    console.error('Worker rating error:', error);
    res.status(500).json({
      success: false,
      message: 'Error rating worker'
    });
  }
};

// GET /api/jobs/available - For workers to view available jobs
export const getAvailableJobs = async (req, res) => {
  try {
    const workerId = req.user.userId;
    const { page = 1, limit = 50, skill, maxDistance = 25, urgency, sortBy = 'distance' } = req.query;

    console.log('Fetching available jobs:', { workerId, page, skill, maxDistance, urgency });

    // Get worker details for skill filtering and location
    const worker = await Worker.findById(workerId);
    if (!worker) {
      return res.status(404).json({
        success: false,
        message: 'Worker not found'
      });
    }

    // Build query for posted jobs only
    const query = {
      status: 'posted',
      workerId: null // Not assigned
    };

    // Handle skill filtering - "For you" means jobs matching worker's skills
    if (skill && skill !== 'All Services' && skill !== 'For you') {
      query.skill = skill;
    } else if (skill === 'For you') {
      // Filter jobs that match worker's skills
      query.skill = { $in: worker.skills };
    }

    // Filter by urgency
    if (urgency === 'true') {
      query.urgency = true;
    }

    // Get all jobs first (without distance filtering)
    const jobs = await Job.find(query)
      .populate('clientId', 'name address.city profilePicture')
      .sort({ createdAt: -1 });

    let jobsWithDistance = [];

    // Calculate distances if worker has location
    if (worker.address && worker.address.location && 
        isValidCoordinates(worker.address.location.lat, worker.address.location.lon)) {
      
      console.log('Calculating distances for jobs...');
      const distances = await calculateJobDistances(worker.address.location, jobs);
      
      // Add distance to each job and filter by maxDistance
      jobsWithDistance = jobs
        .map(job => ({
          ...job.toObject(),
          distance: distances[job._id] || null
        }))
        .filter(job => {
          // Include jobs with distance data within maxDistance, or jobs without coordinates
          return job.distance === null || job.distance <= parseFloat(maxDistance);
        })
        .sort((a, b) => {
          if (sortBy === 'distance') {
            // Sort by distance (closest first), jobs without distance go to end
            if (a.distance === null && b.distance === null) return new Date(b.createdAt) - new Date(a.createdAt);
            if (a.distance === null) return 1;
            if (b.distance === null) return -1;
            return a.distance - b.distance;
          }
          return new Date(b.createdAt) - new Date(a.createdAt);
        });
    } else {
      // If worker has no location, return all jobs without distance data
      jobsWithDistance = jobs.map(job => ({
        ...job.toObject(),
        distance: null
      }));
    }

    // Apply pagination
    const skip = (page - 1) * limit;
    const paginatedJobs = jobsWithDistance.slice(skip, skip + parseInt(limit));
    const total = jobsWithDistance.length;

    console.log(`Found ${paginatedJobs.length} available jobs for worker ${workerId} within ${maxDistance}km`);

    res.json({
      success: true,
      jobs: paginatedJobs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      },
      filters: {
        availableSkills: worker.skills,
        currentCity: worker.address?.city,
        workerLocation: worker.address?.location
      }
    });

  } catch (error) {
    console.error('Error fetching available jobs:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching available jobs'
    });
  }
};

// POST /api/jobs/:jobId/accept
export const acceptJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    const workerId = req.user.userId;

    console.log('Job acceptance attempt:', { jobId, workerId });

    // Check if worker has any active jobs first
    const activeJobs = await Job.find({
      workerId,
      status: { $in: ['assigned', 'active'] }
    });

    if (activeJobs.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'You already have an active job. Complete it before accepting a new one.'
      });
    }

    // Use findOneAndUpdate with atomic operation to prevent race conditions
    const job = await Job.findOneAndUpdate(
      { 
        _id: jobId, 
        status: 'posted', 
        workerId: null // Ensure no other worker has claimed it
      },
      { 
        workerId: workerId, 
        status: 'assigned' 
      },
      { 
        new: true,
        runValidators: true
      }
    );

    if (!job) {
      // Check if job exists but is already taken
      const existingJob = await Job.findById(jobId);
      if (!existingJob) {
        return res.status(404).json({
          success: false,
          message: 'Job not found'
        });
      }
      
      if (existingJob.workerId) {
        return res.status(409).json({
          success: false,
          message: 'Another worker selected this job before you',
          conflict: true
        });
      }
      
      return res.status(400).json({
        success: false,
        message: 'Job is no longer available'
      });
    }

    // Check if worker has required skill
    const worker = await Worker.findById(workerId);
    if (!worker) {
      // Rollback the job assignment
      await Job.findByIdAndUpdate(jobId, { workerId: null, status: 'posted' });
      return res.status(404).json({
        success: false,
        message: 'Worker not found'
      });
    }

    if (!worker.skills.includes(job.skill)) {
      // Rollback the job assignment
      await Job.findByIdAndUpdate(jobId, { workerId: null, status: 'posted' });
      return res.status(400).json({
        success: false,
        message: 'You do not have the required skill for this job'
      });
    }

    console.log('Job accepted successfully:', { jobId, workerId, status: job.status });

    res.json({
      success: true,
      message: 'Job accepted successfully',
      job: {
        id: job._id,
        title: job.title,
        status: job.status,
        workerId: job.workerId
      }
    });

  } catch (error) {
    console.error('Job acceptance error:', error);
    res.status(500).json({
      success: false,
      message: 'Error accepting job'
    });
  }
};

// GET /api/jobs/worker - Get worker's assigned/active jobs
export const getWorkerJobs = async (req, res) => {
  try {
    const workerId = req.user.userId;
    const { page = 1, limit = 10, status } = req.query;

    console.log('Fetching worker jobs:', { workerId, page, status });

    // Build query
    const query = { workerId };
    if (status && status !== 'all') {
      query.status = status;
    } else {
      // Show assigned, active, and completed jobs
      query.status = { $in: ['assigned', 'active', 'completed'] };
    }

    // Execute query with pagination
    const skip = (page - 1) * limit;
    const jobs = await Job.find(query)
      .populate('clientId', 'name email.email phone.phone address profilePicture')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean(); // Convert to plain JavaScript objects

    // Get all job IDs to fetch their ratings in a single query
    const jobIds = jobs.map(job => job._id);
    
    // Get all reviews for these jobs
    const reviews = await Review.find({
      jobId: { $in: jobIds },
      reviewType: 'worker-to-client'
    });

    // Create a map of jobId to its review
    const reviewMap = new Map();
    reviews.forEach(review => {
      reviewMap.set(review.jobId.toString(), {
        rating: review.rating,
        review: review.review,
        createdAt: review.createdAt
      });
    });

    // Add review info to each job
    const jobsWithRatings = jobs.map(job => {
      const review = reviewMap.get(job._id.toString());
      return {
        ...job,
        clientRating: review?.rating || 0,
        clientReview: review?.review || "",
        reviewDate: review?.createdAt || null
      };
    });

    const total = await Job.countDocuments(query);

    console.log(`Found ${jobs.length} jobs for worker ${workerId}`);

    res.json({
      success: true,
      jobs: jobsWithRatings,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Error fetching worker jobs:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching worker jobs'
    });
  }
};

// GET /api/jobs/:jobId/completion-otp - Generate and get OTP for job completion (worker only)
export const getCompletionOTP = async (req, res) => {
  try {
    const { jobId } = req.params;
    const workerId = req.user.userId;

    console.log('OTP generation request:', { jobId, workerId });

    const job = await Job.findOne({ _id: jobId, workerId });

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found or you are not assigned to this job'
      });
    }

    if (job.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Job must be active to generate completion OTP'
      });
    }

    // Generate a new 6-digit OTP
    const completionOTP = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Save the OTP to the job
    job.completionOTP = completionOTP;
    await job.save();

    console.log('Generated completion OTP for job:', { jobId });

    res.json({
      success: true,
      completionOTP,
      message: 'Share this OTP with the client to complete the job. This OTP will be valid for completing the job.'
    });

  } catch (error) {
    console.error('Error generating completion OTP:', error);
    res.status(500).json({
      success: false,
      message: 'Error generating completion OTP'
    });
  }
};

// POST /api/jobs/:jobId/rate-client
// PUT /api/jobs/:jobId/cancel-worker
// Worker can cancel their accepted job (moves job back to posted state)
export const cancelJobByWorker = async (req, res) => {
  try {
    const { jobId } = req.params;
    const workerId = req.user.userId;

    console.log('Worker job cancellation attempt:', { jobId, workerId });

    const job = await Job.findOne({ _id: jobId, workerId });

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found or you are not assigned to this job'
      });
    }

    if (job.status !== 'assigned' && job.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel a job with status: ${job.status}`
      });
    }

    // Move job back to posted state and remove worker assignment
    job.status = 'posted';
    job.workerId = undefined;
    job.assignedAt = undefined;
    job.completionOTP = undefined;
    
    await job.save();

    console.log('Job cancelled by worker, moved back to posted state:', jobId);

    res.json({
      success: true,
      message: 'Job cancelled successfully. The job is now available for other workers.',
      job: {
        id: job._id,
        status: job.status
      }
    });

  } catch (error) {
    console.error('Worker job cancellation error:', error);
    res.status(500).json({
      success: false,
      message: 'Error cancelling job'
    });
  }
};

export const rateClient = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { rating, review } = req.body;
    const workerId = req.user.userId;

    console.log('Client rating attempt:', { jobId, rating, workerId });

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: 'Rating must be between 1 and 5'
      });
    }

    const job = await Job.findOne({ _id: jobId, workerId });

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    if (job.status !== 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Can only rate completed jobs'
      });
    }

    // Check if already rated
    const existingReview = await Review.findOne({
      jobId,
      workerId,
      reviewType: 'worker-to-client'
    });

    if (existingReview) {
      return res.status(400).json({
        success: false,
        message: 'Client already rated for this job'
      });
    }

    // Create review
    const newReview = new Review({
      clientId: job.clientId,
      workerId,
      jobId,
      reviewType: 'worker-to-client',
      rating,
      review: review || ''
    });

    await newReview.save();
    console.log('Client rated successfully:', newReview._id);

    res.json({
      success: true,
      message: 'Client rated successfully',
      review: {
        id: newReview._id,
        rating: newReview.rating
      }
    });

  } catch (error) {
    console.error('Client rating error:', error);
    res.status(500).json({
      success: false,
      message: 'Error rating client'
    });
  }
};