const cloudinary = require('cloudinary').v2;
require('dotenv').config();

// Configure Cloudinary from environment variables
const isCloudinaryConfigured = !!(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
);

if (isCloudinaryConfigured) {
    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
        secure: true
    });
    console.log('☁️ Cloudinary cloud storage connected successfully.');
} else {
    console.log('⚠️ Note: Cloudinary credentials not detected in .env yet. Photos will use base64 data-URL or fallback CDN until CLOUDINARY_CLOUD_NAME is added.');
}

/**
 * Uploads an image buffer directly to Cloudinary without saving to local disk
 * @param {Buffer} buffer - Multer file memory buffer
 * @param {String} folder - Cloudinary folder name (e.g. 'blukaam/profiles')
 * @returns {Promise<string>} - The secure HTTPS image URL
 */
const uploadImageBuffer = (buffer, folder = 'blukaam/profiles') => {
    return new Promise((resolve, reject) => {
        if (!isCloudinaryConfigured) {
            // Safe fallback when user hasn't set keys yet: convert to base64 Data URL (stored directly in cloud profile)
            const base64Data = `data:image/jpeg;base64,${buffer.toString('base64')}`;
            return resolve(base64Data);
        }

        const uploadStream = cloudinary.uploader.upload_stream(
            {
                folder: folder,
                resource_type: 'image',
                transformation: [
                    { width: 500, height: 500, crop: 'thumb', gravity: 'face' },
                    { quality: 'auto', fetch_format: 'auto' }
                ]
            },
            (error, result) => {
                if (error) {
                    console.error('Cloudinary upload error:', error);
                    return reject(error);
                }
                resolve(result.secure_url);
            }
        );

        uploadStream.end(buffer);
    });
};

module.exports = {
    cloudinary,
    isCloudinaryConfigured,
    uploadImageBuffer
};
