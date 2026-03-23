const db = require('../config/db');

// ── POST /settings/promote-class ──────────────────────────────
// Promotes all students in a given academic year to the next class & year.
const promoteClass = async (req, res) => {
  const { from_year_id, to_year_id, branch_id } = req.body;
  if (!from_year_id || !to_year_id) {
    return res.status(400).json({ error: 'from_year_id and to_year_id required' });
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Get all active students in the from-year
    const branchCond = branch_id ? `AND s.branch_id = ${parseInt(branch_id)}` : '';
    const { rows: students } = await client.query(
      `SELECT s.id, s.admission_number, s.student_name, s.father_name, s.mother_name,
              s.phone1, s.phone2, s.dob, s.aadhaar, s.caste, s.sub_caste,
              s.branch_id, c.name AS class_name, c.section
       FROM students s
       JOIN classes c ON c.id = s.class_id
       WHERE s.academic_year_id = $1 AND s.is_active = TRUE ${branchCond}`,
      [from_year_id]
    );

    let promoted = 0, skipped = 0;

    for (const student of students) {
      // Find the next class (increment class number)
      const classNum = parseInt(student.class_name.replace(/\D/g, ''), 10);
      if (classNum >= 10) { skipped++; continue; } // Class 10 graduates

      const nextClassName = `Class ${classNum + 1}`;
      const nextClassQ = await client.query(
        `SELECT id FROM classes
         WHERE name = $1 AND section = $2 AND branch_id = $3 AND academic_year_id = $4`,
        [nextClassName, student.section, student.branch_id, to_year_id]
      );

      if (!nextClassQ.rows.length) { skipped++; continue; }

      // Create student record in new academic year (with new class)
      try {
        await client.query(
          `INSERT INTO students
             (admission_number, student_name, father_name, mother_name, phone1, phone2,
              dob, aadhaar, caste, sub_caste, branch_id, class_id, academic_year_id, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           ON CONFLICT (admission_number) DO NOTHING`,
          [student.admission_number, student.student_name, student.father_name, student.mother_name,
           student.phone1, student.phone2, student.dob, student.aadhaar, student.caste, student.sub_caste,
           student.branch_id, nextClassQ.rows[0].id, to_year_id, req.user.id]
        );
        promoted++;
      } catch (_) { skipped++; }
    }

    await client.query('COMMIT');
    res.json({
      message: 'Class promotion complete',
      total: students.length,
      promoted,
      skipped
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('promoteClass error:', err);
    res.status(500).json({ error: 'Promotion failed, transaction rolled back' });
  } finally {
    client.release();
  }
};

// ── GET /settings/branches ────────────────────────────────────
const getBranches = async (req, res) => {
  const { rows } = await db.query(
    'SELECT * FROM branches WHERE is_active = TRUE ORDER BY name'
  );
  res.json(rows);
};

// ── POST /settings/branches ───────────────────────────────────
const createBranch = async (req, res) => {
  const { name, address, city, phone } = req.body;
  if (!name) return res.status(400).json({ error: 'Branch name required' });
  const { rows } = await db.query(
    'INSERT INTO branches (name, address, city, phone) VALUES ($1,$2,$3,$4) RETURNING *',
    [name, address, city, phone]
  );
  res.status(201).json(rows[0]);
};

// ── GET /settings/academic-years ─────────────────────────────
const getAcademicYears = async (req, res) => {
  const { rows } = await db.query(
    'SELECT * FROM academic_years ORDER BY start_date DESC'
  );
  res.json(rows);
};

// ── POST /settings/academic-years ────────────────────────────
const createAcademicYear = async (req, res) => {
  const { label, start_date, end_date, is_current } = req.body;
  if (!label || !start_date || !end_date) {
    return res.status(400).json({ error: 'label, start_date, end_date required' });
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    if (is_current) {
      // Unset current from all other years
      await client.query('UPDATE academic_years SET is_current = FALSE');
    }

    const { rows } = await client.query(
      `INSERT INTO academic_years (label, start_date, end_date, is_current)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [label, start_date, end_date, is_current || false]
    );

    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'Year label already exists' });
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
};

module.exports = { promoteClass, getBranches, createBranch, getAcademicYears, createAcademicYear };
