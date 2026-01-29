// File upload API routes (S3 presigned URLs)
const express = require('express');
const router = express.Router();
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'msfg-dashboard-files';

// POST /api/files/upload-url - Get presigned URL for file upload
router.post('/upload-url', async (req, res, next) => {
  try {
    const { fileName, fileType } = req.body;
    
    if (!fileName) {
      return res.status(400).json({ error: 'fileName is required' });
    }
    
    // Generate unique file key
    const fileKey = `uploads/${crypto.randomUUID()}-${fileName}`;
    
    // Create presigned URL (valid for 1 hour)
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: fileKey,
      ContentType: fileType || 'application/octet-stream',
    });
    
    const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    
    res.json({
      uploadUrl: url,
      fileKey: fileKey,
      bucket: BUCKET_NAME,
    });
  } catch (error) {
    console.error('Error generating presigned URL:', error);
    next(error);
  }
});

module.exports = router;

