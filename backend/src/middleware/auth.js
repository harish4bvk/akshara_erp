const jwt  = require('jsonwebtoken');
const db   = require('../config/db');

// ── Verify JWT ────────────────────────────────────────────────
const authenticate = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = header.slice(7);
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Fetch fresh user from DB (catches deactivated accounts mid-session)
    const { rows } = await db.query(
      'SELECT id, name, username, role, is_active FROM users WHERE id = $1',
      [decoded.id]
    );
    if (!rows.length || !rows[0].is_active) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    req.user = rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// ── Role guard factory ────────────────────────────────────────
// Usage: requireRole('admin')  or  requireRole(['admin','accountant'])
const requireRole = (roles) => (req, res, next) => {
  const allowed = Array.isArray(roles) ? roles : [roles];
  if (!allowed.includes(req.user.role)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  next();
};

// ── Branch access guard ───────────────────────────────────────
// Attaches req.allowedBranchIds to every request.
// Admin users get all branches. Others are limited by user_branch_access.
const resolveBranchAccess = async (req, res, next) => {
  if (req.user.role === 'admin') {
    const { rows } = await db.query('SELECT id FROM branches WHERE is_active = TRUE');
    req.allowedBranchIds = rows.map(r => r.id);
    return next();
  }

  const { rows } = await db.query(
    'SELECT branch_id FROM user_branch_access WHERE user_id = $1',
    [req.user.id]
  );
  req.allowedBranchIds = rows.map(r => r.branch_id);
  next();
};

// ── Branch param guard ────────────────────────────────────────
// Use after resolveBranchAccess. Checks that a requested branch_id
// (from req.params, req.query or req.body) is within the user's access.
const canAccessBranch = (getBranchId) => (req, res, next) => {
  const branchId = parseInt(getBranchId(req), 10);
  if (!branchId) return next();                        // no branch filter requested — OK
  if (!req.allowedBranchIds.includes(branchId)) {
    return res.status(403).json({ error: 'Access to this branch is not permitted' });
  }
  next();
};

// ── Activity logger ───────────────────────────────────────────
// Call this after authenticate to log user module usage.
const logActivity = (module, action) => async (req, res, next) => {
  try {
    await db.query(
      `INSERT INTO user_activity_log (user_id, module, action, ip_address, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, module, action, req.ip, JSON.stringify(req.body || {})]
    );
    // Update last_login / last_module on users
    await db.query(
      'UPDATE users SET last_module = $1, last_login = NOW() WHERE id = $2',
      [module, req.user.id]
    );
  } catch (_) { /* non-blocking */ }
  next();
};

module.exports = { authenticate, requireRole, resolveBranchAccess, canAccessBranch, logActivity };
