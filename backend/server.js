// MSFG Dashboard Backend API Server
// Node.js/Express backend for dashboard

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const db = require('./db/connection');
const { authenticate } = require('./middleware/auth');

// Route imports
const investorsRoutes = require('./routes/investors');
const chatRoutes = require('./routes/chat');
const announcementsRoutes = require('./routes/announcements');
const notificationsRoutes = require('./routes/notifications');
const goalsRoutes = require('./routes/goals');
const filesRoutes = require('./routes/files');
const tasksRoutes = require('./routes/tasks');
const preApprovalsRoutes = require('./routes/preApprovals');
const pipelineRoutes = require('./routes/pipeline');
const webhooksRoutes = require('./routes/webhooks');

// Content Engine routes
const integrationsRoutes = require('./routes/integrations');
const contentTemplatesRoutes = require('./routes/contentTemplates');
const contentSearchRoutes = require('./routes/contentSearch');
const contentGenerateRoutes = require('./routes/contentGenerate');
const contentItemsRoutes = require('./routes/contentItems');
const contentPublishRoutes = require('./routes/contentPublish');
const mondayRoutes = require('./routes/monday');
const calendarEventsRoutes = require('./routes/calendarEvents');

const app = express();
const PORT = process.env.PORT || 8080;

// ======================
// SECURITY MIDDLEWARE
// ======================

// Trust first proxy (ALB / nginx / CloudFront in front of EC2)
app.set('trust proxy', 1);

// Security headers
app.use(helmet());

// CORS - restrict to your frontend domain
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',') 
  : ['https://dashboard.msfgco.com', 'http://localhost:3000', 'http://localhost:3001'];

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc) in dev
    if (!origin && process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    // Allow listed origins
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

// Rate limiting - 1000 requests per 15 minutes per IP
// Internal tool: dashboard loads ~8 API calls per page, keyword-explorer adds more.
// With auto-refresh (every 5 min) and multiple tabs, 1000 gives plenty of headroom.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' }
});
app.use('/api/', limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ======================
// HEALTH CHECK (no auth)
// ======================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ======================
// API ROUTES
// ======================

// Webhooks use their own API key auth (defined in webhooks.js)
app.use('/api/webhooks', webhooksRoutes);

// Current user info endpoint
app.get('/api/me', authenticate, (req, res) => {
  const user = req.user?.db || {};
  res.json({
    id: user.id || null,
    email: user.email || null,
    name: user.name || null,
    initials: user.initials || null,
    role: user.role || 'user'
  });
});

// All other routes require JWT authentication
app.use('/api/investors', authenticate, investorsRoutes);
app.use('/api/chat', authenticate, chatRoutes);
app.use('/api/announcements', authenticate, announcementsRoutes);
app.use('/api/notifications', authenticate, notificationsRoutes);
app.use('/api/goals', authenticate, goalsRoutes);
app.use('/api/files', authenticate, filesRoutes);
app.use('/api/tasks', authenticate, tasksRoutes);
app.use('/api/pre-approvals', authenticate, preApprovalsRoutes);
app.use('/api/pipeline', authenticate, pipelineRoutes);

// Content Engine (all require JWT auth)
app.use('/api/integrations', authenticate, integrationsRoutes);
app.use('/api/content/templates', authenticate, contentTemplatesRoutes);
app.use('/api/content/search', authenticate, contentSearchRoutes);
app.use('/api/content/generate', authenticate, contentGenerateRoutes);
app.use('/api/content/items', authenticate, contentItemsRoutes);
app.use('/api/content/publish', authenticate, contentPublishRoutes);

// Monday.com integration (read-only sync)
app.use('/api/monday', authenticate, mondayRoutes);

// Company Calendar
app.use('/api/calendar-events', authenticate, calendarEventsRoutes);

// ======================
// ERROR HANDLING
// ======================
app.use((err, req, res, next) => {
  console.error('Error:', err);
  
  // Don't leak error details in production
  const message = process.env.NODE_ENV === 'production' 
    ? 'Internal server error' 
    : err.message;
  
  res.status(err.status || 500).json({
    error: message,
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ======================
// START SERVER
// ======================
async function startServer() {
  try {
    await db.ping();
    console.log('✓ Database connection successful');
    
    const migrations = require('./db/migrations');
    await migrations.runMigrations();
    console.log('✓ Database migrations completed');
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`✓ Server running on http://0.0.0.0:${PORT}`);
      console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`✓ Allowed origins: ${allowedOrigins.join(', ')}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  await db.close();
  process.exit(0);
});

startServer();