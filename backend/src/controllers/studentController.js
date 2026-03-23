const db      = require('../config/db');
const ExcelJS = require('exceljs');

// ── GET /students ─────────────────────────────────────────────
const getStudents = async (req, res) => {
  const { branch_id, class_id, academic_year_id, search, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;
  const params = [];
  const conditions = ['s.is_active = TRUE'];

  // Branch access: only allowed branches
  const branchFilter = req.allowedBranchIds;
  conditions.push(`s.branch_id = ANY($${params.push(branchFilter)})`);

  if (branch_id)       conditions.push(`s.branch_id = $${params.push(parseInt(branch_id))}`);
  if (class_id)        conditions.push(`s.class_id  = $${params.push(parseInt(class_id))}`);
  if (academic_year_id) conditions.push(`s.academic_year_id = $${params.push(parseInt(academic_year_id))}`);

  if (search) {
    conditions.push(`(
      s.student_name     ILIKE $${params.push('%' + search + '%')}
      OR s.admission_number ILIKE $${params.push('%' + search + '%')}
      OR s.phone1            ILIKE $${params.push('%' + search + '%')}
    )`);
  }

  const where = conditions.join(' AND ');

  try {
    const countQ = await db.query(
      `SELECT COUNT(*) FROM students s WHERE ${where}`, params
    );
    const total = parseInt(countQ.rows[0].count, 10);

    const { rows } = await db.query(
      `SELECT s.id, s.admission_number, s.student_name, s.father_name, s.mother_name,
              s.phone1, s.phone2, s.dob, s.caste, s.sub_caste,
              b.name  AS branch_name,
              c.name  AS class_name, c.section,
              ay.label AS academic_year,
              fs.total_paid, fs.total_balance,
              CASE
                WHEN fs.total_balance = 0 THEN 'paid'
                WHEN fs.total_paid   = 0 THEN 'due'
                ELSE 'partial'
              END AS fee_status
       FROM students s
       JOIN branches      b  ON b.id  = s.branch_id
       JOIN classes       c  ON c.id  = s.class_id
       JOIN academic_years ay ON ay.id = s.academic_year_id
       LEFT JOIN v_student_fee_summary fs ON fs.student_id = s.id
       WHERE ${where}
       ORDER BY s.student_name
       LIMIT $${params.push(parseInt(limit))} OFFSET $${params.push(offset)}`,
      params
    );

    res.json({ total, page: parseInt(page), limit: parseInt(limit), data: rows });
  } catch (err) {
    console.error('getStudents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── GET /students/:id ─────────────────────────────────────────
const getStudentById = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT s.*, b.name AS branch_name, c.name AS class_name, c.section,
              ay.label AS academic_year
       FROM students s
       JOIN branches       b  ON b.id  = s.branch_id
       JOIN classes        c  ON c.id  = s.class_id
       JOIN academic_years ay ON ay.id = s.academic_year_id
       WHERE s.id = $1 AND s.branch_id = ANY($2)`,
      [req.params.id, req.allowedBranchIds]
    );
    if (!rows.length) return res.status(404).json({ error: 'Student not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── POST /students ────────────────────────────────────────────
const createStudent = async (req, res) => {
  const {
    admission_number, student_name, father_name, mother_name,
    phone1, phone2, dob, aadhaar, caste, sub_caste,
    branch_id, class_id, academic_year_id
  } = req.body;

  // Basic validation
  if (!admission_number || !student_name || !phone1 || !dob || !branch_id || !class_id) {
    return res.status(400).json({ error: 'Required fields missing' });
  }
  if (!req.allowedBranchIds.includes(parseInt(branch_id))) {
    return res.status(403).json({ error: 'Branch access denied' });
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO students
         (admission_number, student_name, father_name, mother_name, phone1, phone2,
          dob, aadhaar, caste, sub_caste, branch_id, class_id, academic_year_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id, admission_number, student_name`,
      [admission_number, student_name, father_name, mother_name, phone1, phone2,
       dob, aadhaar || null, caste || null, sub_caste || null,
       branch_id, class_id, academic_year_id, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Admission number already exists' });
    }
    console.error('createStudent error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── PUT /students/:id ─────────────────────────────────────────
const updateStudent = async (req, res) => {
  const allowed = [
    'student_name','father_name','mother_name','phone1','phone2',
    'dob','aadhaar','caste','sub_caste','class_id'
  ];
  const updates = [];
  const params  = [];

  allowed.forEach(field => {
    if (req.body[field] !== undefined) {
      params.push(req.body[field]);
      updates.push(`${field} = $${params.length}`);
    }
  });

  if (!updates.length) return res.status(400).json({ error: 'No valid fields to update' });

  params.push(req.params.id);
  params.push(req.allowedBranchIds);

  try {
    const { rowCount } = await db.query(
      `UPDATE students SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length - 1} AND branch_id = ANY($${params.length})`,
      params
    );
    if (!rowCount) return res.status(404).json({ error: 'Student not found or access denied' });
    res.json({ message: 'Student updated successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── DELETE /students/:id  (admin only) ───────────────────────
const deleteStudent = async (req, res) => {
  try {
    // Soft delete
    const { rowCount } = await db.query(
      `UPDATE students SET is_active = FALSE, updated_at = NOW()
       WHERE id = $1`,
      [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Student not found' });
    res.json({ message: 'Student deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── POST /students/bulk-upload  (admin only) ─────────────────
const bulkUpload = async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(req.file.buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return res.status(400).json({ error: 'No worksheet found in file' });

  // Read header row then map each data row into a plain object
  const headerRow = sheet.getRow(1).values.slice(1); // exceljs rows are 1-indexed
  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj = {};
    row.values.slice(1).forEach((cell, i) => {
      const key = headerRow[i];
      if (key) obj[String(key).trim()] = cell?.text ?? (cell instanceof Object ? '' : String(cell ?? ''));
    });
    rows.push(obj);
  });

  const REQUIRED  = ['admission_number','student_name','phone1','dob','branch_name','class_name'];
  const errors    = [];
  const toInsert  = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // Excel row (1-indexed + header)

    // Check required fields
    const missing = REQUIRED.filter(f => !row[f]);
    if (missing.length) {
      errors.push({ row: rowNum, error: `Missing: ${missing.join(', ')}` });
      continue;
    }
    toInsert.push(row);
  }

  if (errors.length) {
    return res.status(400).json({
      error: 'Validation errors found. No records inserted.',
      errors
    });
  }

  // Resolve branch and class IDs
  const client = await db.getClient();
  const results = { inserted: 0, skipped: 0, skipDetails: [] };

  try {
    await client.query('BEGIN');

    for (const row of toInsert) {
      const branch = await client.query(
        'SELECT id FROM branches WHERE LOWER(name) = LOWER($1) AND is_active = TRUE',
        [row.branch_name]
      );
      const cls = await client.query(
        `SELECT c.id FROM classes c
         JOIN academic_years ay ON ay.id = c.academic_year_id
         WHERE LOWER(c.name) = LOWER($1) AND c.branch_id = $2 AND ay.is_current = TRUE`,
        [row.class_name, branch.rows[0]?.id]
      );

      if (!branch.rows.length || !cls.rows.length) {
        results.skipped++;
        results.skipDetails.push({ admission: row.admission_number, reason: 'Branch or class not found' });
        continue;
      }

      try {
        await client.query(
          `INSERT INTO students
             (admission_number, student_name, father_name, mother_name, phone1, phone2,
              dob, aadhaar, caste, sub_caste, branch_id, class_id, academic_year_id, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
             (SELECT id FROM academic_years WHERE is_current = TRUE), $13)
           ON CONFLICT (admission_number) DO NOTHING`,
          [row.admission_number, row.student_name, row.father_name, row.mother_name,
           row.phone1, row.phone2, row.dob, row.aadhaar || null, row.caste || null,
           row.sub_caste || null, branch.rows[0].id, cls.rows[0].id, req.user.id]
        );
        results.inserted++;
      } catch (innerErr) {
        results.skipped++;
        results.skipDetails.push({ admission: row.admission_number, reason: innerErr.message });
      }
    }

    await client.query('COMMIT');
    res.json({ message: 'Bulk upload complete', ...results });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('bulkUpload error:', err);
    res.status(500).json({ error: 'Bulk upload failed, transaction rolled back' });
  } finally {
    client.release();
  }
};

module.exports = { getStudents, getStudentById, createStudent, updateStudent, deleteStudent, bulkUpload };
