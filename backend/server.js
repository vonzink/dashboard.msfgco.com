// MSFG Dashboard Backend API Server
// Node.js/Express backend for dashboard

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const db = require('./db/connection');
const { authenticate } = require('./middleware/auth');
const { requireActiveDbUser, requireDbUser, requireNonExternal } = require('./middleware/userContext');
const { startCalendarSyncScheduler } = require('./services/calendarSync/scheduler');
const logger = require('./lib/logger');
const {
  createSafeHttpLogger,
  hasInvalidPublicWebinarPathCasing,
  isPublicWebinarRequest,
  isPublicWebinarRuntimeRequest,
} = require('./lib/httpLogging');
const websocket = require('./lib/websocket');
const { LIMITS } = require('./services/webinars/limits');
const {
  createOperationalEventRecorder,
  recordOperationalEvent,
} = require('./services/webinars/observability');

// Route imports
const investorsRoutes = require('./routes/investors');
const chatRoutes = require('./routes/chat');
const announcementsRoutes = require('./routes/announcements');
const notificationsRoutes = require('./routes/notifications');
const goalsRoutes = require('./routes/goals');
const filesRoutes = require('./routes/files');
const userFilesRoutes = require('./routes/userFiles');
const tasksRoutes = require('./routes/tasks');
const preApprovalsRoutes = require('./routes/preApprovals');
const pipelineRoutes = require('./routes/pipeline');
const fundedLoansRoutes = require('./routes/fundedLoans');
const adminRoutes = require('./routes/admin');
const webhooksRoutes = require('./routes/webhooks');
const mondayWebhookRoutes = require('./routes/webhooks/monday');

// Content Engine routes
const integrationsRoutes = require('./routes/integrations');
const contentTemplatesRoutes = require('./routes/contentTemplates');
const contentSearchRoutes = require('./routes/contentSearch');
const contentGenerateRoutes = require('./routes/contentGenerate');
const contentItemsRoutes = require('./routes/contentItems');
const contentPublishRoutes = require('./routes/contentPublish');
const mondayRoutes = require('./routes/monday');
const calendarEventsRoutes = require('./routes/calendarEvents');
const scheduleRoutes = require('./routes/schedule');
const scheduleSyncPublicRoutes = require('./routes/scheduleSyncPublic');
const scheduleSyncRoutes = require('./routes/scheduleSync');
const usersRoutes = require('./routes/users');
const guidelinesRoutes = require('./routes/guidelines');
const lendingpadRoutes = require('./routes/lendingpad');
const processingRoutes = require('./routes/processing');
const handbookRoutes = require('./routes/handbook');
const myProfileRoutes = require('./routes/myProfile');
const programsRoutes = require('./routes/programs');
const hrResourcesRoutes = require('./routes/hrResources');
const checklistsRoutes = require('./routes/checklists');
const askAiRoutes = require('./routes/askAi');
const { createWebinarsRouter } = require('./routes/webinars');
const { createWebinarPresenterSettingsRouter } = require('./routes/webinarPresenterSettings');
const { createWebinarAssetsRouter } = require('./routes/webinarAssets');
const { createPublicWebinarsRouter } = require('./routes/publicWebinars');

const PORT = process.env.PORT || 8080;
let calendarSyncScheduler = null;
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['https://dashboard.msfgco.com', 'http://localhost:3000', 'http://localhost:3001'];
const PUBLIC_WEBINAR_ORIGIN = 'https://msfgmortgage.com';
const PUBLIC_RUNTIME_EVENT_BYTES = 2 * 1024;

function exactOrigin(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.origin !== value || parsed.username || parsed.password) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function isLocalDevelopmentOrigin(origin) {
  const parsed = new URL(origin);
  return ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
    && ['http:', 'https:'].includes(parsed.protocol);
}

function loadPublicWebinarOrigins(env = process.env, configuredOrigins) {
  const production = env.NODE_ENV === 'production';
  const candidates = configuredOrigins === undefined
    ? (env.PUBLIC_WEBINAR_ORIGINS || PUBLIC_WEBINAR_ORIGIN).split(',')
    : configuredOrigins;
  if (!Array.isArray(candidates)) throw new Error('Invalid public webinar origin configuration');

  const origins = new Set([PUBLIC_WEBINAR_ORIGIN]);
  for (const candidate of candidates) {
    const origin = exactOrigin(typeof candidate === 'string' ? candidate.trim() : candidate);
    const allowed = origin === PUBLIC_WEBINAR_ORIGIN
      || (!production && origin && isLocalDevelopmentOrigin(origin));
    if (!allowed) throw new Error('Invalid public webinar origin configuration');
    origins.add(origin);
  }
  return Object.freeze([...origins]);
}

