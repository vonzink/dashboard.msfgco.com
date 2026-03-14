/**
 * WebSocket server for real-time chat
 *
 * Attaches to the existing HTTP server (same port).
 * Clients connect to ws(s)://<host>/ws?token=<jwt>
 *
 * Message types (server → client):
 *   { type: 'chat:message', data: { ...message } }
 *   { type: 'chat:delete',  data: { id } }
 *   { type: 'chat:tags',    data: { id, tags } }
 *   { type: 'connected',    data: { userId } }
 *
 * No client → server messages are used (REST handles mutations).
 */
const { WebSocketServer } = require('ws');
const { URL } = require('url');
const logger = require('./logger');

let wss = null;

// Map<userId, Set<WebSocket>>
const clientsByUser = new Map();

/**
 * Attach WebSocket server to an existing HTTP server.
 * @param {http.Server} server
 * @param {Function} verifyToken — async (token) => { userId, email } or throws
 */
function attach(server, verifyToken) {
  wss = new WebSocketServer({ noServer: true });

  // Handle upgrade manually so we can authenticate
  server.on('upgrade', async (request, socket, head) => {
    try {
      // Parse token from query string
      const url = new URL(request.url, `http://${request.headers.host}`);
      const token = url.searchParams.get('token');

      if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      // Only handle /ws path
      if (url.pathname !== '/ws') {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }

      const user = await verifyToken(token);
      if (!user || !user.userId) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        ws.userId = user.userId;
        ws.userEmail = user.email;
        wss.emit('connection', ws, request);
      });
    } catch (err) {
      logger.warn({ err: err.message }, 'WebSocket auth failed');
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
    }
  });

  wss.on('connection', (ws) => {
    const userId = ws.userId;

    // Track connection
    if (!clientsByUser.has(userId)) {
      clientsByUser.set(userId, new Set());
    }
    clientsByUser.get(userId).add(ws);

    logger.info({ userId }, 'WebSocket connected');

    // Send confirmation
    safeSend(ws, { type: 'connected', data: { userId } });

    // Heartbeat (keep-alive)
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('close', () => {
      const userClients = clientsByUser.get(userId);
      if (userClients) {
        userClients.delete(ws);
        if (userClients.size === 0) clientsByUser.delete(userId);
      }
      logger.info({ userId }, 'WebSocket disconnected');
    });

    ws.on('error', (err) => {
      logger.warn({ userId, err: err.message }, 'WebSocket error');
    });
  });

  // Heartbeat interval — detect stale connections
  const heartbeat = setInterval(() => {
    if (!wss) { clearInterval(heartbeat); return; }
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        ws.terminate();
        return;
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => clearInterval(heartbeat));

  logger.info('WebSocket server attached (path: /ws)');
}

/**
 * Broadcast a message to all connected clients.
 */
function broadcast(type, data) {
  if (!wss) return;

  const payload = JSON.stringify({ type, data });
  wss.clients.forEach((ws) => {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(payload);
    }
  });
}

/**
 * Send a message to a specific user (all their connections).
 */
function sendToUser(userId, type, data) {
  const clients = clientsByUser.get(userId);
  if (!clients) return;

  const payload = JSON.stringify({ type, data });
  clients.forEach((ws) => {
    if (ws.readyState === 1) {
      ws.send(payload);
    }
  });
}

function safeSend(ws, obj) {
  try {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(obj));
    }
  } catch (err) {
    // Non-fatal
  }
}

/**
 * Close the WebSocket server (for graceful shutdown).
 */
function close() {
  if (wss) {
    wss.close();
    wss = null;
    clientsByUser.clear();
  }
}

/** Number of connected clients */
function clientCount() {
  return wss ? wss.clients.size : 0;
}

module.exports = { attach, broadcast, sendToUser, close, clientCount };
