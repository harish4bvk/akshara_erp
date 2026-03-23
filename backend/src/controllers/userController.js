const db     = require('../config/db');
const bcrypt = require('bcryptjs');

// ── GET /users ────────────────────────────────────────────────
const getUsers = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT u.id, u.name, u.username, u.role, u.is_active,
              u.last_login, u.last_module, u.created_at,
              ARRAY_AGG(b.name ORDER BY b.name) FILTER (WHERE b.id IS NOT NULL) AS branch_access
       FROM users u
       LEFT JOIN user_branch_access uba ON uba.user_id = u.id
       LEFT JOIN branches b ON b.id = uba.branch_id
       GROUP BY u.id
       ORDER BY u.name`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── POST /users ───────────────────────────────────────────────
const createUser = async (req, res) => {
  const { name, username, password, role, branch_ids } = req.body;
  if (!name || !username || !password || !role) {
    return res.status(400).json({ error: 'name, username, password, role required' });
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await client.query(
      `INSERT INTO users (name, username, password_hash, role, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [name, username.toLowerCase(), hash, role, req.user.id]
    );
    const userId = rows[0].id;

    if (role !== 'admin' && branch_ids && branch_ids.length) {
      for (const bid of branch_ids) {
        await client.query(
          'INSERT INTO user_branch_access (user_id, branch_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [userId, bid]
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ id: userId, message: 'User created' });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'Username already exists' });
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
};

// ── PUT /users/:id ────────────────────────────────────────────
const updateUser = async (req, res) => {
  const { name, role, is_active, branch_ids } = req.body;
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE users SET name = COALESCE($1, name), role = COALESCE($2, role),
       is_active = COALESCE($3, is_active), updated_at = NOW() WHERE id = $4`,
      [name, role, is_active, req.params.id]
    );

    if (branch_ids !== undefined) {
      await client.query('DELETE FROM user_branch_access WHERE user_id = $1', [req.params.id]);
      for (const bid of (branch_ids || [])) {
        await client.query(
          'INSERT INTO user_branch_access (user_id, branch_id) VALUES ($1, $2)', [req.params.id, bid]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ message: 'User updated' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
};

// ── DELETE /users/:id ─────────────────────────────────────────
const deleteUser = async (req, res) => {
  if (parseInt(req.params.id) === req.user.id) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }
  await db.query('UPDATE users SET is_active = FALSE WHERE id = $1', [req.params.id]);
  res.json({ message: 'User deactivated' });
};

// ── GET /users/:id/activity ───────────────────────────────────
const getUserActivity = async (req, res) => {
  const { rows } = await db.query(
    `SELECT module, action, ip_address, created_at
     FROM user_activity_log WHERE user_id = $1
     ORDER BY created_at DESC LIMIT 100`,
    [req.params.id]
  );
  res.json(rows);
};

module.exports = { getUsers, createUser, updateUser, deleteUser, getUserActivity };
