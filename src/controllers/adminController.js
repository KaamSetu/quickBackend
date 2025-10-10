import Client from '../models/Client.js';
import Worker from '../models/Worker.js';
import Job from '../models/Job.js';
import Review from '../models/Review.js';
import dotenv from 'dotenv';

dotenv.config();

// 1. Dashboard Overview
export const getStats = async (req, res) => {
  try {
    // 1. Count total clients and workers
    const [totalClients, totalWorkers] = await Promise.all([
      Client.countDocuments(),
      Worker.countDocuments()
    ]);

    // 2. Count verified and pending Aadhaar
    const [verifiedAadhaarClients, verifiedAadhaarWorkers, pendingAadhaarClients, pendingAadhaarWorkers] = await Promise.all([
      Client.countDocuments({ 'aadhaar.verificationStatus': 'verified' }),
      Worker.countDocuments({ 'aadhaar.verificationStatus': 'verified' }),
      Client.countDocuments({ 'aadhaar.verificationStatus': 'pending' }),
      Worker.countDocuments({ 'aadhaar.verificationStatus': 'pending' })
    ]);

    // 3. Job counts
    const [activeJobs, completedJobs] = await Promise.all([
      Job.countDocuments({ status: 'active' }),
      Job.countDocuments({ status: 'completed' })
    ]);

    // 4. Revenue (count completed payments)
    const revenueAgg = await Job.aggregate([
      { $match: { paymentStatus: 'completed' } },
      { $count: 'totalCompleted' }
    ]);
    
    const totalRevenue = revenueAgg[0]?.totalCompleted || 0;

    return res.json({
      success: true,
      data: {
        totalClients,
        totalWorkers,
        verifiedAadhaar: verifiedAadhaarClients + verifiedAadhaarWorkers,
        pendingAadhaar: pendingAadhaarClients + pendingAadhaarWorkers,
        activeJobs,
        completedJobs,
        totalRevenue
      }
    });
  } catch (error) {
    console.error('Admin getStats error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch dashboard stats.' });
  }
};

// GET /admin/distribution/skills
export const getSkillDistribution = async (req, res) => {
  try {
    const [workerDistributionRaw, jobDistributionRaw] = await Promise.all([
      Worker.aggregate([
        { $unwind: '$skills' },
        { $group: { _id: '$skills', count: { $sum: 1 } } }
      ]),
      Job.aggregate([
        { $group: { _id: '$skill', count: { $sum: 1 } } }
      ])
    ]);

    const workerDistribution = workerDistributionRaw.map(w => ({ skill: w._id, count: w.count }));
    const jobDistribution = jobDistributionRaw.map(j => ({ skill: j._id, count: j.count }));

    return res.json({ success: true, data: { workerDistribution, jobDistribution } });
  } catch (error) {
    console.error('Admin getSkillDistribution error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch distributions.' });
  }
};

// 2. Aadhaar Verification Center
// GET /admin/verification/pending
export const getPendingVerifications = async (req, res) => {
  try {
    const [clients, workers] = await Promise.all([
      Client.find({ 'aadhaar.verificationStatus': 'pending' })
        .select('name phone.phone email.email aadhaar.number aadhaar.documentUrl createdAt'),
      Worker.find({ 'aadhaar.verificationStatus': 'pending' })
        .select('name phone.phone email.email aadhaar.number aadhaar.documentUrl createdAt')
    ]);

    const pending = [
      ...clients.map(c => ({ ...c.toObject(), role: 'client' })),
      ...workers.map(w => ({ ...w.toObject(), role: 'worker' }))
    ];
    

    return res.json({ success: true, data: { pendingVerifications: pending } });
  } catch (error) {
    console.error('Admin getPendingVerifications error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch pending verifications.' });
  }
};

// PATCH /admin/verification/approve/:id
export const approveVerification = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (role === 'client') {
      await Client.findByIdAndUpdate(id, { 'aadhaar.verificationStatus': 'verified' });
    } else if (role === 'worker') {
      await Worker.findByIdAndUpdate(id, { 'aadhaar.verificationStatus': 'verified' });
    } else {
      return res.status(400).json({ success: false, message: 'Invalid role. Must be client or worker.' });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Admin approveVerification error:', error);
    return res.status(500).json({ success: false, message: 'Failed to approve verification.' });
  }
};

