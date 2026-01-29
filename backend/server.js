// MSFG Dashboard Backend API Server
// Node.js/Express backend for dashboard

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const db = require("./db/connection");

// Routes
const investorsRoutes = require("./routes/investors");
const announcementsRoutes = require("./routes/announcements");
const notificationsRoutes = require("./routes/notifications");
const goalsRoutes = require("./routes/goals");
const filesRoutes = require("./routes/files");
const tasksRoutes = require("./routes/tasks");
const preApprovalsRoutes = require("./routes/preApprovals");
const pipelineRoutes = require("./routes/pipeline");
const webhooksRoutes = require("./routes/webhooks");

// Auth middleware
let requireAuthExport;

try {
  requireAuthExport = require("./auth/middleware");
} catch (e) {
  console.warn("⚠ Auth middleware not loaded:", e?.message || e);
}

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean)
  : "*";

app.use(
  cors({
    origin: corsOrigins,
    credentials: Array.isArray(corsOrigins),
  })
);
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

/**
 * Normalize requireAuth to an actual Express middleware:
 * - supports legacy: module.exports = (req,res,next)=>{}
 * - supports modern: module.exports = { requireAuth: (options)=> (req,res,next)=>{} }
 */
function buildAuthMiddleware() {
  if (!requireAuthExport) return null;

  const maybeFactory = requireAuthExport.requireAuth || requireAuthExport;

  if (typeof maybeFactory !== "function") return null;

  // If it looks like (req,res,next), use as-is.
  // If it looks like (options) => middleware, call it.
  if (maybeFactory.length >= 3) {
    return maybeFactory; // legacy middleware signature
  }

  // factory signature: requireAuth(options) -> middleware
  return maybeFactory({
    // webhooks are mounted before /api anyway, but keeping this doesn't hurt.
    publicPaths: ["/api/webhooks"],
  });
}

const authMiddleware = buildAuthMiddleware();

/**
 * Local requireGroup() middleware.
 * Uses req.user.groups (from auth/middleware.js) which is derived from `cognito:groups`.
 *
 * Usage:
 *   app.use("/api/pipeline", requireGroup("admin", "LO", "processor"), pipelineRoutes);
 */
function requireGroup(...allowedGroups) {
  const allowed = allowedGroups
    .flat()
    .filter(Boolean)
    .map((g) => String(g).toLowerCase());

  return function requireGroupMiddleware(req, res, next) {
    const groups = (req.user?.groups || []).map((g) => String(g).toLowerCase());

    // If you want "any authenticated user", don't use requireGroup at all.
    if (allowed.length === 0) return next();

    const ok = allowed.some((g) => groups.includes(g));
    if (!ok) {
      return res.status(403).json({
        error: "Forbidden",
        required: allowedGroups,
        userGroups: req.user?.groups || [],
      });
    }

    return next();
  };
}

// --- Public routes (NO auth) ---
app.use("/api/webhooks", webhooksRoutes);

// --- Auth gate for everything else under /api ---
app.use("/api", (req, res, next) => {
  if (typeof authMiddleware !== "function") {
    // Fail CLOSED in production, OPEN in dev
    if (process.env.NODE_ENV === "production") {
      return res.status(500).json({
        error: "Auth middleware not configured",
        timestamp: new Date().toISOString(),
      });
    }
    console.warn("⚠ Auth disabled (missing auth middleware).");
    return next();
  }
  return authMiddleware(req, res, next);
});

function buildDisplayName(user) {
  const claims = user?.claims || {};
  const given = claims.given_name || "";
  const family = claims.family_name || "";
  const full = [given, family].filter(Boolean).join(" ").trim();
  if (full) return full;
  if (claims.name) return String(claims.name);
  if (user?.username) return String(user.username);
  if (user?.email) return String(user.email);
  return "User";
}

function buildInitials(name) {
  const parts = String(name || "")
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "";
  const initials = parts.map((part) => part[0]).join("");
  return initials.slice(0, 2).toUpperCase();
}

app.use("/api", async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }

  if (req.user.db) {
    return next();
  }

  const email = req.user.email;
  if (!email) {
    return res.status(401).json({ error: "User email missing from token" });
  }

  try {
    const displayName = buildDisplayName(req.user);
    const initials = buildInitials(displayName);
    const adminEmailsEnv = process.env.ADMIN_EMAILS || "zachary.zink@msfg.us";
    const adminEmails = adminEmailsEnv
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    const isAdminEmail = adminEmails.includes(email.toLowerCase());

    if (isAdminEmail) {
      await db.query(
        `INSERT INTO users (email, name, initials, role)
         VALUES (?, ?, ?, 'admin')
         ON DUPLICATE KEY UPDATE
           name = VALUES(name),
           initials = VALUES(initials),
           role = 'admin'`,
        [email, displayName, initials]
      );
    } else {
      await db.query(
        `INSERT INTO users (email, name, initials)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE
           name = VALUES(name),
           initials = VALUES(initials)`,
        [email, displayName, initials]
      );
    }

    const [rows] = await db.query(
      "SELECT id, email, name, initials, role FROM users WHERE email = ?",
      [email]
    );

    if (!rows.length) {
      return res.status(401).json({ error: "User mapping failed" });
    }

    req.user.db = rows[0];
    return next();
  } catch (error) {
    console.error("User mapping error:", error);
    return res.status(500).json({ error: "Failed to map user" });
  }
});

// Debug endpoint: see what groups Cognito is actually sending
app.get("/api/me", (req, res) => {
  res.json({
    user: req.user || null,
    groups: req.user?.groups || [],
  });
});

// API Routes (protected by auth gate above)

// If you WANT group protections, apply them like this (example):
// app.use("/api/pipeline", requireGroup("admin", "LO", "processor"), pipelineRoutes);

// For now, keep routes accessible to any authenticated user:
app.use("/api/investors", investorsRoutes);
app.use("/api/announcements", announcementsRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/goals", goalsRoutes);
app.use("/api/files", filesRoutes);
app.use("/api/tasks", tasksRoutes);
app.use("/api/pre-approvals", preApprovalsRoutes);
app.use("/api/pipeline", pipelineRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Error:", err);
  res.status(err.status || 500).json({
    error: err.message || "Internal server error",
    timestamp: new Date().toISOString(),
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Start server
async function startServer() {
  try {
    await db.ping();
    console.log("✓ Database connection successful");

    const migrations = require("./db/migrations");
    await migrations.runMigrations();
    console.log("✓ Database migrations completed");

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`✓ Server running on http://0.0.0.0:${PORT}`);
      console.log(`✓ API available at http://localhost:${PORT}/api`);
      console.log("✓ Auth middleware enabled for /api/* (except /api/webhooks)");
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down gracefully");
  await db.close();
  process.exit(0);
});

startServer();