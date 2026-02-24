// File API routes (S3 presigned URLs, browse, download)
const express = require('express');
const router = express.Router();
const { S3Client, PutObjectCommand, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');

const AWS_CREDS = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
};

// Default client (us-east-1) for uploads and forms bucket
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: AWS_CREDS,
});

// West client for msfg-media bucket (us-west-2)
const s3ClientWest = new S3Client({
  region: 'us-west-2',
  credentials: AWS_CREDS,
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'msfg-dashboard-files';

// ========================================
// Allowed S3 libraries for browsing
// ========================================
const ALLOWED_LIBRARIES = {
  forms: {
    bucket: 'msfg-mortgage-documents-prod',
    prefix: '',
    label: 'Forms Library',
    region: 'us-east-1',
  },
  logos: {
    bucket: 'msfg-media',
    prefix: 'Assets/LOGOS/',
    label: 'Logos & Brand Assets',
    region: 'us-west-2',
  },
};

// Pick the right S3 client based on library region
function getS3Client(lib) {
  return lib.region === 'us-west-2' ? s3ClientWest : s3Client;
}

// ========================================
// POST /api/files/upload-url
// ========================================
router.post('/upload-url', async (req, res, next) => {
  try {
    const { fileName, fileType } = req.body;

    if (!fileName) {
      return res.status(400).json({ error: 'fileName is required' });
    }

    const fileKey = `uploads/${crypto.randomUUID()}-${fileName}`;

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

// ========================================
// GET /api/files/browse
// List folders + files in an allowed S3 library
// ========================================
router.get('/browse', async (req, res, next) => {
  try {
    const { library, path = '' } = req.query;

    // Validate library against whitelist
    const lib = ALLOWED_LIBRARIES[library];
    if (!lib) {
      return res.status(400).json({
        error: 'Invalid library. Allowed: ' + Object.keys(ALLOWED_LIBRARIES).join(', '),
      });
    }

    // Prevent path traversal
    if (path.includes('..') || path.startsWith('/')) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    const fullPrefix = lib.prefix + path;

    // Collect all pages (handles > 1000 objects)
    let allContents = [];
    let allPrefixes = [];
    let continuationToken;

    do {
      const command = new ListObjectsV2Command({
        Bucket: lib.bucket,
        Prefix: fullPrefix,
        Delimiter: '/',
        ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
      });

      const response = await getS3Client(lib).send(command);

      if (response.CommonPrefixes) allPrefixes.push(...response.CommonPrefixes);
      if (response.Contents) allContents.push(...response.Contents);

      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

    // Extract folders (common prefixes)
    const folders = allPrefixes.map((cp) => {
      const relativePath = cp.Prefix.slice(lib.prefix.length);
      const name = relativePath.slice(path.length);
      return { name, path: relativePath };
    });

    // Extract files (skip the "folder" key itself)
    const files = allContents
      .filter((obj) => obj.Key !== fullPrefix && obj.Size > 0)
      .map((obj) => {
        const relativePath = obj.Key.slice(lib.prefix.length);
        const name = relativePath.slice(path.length);
        return {
          name,
          key: relativePath,
          size: obj.Size,
          lastModified: obj.LastModified,
        };
      });

    res.json({
      library,
      label: lib.label,
      currentPath: path,
      folders,
      files,
    });
  } catch (error) {
    console.error('Error browsing S3:', error);
    next(error);
  }
});

// ========================================
// GET /api/files/download-url
// Generate presigned GET URL for a file
// ========================================
router.get('/download-url', async (req, res, next) => {
  try {
    const { library, key } = req.query;

    // Validate library against whitelist
    const lib = ALLOWED_LIBRARIES[library];
    if (!lib) {
      return res.status(400).json({ error: 'Invalid library' });
    }

    // Validate key
    if (!key || key.includes('..') || key.startsWith('/')) {
      return res.status(400).json({ error: 'Invalid key' });
    }

    const fullKey = lib.prefix + key;

    const command = new GetObjectCommand({
      Bucket: lib.bucket,
      Key: fullKey,
    });

    const url = await getSignedUrl(getS3Client(lib), command, { expiresIn: 900 });
    const fileName = key.split('/').pop();

    res.json({
      downloadUrl: url,
      fileName,
      expiresIn: 900,
    });
  } catch (error) {
    console.error('Error generating download URL:', error);
    next(error);
  }
});

module.exports = router;