function corsOriginPolicy(origins, message) {
  return (origin, callback) => {
    if (!origin) return callback(null, false);
    if (origins.includes(origin)) return callback(null, origin);
    const error = new Error(message);
    error.status = 403;
    error.code = 'CORS_ORIGIN_DENIED';
    return callback(error);
  };
}

function createApp({
  webinarAuthenticate = authenticate,
  webinarServices = {},
  webinarOperationalLogger = null,
  webinarIpWriteLimit = 300,
  webinarWriteLimit = 300,
  webinarAssetWriteLimit = 300,
  publicWebinarOrigins,
  publicWebinarRuntimeLimit = 60,
  generalWriteLimit = 200,
  accessLogger = logger,
  errorLogger = logger,
} = {}) {
const app = express();
const resolvedPublicWebinarOrigins = loadPublicWebinarOrigins(process.env, publicWebinarOrigins);
const webinarRecordOperationalEvent = webinarOperationalLogger
  ? createOperationalEventRecorder(webinarOperationalLogger)
  : recordOperationalEvent;
const webinarsRoutes = createWebinarsRouter({
  ...webinarServices,
  recordOperationalEvent: webinarRecordOperationalEvent,
});
const webinarPresenterSettingsRoutes = createWebinarPresenterSettingsRouter({
  settings: webinarServices.settings,
  recordOperationalEvent: webinarRecordOperationalEvent,
});
const webinarAssetsRoutes = createWebinarAssetsRouter({
  catalog: webinarServices.assets,
  recordOperationalEvent: webinarRecordOperationalEvent,
});
const publicWebinarsRoutes = createPublicWebinarsRouter({
  getLiveBundleBySlug: webinarServices.publicBundle?.getLiveBundleBySlug,
  recordOperationalEvent: webinarRecordOperationalEvent,
});

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

// Public webinar reads have a separate, non-credentialed browser boundary.
// Adding an audience origin here must never add it to private Dashboard routes.
app.use((req, res, next) => {
  if (isPublicWebinarRequest(req)) {
    res.vary('Origin');
    if (req.method === 'OPTIONS') res.vary('Access-Control-Request-Headers');
  }
  next();
});
app.use(cors((req, callback) => {
  if (isPublicWebinarRequest(req)) {
    callback(null, {
      origin: corsOriginPolicy(resolvedPublicWebinarOrigins, 'Public webinar origin not allowed'),
      credentials: false,
      methods: ['GET', 'HEAD', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type'],
      preflightContinue: hasInvalidPublicWebinarPathCasing(req),
    });
    return;
  }
  callback(null, {
    origin: corsOriginPolicy(allowedOrigins, 'Not allowed by CORS'),
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Active-Role'],
  });
}));

// Rate limiting - 1000 requests per 15 minutes per IP
// Internal tool: dashboard loads ~8 API calls per page, keyword-explorer adds more.
// With auto-refresh (every 5 min) and multiple tabs, 1000 gives plenty of headroom.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
  skip: isWebinarStudioMutation,
});
app.use('/api/', limiter);

// Stricter rate limit for write operations (POST/PUT/DELETE)
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: generalWriteLimit,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many write requests, please slow down' },
  // Only apply to mutating methods. My Files is excluded and limited
  // separately — see myFilesWriteLimiter below.
  skip: (req) => req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS'
    || req.originalUrl.startsWith('/api/my-files')
    || isPublicWebinarRuntimeRequest(req)
    || hasInvalidPublicWebinarPathCasing(req)
    || isWebinarStudioMutation(req),
});
app.use('/api/', writeLimiter);

// Protect private Studio mutation endpoints before parsing bodies or doing
// authentication work. A second limiter below isolates accepted employees by
// the positive database ID derived by the server.
const webinarIpWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: webinarIpWriteLimit,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many webinar requests, please slow down' },
  skip: (req) => !isWebinarStudioMutation(req),
});
app.use('/api/', webinarIpWriteLimiter);

// Each uploaded file costs two write requests (presign, then confirm), so
// dropping a folder of 100 files would exhaust the 200-request budget above.
// That limiter is keyed by IP, so one person bulk-uploading would lock every
// colleague behind the same office connection out of every write endpoint on
// the dashboard. This one is keyed per user and sized for bulk file work.
const myFilesWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.db?.id || req.ip),
  message: { error: 'Too many file operations, please slow down' },
  skip: (req) => req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS',
});

// Private Webinar Studio writes are deliberately keyed to the authenticated
// employee, rather than the office IP address used by the general limiter.
const webinarWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: webinarWriteLimit,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.db?.id),
  message: { error: 'Too many webinar write requests, please slow down' },
  skip: (req) => req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS',
});

const webinarAssetWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: webinarAssetWriteLimit,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.db?.id),
  message: { error: 'Too many webinar asset requests, please slow down' },
  skip: (req) => req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS',
});

const publicWebinarRuntimeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: publicWebinarRuntimeLimit,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many runtime events, please slow down' },
  skip: (req) => ['GET', 'HEAD', 'OPTIONS'].includes(req.method),
});
app.use('/api/public/webinars', publicWebinarRuntimeLimiter);

const WEBINAR_REQUEST_PREFIXES = ['/api/webinars', '/api/webinar-presenter-settings', '/api/webinar-assets'];
const WEBINAR_MAX_REQUEST_BYTES = LIMITS.request;
function isWebinarStudioMutation(req) {
  return !['GET', 'HEAD', 'OPTIONS'].includes(req.method)
    && WEBINAR_REQUEST_PREFIXES.some(prefix => {
      const pathname = (req.originalUrl || req.url || '').split('?')[0];
      return pathname === prefix || pathname.startsWith(`${prefix}/`);
    });
}

function isPublicWebinarDecodeError(error, req) {
  return error instanceof URIError
    && (error.status === 400 || error.statusCode === 400)
    && isPublicWebinarRequest(req);
}

function rejectOversizedWebinarRequest(req, res, next) {
  if (!isWebinarStudioMutation(req)) {
    return next();
  }
  const contentLength = Number(req.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > WEBINAR_MAX_REQUEST_BYTES) {
    recordWebinarTransportRejection(req, 413, 'CONTENT_LIMIT_EXCEEDED');
    return res.status(413).json({ error: 'Webinar request exceeds 2 MB limit', code: 'CONTENT_LIMIT_EXCEEDED' });
  }
  return next();
}

function recordWebinarTransportRejection(req, statusCode, reasonCode = 'VALIDATION_FAILED') {
  if (req.webinarTransportEventRecorded) return;
  req.webinarTransportEventRecorded = true;
  webinarRecordOperationalEvent('webinar.validation_rejected', { statusCode, reasonCode });
}

function verifyWebinarRawRequestSize(req, _res, buffer) {
  if (isWebinarStudioMutation(req) && buffer.length > WEBINAR_MAX_REQUEST_BYTES) {
    const error = new Error('Webinar request exceeds 2 MB limit');
    error.status = 413;
    error.code = 'CONTENT_LIMIT_EXCEEDED';
    throw error;
  }
}

const webinarRawBodyParser = express.raw({
  type: isWebinarStudioMutation,
  limit: WEBINAR_MAX_REQUEST_BYTES,
  verify: verifyWebinarRawRequestSize,
});

function parseWebinarRawJson(req, res, next) {
  if (!isWebinarStudioMutation(req) || !Buffer.isBuffer(req.body)) return next();
  const contentType = (req.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    recordWebinarTransportRejection(req, 400, 'UNSUPPORTED_MEDIA_TYPE');
    return res.status(400).json({ error: 'Unsupported media type', code: 'UNSUPPORTED_MEDIA_TYPE' });
  }
  try {
    req.body = JSON.parse(req.body.toString('utf8'));
    return next();
  } catch {
    recordWebinarTransportRejection(req, 400, 'MALFORMED_JSON');
    return res.status(400).json({ error: 'Invalid JSON', code: 'MALFORMED_JSON' });
  }
}

// Closed header allowlists keep credentials and cookies out of request logs.
app.use(createSafeHttpLogger(accessLogger));

function recordPublicRuntimeRejection(req, statusCode, reasonCode) {
  if (req.publicWebinarOperationalEventRecorded) return;
  req.publicWebinarOperationalEventRecorded = true;
  try {
    webinarRecordOperationalEvent('webinar.validation_rejected', { statusCode, reasonCode });
  } catch {
    // A failed log sink must not expose or change a transport response.
  }
}

function rejectPublicRuntimeEvent(req, res, statusCode, reasonCode, message) {
  recordPublicRuntimeRejection(req, statusCode, reasonCode);
  return res.status(statusCode).json({ error: message, code: reasonCode });
}

function rejectInvalidPublicWebinarPathCasing(req, res, next) {
  if (!hasInvalidPublicWebinarPathCasing(req)) return next();
  recordPublicRuntimeRejection(req, 404, 'WEBINAR_NOT_FOUND');
  return res.status(404).json({ error: 'Webinar not found', code: 'WEBINAR_NOT_FOUND' });
}

