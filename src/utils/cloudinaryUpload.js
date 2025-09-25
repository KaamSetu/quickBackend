import cloudinary from '../config/cloudinary.js';
import fs from 'fs';

/**
 * Upload image to Cloudinary
 * @param {string} filePath - Local file path
 * @param {string} folder - Cloudinary folder name
 * @param {Object} options - Additional upload options
 * @returns {Promise<Object>} - Cloudinary upload result
 */
export const uploadToCloudinary = async (filePath, folder = 'kaamsetu', options = {}) => {
  try {
    console.log('Cloudinary upload attempt:', { filePath, folder, options });
    console.log('File exists:', fs.existsSync(filePath));
    
    const result = await cloudinary.uploader.upload(filePath, {
      folder,
      resource_type: 'auto',
      quality: 'auto:good',
      fetch_format: 'auto',
      ...options
    });

    console.log('Cloudinary upload successful:', {
      secure_url: result.secure_url,
      public_id: result.public_id,
      format: result.format
    });

    // Delete local file after successful upload
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log('Local file deleted:', filePath);
    }

    return {
      success: true,
      url: result.secure_url,
      publicId: result.public_id,
      format: result.format,
      width: result.width,
      height: result.height,
      bytes: result.bytes
    };
  } catch (error) {
    // Clean up local file on error
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    console.error('Cloudinary upload error:', error);
    console.error('Error details:', {
      message: error.message,
      http_code: error.http_code,
      name: error.name
    });
    throw new Error('Failed to upload image to Cloudinary: ' + error.message);
  }
};

/**
 * Upload profile picture to Cloudinary
 * @param {string} filePath - Local file path
 * @param {string} userId - User ID for folder organization
 * @returns {Promise<Object>} - Upload result
 */
export const uploadProfilePicture = async (filePath, userId) => {
  return uploadToCloudinary(filePath, `kaamsetu/profiles/${userId}`, {
    transformation: [
      { width: 400, height: 400, crop: 'fill', gravity: 'face' },
      { quality: 'auto:good' }
    ]
  });
};

/**
 * Upload Aadhaar document to Cloudinary
 * @param {string} filePath - Local file path
 * @param {string} userId - User ID for folder organization
 * @returns {Promise<Object>} - Upload result
 */
export const uploadAadhaarDocument = async (filePath, userId) => {
  return uploadToCloudinary(filePath, `kaamsetu/documents/${userId}`, {
    transformation: [
      { quality: 'auto:good' }
    ]
  });
};

/**
 * Upload job image to Cloudinary
 * @param {string} filePath - Local file path
 * @param {string} jobId - Job ID for folder organization
 * @returns {Promise<Object>} - Upload result
 */
export const uploadJobImage = async (filePath, jobId) => {
  return uploadToCloudinary(filePath, `kaamsetu/jobs/${jobId}`, {
    transformation: [
      { width: 800, height: 600, crop: 'limit' },
      { quality: 'auto:good' }
    ]
  });
};

/**
 * Delete image from Cloudinary
 * @param {string} publicId - Cloudinary public ID
 * @returns {Promise<Object>} - Deletion result
 */
export const deleteFromCloudinary = async (publicId) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    return {
      success: result.result === 'ok',
      result: result.result
    };
  } catch (error) {
    console.error('Cloudinary delete error:', error);
    throw new Error('Failed to delete image from Cloudinary');
  }
};

/**
 * Extract public ID from Cloudinary URL
 * @param {string} url - Cloudinary URL
 * @returns {string} - Public ID
 */
export const extractPublicId = (url) => {
  if (!url || !url.includes('cloudinary.com')) {
    return null;
  }
  
  const parts = url.split('/');
  const uploadIndex = parts.findIndex(part => part === 'upload');
  if (uploadIndex === -1) return null;
  
  // Get everything after version (v1234567890)
  const afterVersion = parts.slice(uploadIndex + 2);
  const publicIdWithExtension = afterVersion.join('/');
  
  // Remove file extension
  const lastDotIndex = publicIdWithExtension.lastIndexOf('.');
  return lastDotIndex !== -1 
    ? publicIdWithExtension.substring(0, lastDotIndex)
    : publicIdWithExtension;
};
