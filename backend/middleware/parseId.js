/**
 * Middleware to parse and validate :id route params as positive integers.
 * Returns 400 if the ID is not a valid positive integer.
 */
function parseId(paramName = 'id') {
  return (req, res, next) => {
    const raw = req.params[paramName];
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== String(raw)) {
      return res.status(400).json({ error: `Invalid ${paramName}: must be a positive integer` });
    }
    req.params[paramName] = parsed;
    next();
  };
}

module.exports = { parseId };