function rejectInvalidPublicRuntimeTransport(req, res, next) {
  if (!isPublicWebinarRuntimeRequest(req)) return next();
  const contentLength = Number(req.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > PUBLIC_RUNTIME_EVENT_BYTES) {
    return rejectPublicRuntimeEvent(
      req, res, 413, 'CONTENT_LIMIT_EXCEEDED', 'Runtime event exceeds 2 KiB limit',
    );
  }

  const contentEncoding = (req.get('content-encoding') || 'identity').trim().toLowerCase();
  const contentType = (req.get('content-type') || '').trim();
  const supportedContentType = /^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i;
  if (contentEncoding !== 'identity' || !supportedContentType.test(contentType)) {
    return rejectPublicRuntimeEvent(
      req, res, 400, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported runtime event transport',
    );
  }
  return next();
}

const publicRuntimeEventParser = express.json({
  type: 'application/json',
  limit: PUBLIC_RUNTIME_EVENT_BYTES,
  strict: true,
  inflate: false,
});

function handlePublicRuntimeParserError(error, req, res, next) {
  if (!isPublicWebinarRuntimeRequest(req)) return next(error);
  if (error.type === 'entity.too.large' || error.status === 413) {
    return rejectPublicRuntimeEvent(
      req, res, 413, 'CONTENT_LIMIT_EXCEEDED', 'Runtime event exceeds 2 KiB limit',
    );
  }
  if (error.type === 'entity.parse.failed') {
    return rejectPublicRuntimeEvent(
      req, res, 400, 'MALFORMED_JSON', 'Invalid runtime event JSON',
    );
  }
  return rejectPublicRuntimeEvent(
    req, res, 400, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported runtime event transport',
  );
}

// This parser is deliberately mounted before the Dashboard-wide 10 MiB parser.
app.use(rejectInvalidPublicWebinarPathCasing);
app.use(rejectInvalidPublicRuntimeTransport);
app.post('/api/public/webinars/:slug/runtime-events', publicRuntimeEventParser, handlePublicRuntimeParserError);
app.use('/api/public/webinars', publicWebinarsRoutes);

// Body parsing
app.use(rejectOversizedWebinarRequest);
app.use(webinarRawBodyParser);
app.use(parseWebinarRawJson);
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

// Monday.com webhooks use their own token auth (mounted before shared API key middleware)
app.use('/api/webhooks/monday', mondayWebhookRoutes);

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
    role: user.role || 'user',
    cognitoGroups: req.user?.groups || []
  });
});

// Webinar Studio remains private to active internal employees. The active-user
// check is intentionally scoped here and does not change existing route access.
app.use('/api/webinars', webinarAuthenticate, requireDbUser, requireActiveDbUser, requireNonExternal, webinarWriteLimiter, webinarsRoutes);
app.use('/api/webinar-presenter-settings', webinarAuthenticate, requireDbUser, requireActiveDbUser, requireNonExternal, webinarWriteLimiter, webinarPresenterSettingsRoutes);
app.use('/api/webinar-assets', webinarAuthenticate, requireDbUser, requireActiveDbUser, requireNonExternal, webinarAssetWriteLimiter, webinarAssetsRoutes);

// Routes accessible to ALL authenticated users (including External)
app.use('/api/announcements', authenticate, announcementsRoutes);
app.use('/api/notifications', authenticate, notificationsRoutes);
app.use('/api/calendar-events', authenticate, calendarEventsRoutes);
app.use('/api/schedule/sync', scheduleSyncPublicRoutes);
app.use('/api/schedule/sync', authenticate, scheduleSyncRoutes);
app.use('/api/schedule', authenticate, scheduleRoutes);
app.use('/api/me/profile', authenticate, myProfileRoutes);

// Routes blocked for External users
app.use('/api/users', authenticate, requireNonExternal, usersRoutes);
app.use('/api/investors', authenticate, requireNonExternal, investorsRoutes);
app.use('/api/chat', authenticate, requireNonExternal, chatRoutes);
app.use('/api/goals', authenticate, requireNonExternal, goalsRoutes);
app.use('/api/files', authenticate, requireNonExternal, filesRoutes);
app.use('/api/my-files', authenticate, requireNonExternal, myFilesWriteLimiter, userFilesRoutes);
app.use('/api/tasks', authenticate, requireNonExternal, tasksRoutes);
app.use('/api/pre-approvals', authenticate, requireNonExternal, preApprovalsRoutes);
app.use('/api/pipeline', authenticate, requireNonExternal, pipelineRoutes);
app.use('/api/funded-loans', authenticate, requireNonExternal, fundedLoansRoutes);
app.use('/api/programs', authenticate, requireNonExternal, programsRoutes);
app.use('/api/hr-resources', authenticate, requireNonExternal, hrResourcesRoutes);
app.use('/api/admin', authenticate, requireNonExternal, adminRoutes);
app.use('/api/checklists', authenticate, requireNonExternal, checklistsRoutes);
app.use('/api/ask-ai', authenticate, requireNonExternal, askAiRoutes);

