const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const db     = require('../config/db');

// POST /auth/login
const login = async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const { rows } = await db.query(
      'SELECT id, name, username, password_hash, role, is_active FROM users WHERE username = $1',
      [username.trim().toLowerCase()]
    );

    const user = rows[0];
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    // Fetch branch access
    let branchAccess = [];
    if (user.role !== 'admin') {
      const ba = await db.query(
        `SELECT b.id, b.name FROM user_branch_access uba
         JOIN branches b ON b.id = uba.branch_id
         WHERE uba.user_id = $1`,
        [user.id]
      );
      branchAccess = ba.rows;
    } else {
      const ba = await db.query('SELECT id, name FROM branches WHERE is_active = TRUE');
      branchAccess = ba.rows;
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    // Update last login
    await db.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

    res.json({
      token,
      user: {
        id:       user.id,
        name:     user.name,
        username: user.username,
        role:     user.role,
        branchAccess,
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// POST /auth/change-password
const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Both current and new password are required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  try {
    const { rows } = await db.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [req.user.id]
    );
    const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!valid) return res.status(400).json({ error: 'Current password is incorrect' });

    const hash = await bcrypt.hash(newPassword, 12);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);

    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// POST /auth/admin/reset-password  (admin resets another user's password)
const adminResetPassword = async (req, res) => {
  const { userId, newPassword } = req.body;
  if (!userId || !newPassword) {
    return res.status(400).json({ error: 'userId and newPassword required' });
  }
  try {
    const hash = await bcrypt.hash(newPassword, 12);
    const { rowCount } = await db.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [hash, userId]
    );
    if (!rowCount) return res.status(404).json({ error: 'User not found' });
    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = { login, changePassword, adminResetPassword };
