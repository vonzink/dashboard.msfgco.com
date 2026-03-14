// MSFG Dashboard Backend API Server
// Node.js/Express backend for dashboard

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const db = require('./db/connection');
const { authenticate } = require('./middleware/auth');
const logger = require('./lib/logger');
const pinoHttp = require('pino-http');
const websocket = require('./lib/websocket');

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
const fundedLoansRoutes = require('./routes/fundedLoans');
const adminRoutes = require('./routes/admin');
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
const usersRoutes = require('./routes/users');
const guidelinesRoutes = require('./routes/guidelines');
const lendingpadRoutes = require('./routes/lendingpad');
const processingRoutes = require('./routes/processing');
const handbookRoutes = require('./routes/handbook');
const myProfileRoutes = require('./routes/myProfile');

const app = express();
const PORT = process.env.PORT || 8080;

// ======================
// SECURITY MIDDLEWARE
// ======================

// Trust first proxy (ALB / nginx / CloudFront in front of EC2)
app.set('trust proxy', 1);

// Security headers — API-only server, so strict CSP + no sniffing
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],        // API returns JSON only, no need for any content loading
      frameAncestors: ["'none'"],    // Prevent click-jacking via iframes
    },
  },
  crossOriginEmbedderPolicy: true,
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },  // 2 years
  noSniff: true,
  dnsPrefetchControl: { allow: false },
  frameguard: { action: 'deny' },
  permittedCrossDomainPolicies: { permittedPolicies: 'none' },
}));

// CORS - restrict to your frontend domain
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',') 
  : ['https://dashboard.msfgco.com', 'http://localhost:3000', 'http://localhost:3001'];

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin only in explicit development mode
    if (!origin && process.env.NODE_ENV === 'development') {
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

// Stricter rate limit for write operations (POST/PUT/DELETE)
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many write requests, please slow down' },
  // Only apply to mutating methods
  skip: (req) => req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS',
});
app.use('/api/', writeLimiter);

// Request logging
app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ======================
// HEALTH CHECK (no auth)
// ======================
app.get('/health', async (req, res) => {
  try {
    await db.ping();
    res.json({ status: 'ok', uptime: process.uptime(), wsClients: websocket.clientCount(), timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'error', error: 'Database connection failed', timestamp: new Date().toISOString() });
  }
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
app.use('/api/users', authenticate, usersRoutes);
app.use('/api/investors', authenticate, investorsRoutes);
app.use('/api/chat', authenticate, chatRoutes);
app.use('/api/announcements', authenticate, announcementsRoutes);
app.use('/api/notifications', authenticate, notificationsRoutes);
app.use('/api/goals', authenticate, goalsRoutes);
app.use('/api/files', authenticate, filesRoutes);
app.use('/api/tasks', authenticate, tasksRoutes);
app.use('/api/pre-approvals', authenticate, preApprovalsRoutes);
app.use('/api/pipeline', authenticate, pipelineRoutes);
app.use('/api/funded-loans', authenticate, fundedLoansRoutes);
app.use('/api/admin', authenticate, adminRoutes);
app.use('/api/me/profile', authenticate, myProfileRoutes);

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

// Lending Guidelines
app.use('/api/guidelines', authenticate, guidelinesRoutes);

// LendingPad integration
app.use('/api/lendingpad', authenticate, lendingpadRoutes);

// Processing order tracking
app.use('/api/processing', authenticate, processingRoutes);

// Employee Handbook
app.use('/api/handbook', authenticate, handbookRoutes);

// ======================
// ERROR HANDLING
// ======================
app.use((err, req, res, next) => {
  logger.error({ err }, 'Unhandled error');
  
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
    logger.info('Database connection successful');

    const migrations = require('./db/migrations');
    await migrations.runMigrations();
    logger.info('Database migrations completed');

    const server = app.listen(PORT, '0.0.0.0', () => {
      logger.info({ port: PORT, env: process.env.NODE_ENV || 'development', origins: allowedOrigins }, 'Server started');
    });

    // Attach WebSocket server for real-time chat
    const { verifyCognitoJwt } = require('./auth/middleware');
    websocket.attach(server, async (token) => {
      const claims = await verifyCognitoJwt(token);
      const email = claims.email;
      const sub = claims.sub;

      // Look up DB user (same logic as authenticate middleware)
      let users = [];
      if (email) {
        [users] = await db.query('SELECT id, email FROM users WHERE email = ?', [email]);
      }
      if (users.length === 0 && sub) {
        [users] = await db.query('SELECT id, email FROM users WHERE cognito_sub = ?', [sub]);
      }
      if (users.length === 0) throw new Error('No DB user found');

      return { userId: users[0].id, email: users[0].email };
    });
  } catch (error) {
    logger.fatal({ err: error }, 'Failed to start server');
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  websocket.close();
  await db.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  websocket.close();
  await db.close();
  process.exit(0);
});

startServer();