// Content Engine (blocked for External)
app.use('/api/integrations', authenticate, requireNonExternal, integrationsRoutes);
app.use('/api/content/templates', authenticate, requireNonExternal, contentTemplatesRoutes);
app.use('/api/content/search', authenticate, requireNonExternal, contentSearchRoutes);
app.use('/api/content/generate', authenticate, requireNonExternal, contentGenerateRoutes);
app.use('/api/content/items', authenticate, requireNonExternal, contentItemsRoutes);
app.use('/api/content/publish', authenticate, requireNonExternal, contentPublishRoutes);

// Monday.com integration (blocked for External)
app.use('/api/monday', authenticate, requireNonExternal, mondayRoutes);

// Lending Guidelines
app.use('/api/guidelines', authenticate, requireNonExternal, guidelinesRoutes);

// LendingPad integration
app.use('/api/lendingpad', authenticate, requireNonExternal, lendingpadRoutes);

// Processing order tracking
app.use('/api/processing', authenticate, requireNonExternal, processingRoutes);

// Employee Handbook
app.use('/api/handbook', authenticate, handbookRoutes);

// ======================
// ERROR HANDLING
// ======================
app.use((err, req, res, next) => {
  if (err.code === 'CORS_ORIGIN_DENIED' && err.status === 403) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  if (isPublicWebinarDecodeError(err, req)) {
    recordPublicRuntimeRejection(req, 404, 'WEBINAR_NOT_FOUND');
    return res.status(404).json({ error: 'Webinar not found', code: 'WEBINAR_NOT_FOUND' });
  }
  errorLogger.error({ err }, 'Unhandled error');

  if (isWebinarStudioMutation(req) && (err.code === 'CONTENT_LIMIT_EXCEEDED' || err.type === 'entity.too.large' || err.status === 413)) {
    recordWebinarTransportRejection(req, 413, 'CONTENT_LIMIT_EXCEEDED');
    return res.status(413).json({ error: 'Webinar request exceeds 2 MB limit', code: 'CONTENT_LIMIT_EXCEEDED' });
  }
  if (err.type === 'entity.parse.failed' && isWebinarStudioMutation(req)) {
    recordWebinarTransportRejection(req, 400, 'MALFORMED_JSON');
    return res.status(400).json({ error: 'Invalid JSON', code: 'MALFORMED_JSON' });
  }
  
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

app.locals.webinarStudio = {
  isWebinarStudioMutation,
  rejectOversizedWebinarRequest,
  verifyWebinarRawRequestSize,
  webinarRawBodyParser,
  parseWebinarRawJson,
  writeLimiter,
  webinarIpWriteLimiter,
  webinarWriteLimiter,
  webinarAssetWriteLimiter,
  publicWebinarRuntimeLimiter,
  rejectInvalidPublicRuntimeTransport,
  publicRuntimeEventParser,
  handlePublicRuntimeParserError,
};
return app;
}

const app = createApp();

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

    // Seed bundled "general" checklist templates as is_global=TRUE.
    // No-op if templates already present, safe on every boot.
    try {
      const { seedGlobalTemplates } = require('./services/checklists/seedGlobalTemplates');
      await seedGlobalTemplates();
    } catch (err) {
      logger.warn({ err: err.message }, 'Global checklist template seed failed (non-fatal)');
    }

    calendarSyncScheduler = startCalendarSyncScheduler();

    const server = app.listen(PORT, '0.0.0.0', () => {
      logger.info({ port: PORT, env: process.env.NODE_ENV || 'development', origins: allowedOrigins }, 'Server started');
    });

    // Attach WebSocket server for real-time chat
    const { verifyCognitoJwt } = require('./auth/cognito');
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

if (require.main === module) {
  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down gracefully');
    if (calendarSyncScheduler) clearInterval(calendarSyncScheduler);
    websocket.close();
    await db.close();
    process.exit(0);
  });
  process.on('SIGINT', async () => {
    logger.info('SIGINT received, shutting down gracefully');
    if (calendarSyncScheduler) clearInterval(calendarSyncScheduler);
    websocket.close();
    await db.close();
    process.exit(0);
  });
  startServer();
}

module.exports = {
  app,
  createApp,
  loadPublicWebinarOrigins,
  ...app.locals.webinarStudio,
};