// PATCH /admin/verification/reject/:id
export const rejectVerification = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (role === 'client') {
      await Client.findByIdAndUpdate(id, { 'aadhaar.verificationStatus': 'rejected' });
    } else if (role === 'worker') {
      await Worker.findByIdAndUpdate(id, { 'aadhaar.verificationStatus': 'rejected' });
    } else {
      return res.status(400).json({ success: false, message: 'Invalid role. Must be client or worker.' });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Admin rejectVerification error:', error);
    return res.status(500).json({ success: false, message: 'Failed to reject verification.' });
  }
};

// 3. User Management
// GET /admin/users
export const getUsers = async (req, res) => {
  try {
    const { role } = req.query;

    if (role === 'client') {
      const users = await Client.find()
        .select('name email.email phone.phone aadhaar.verificationStatus blocked address.city createdAt');
      return res.json({ success: true, data: users });
    }

    // default workers if role not specified or 'worker'
    const users = await Worker.find()
      .select('name email.email phone.phone aadhaar.verificationStatus blocked address.city skills experience createdAt');
    return res.json({ success: true, data: users });
  } catch (error) {
    console.error('Admin getUsers error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch users.' });
  }
};

// PATCH /admin/users/:id/block
export const blockUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (role === 'client') {
      await Client.findByIdAndUpdate(id, { blocked: true }, { strict: false });
    } else if (role === 'worker') {
      await Worker.findByIdAndUpdate(id, { blocked: true }, { strict: false });
    } else {
      return res.status(400).json({ success: false, message: 'Invalid role. Must be client or worker.' });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Admin blockUser error:', error);
    return res.status(500).json({ success: false, message: 'Failed to block user.' });
  }
};

// PATCH /admin/users/:id/unblock
export const unblockUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (role === 'client') {
      await Client.findByIdAndUpdate(id, { blocked: false }, { strict: false });
    } else if (role === 'worker') {
      await Worker.findByIdAndUpdate(id, { blocked: false }, { strict: false });
    } else {
      return res.status(400).json({ success: false, message: 'Invalid role. Must be client or worker.' });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Admin unblockUser error:', error);
    return res.status(500).json({ success: false, message: 'Failed to unblock user.' });
  }
};

// 4. Job Management
// GET /admin/jobs
export const getJobs = async (req, res) => {
  try {
    const { status } = req.query;
    const query = status ? { status } : {};

    const jobs = await Job.find(query)
      .populate('clientId', 'name email.email')
      .populate('workerId', 'name email.email')
      .select('title skill address.city status createdAt');

    return res.json({ success: true, data: { jobs } });
  } catch (error) {
    console.error('Admin getJobs error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch jobs.' });
  }
};

// GET /admin/jobs/stats
export const getJobsStats = async (req, res) => {
  try {
    const [byCityRaw, bySkillRaw] = await Promise.all([
      Job.aggregate([{ $group: { _id: '$address.city', count: { $sum: 1 } } }]),
      Job.aggregate([{ $group: { _id: '$skill', count: { $sum: 1 } } }])
    ]);

    const byCity = byCityRaw.map(c => ({ city: c._id, count: c.count }));
    const bySkill = bySkillRaw.map(s => ({ skill: s._id, count: s.count }));

    return res.json({ success: true, data: { byCity, bySkill } });
  } catch (error) {
    console.error('Admin getJobsStats error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch job stats.' });
  }
};

// 5. Review & Dispute Center
// GET /admin/reviews
export const getReviews = async (req, res) => {
  try {
    const lowRating = String(req.query.lowRating || '').toLowerCase() === 'true';
    const filter = lowRating ? { rating: { $lte: 2 } } : {};

    const reviews = await Review.find(filter)
      .populate('clientId', 'name')
      .populate('workerId', 'name')
      .populate('jobId', 'title');

    return res.json({ success: true, data: { reviews } });
  } catch (error) {
    console.error('Admin getReviews error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch reviews.' });
  }
};

// DELETE /admin/reviews/:id
export const deleteReview = async (req, res) => {
  try {
    await Review.findByIdAndDelete(req.params.id);
    return res.json({ success: true });
  } catch (error) {
    console.error('Admin deleteReview error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete review.' });
  }
};

// POST /admin/verify
export const verifyAdminPassword = (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ success: false, message: 'Password is required' });
    }
    
    const isMatch = password === process.env.ADMIN_PASSWORD;
    return res.json({ success: true, isMatch });
  } catch (error) {
    console.error('Admin password verification error:', error);
    return res.status(500).json({ success: false, message: 'Failed to verify admin password' });
  }
};
