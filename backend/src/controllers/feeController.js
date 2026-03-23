const db     = require('../config/db');
const sms    = require('../utils/smsService');

// ── POST /fees/collect ────────────────────────────────────────
const collectFee = async (req, res) => {
  const {
    student_id, fee_head_id, term, amount_due,
    amount_paid, payment_mode, reference_id, notes
  } = req.body;

  if (!student_id || !fee_head_id || !amount_due || !amount_paid || !payment_mode) {
    return res.status(400).json({ error: 'Required fields missing' });
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Verify student belongs to an allowed branch
    const studentQ = await client.query(
      `SELECT s.id, s.student_name, s.phone1, s.branch_id, ay.label AS year_label
       FROM students s
       JOIN academic_years ay ON ay.id = s.academic_year_id
       WHERE s.id = $1 AND s.is_active = TRUE`,
      [student_id]
    );
    const student = studentQ.rows[0];
    if (!student) return res.status(404).json({ error: 'Student not found' });
    if (!req.allowedBranchIds.includes(student.branch_id)) {
      return res.status(403).json({ error: 'Branch access denied' });
    }

    // Generate receipt number
    const receiptQ = await client.query(
      'SELECT generate_receipt_number($1, $2) AS receipt_number',
      [student.branch_id, student.year_label]
    );
    const receiptNumber = receiptQ.rows[0].receipt_number;

    const status = parseFloat(amount_paid) >= parseFloat(amount_due)
      ? 'paid' : parseFloat(amount_paid) > 0 ? 'partial' : 'due';

    const { rows } = await client.query(
      `INSERT INTO fee_transactions
         (receipt_number, student_id, fee_head_id, academic_year_id, term,
          amount_due, amount_paid, status, payment_mode, reference_id,
          payment_date, collected_by, notes)
       SELECT $1, $2, $3, s.academic_year_id, $4, $5, $6, $7, $8, $9, NOW()::DATE, $10, $11
       FROM students s WHERE s.id = $2
       RETURNING id, receipt_number, amount_paid, status`,
      [receiptNumber, student_id, fee_head_id, term || null,
       amount_due, amount_paid, status, payment_mode, reference_id || null,
       req.user.id, notes || null]
    );

    await client.query('COMMIT');

    // Send SMS receipt (non-blocking)
    sms.sendReceipt({
      phone:   student.phone1,
      name:    student.student_name,
      amount:  amount_paid,
      receipt: receiptNumber,
    }).catch(err => console.error('SMS failed:', err));

    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('collectFee error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
};

// ── GET /fees/transactions ────────────────────────────────────
const getTransactions = async (req, res) => {
  const { student_id, branch_id, status, from_date, to_date, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;
  const params = [];
  const conds  = ['ft.student_id IS NOT NULL'];

  // Branch access filter
  conds.push(`s.branch_id = ANY($${params.push(req.allowedBranchIds)})`);
  if (branch_id) conds.push(`s.branch_id = $${params.push(parseInt(branch_id))}`);
  if (student_id) conds.push(`ft.student_id = $${params.push(parseInt(student_id))}`);
  if (status)     conds.push(`ft.status = $${params.push(status)}`);
  if (from_date)  conds.push(`ft.payment_date >= $${params.push(from_date)}`);
  if (to_date)    conds.push(`ft.payment_date <= $${params.push(to_date)}`);

  const where = conds.join(' AND ');

  try {
    const { rows } = await db.query(
      `SELECT ft.id, ft.receipt_number, ft.term, ft.amount_due, ft.amount_paid,
              ft.balance, ft.status, ft.payment_mode, ft.payment_date,
              ft.reference_id, ft.notes,
              s.student_name, s.admission_number,
              fh.name AS fee_head_name,
              b.name  AS branch_name,
              u.name  AS collected_by_name
       FROM fee_transactions ft
       JOIN students       s  ON s.id  = ft.student_id
       JOIN branches       b  ON b.id  = s.branch_id
       JOIN fee_heads      fh ON fh.id = ft.fee_head_id
       LEFT JOIN users     u  ON u.id  = ft.collected_by
       WHERE ${where}
       ORDER BY ft.created_at DESC
       LIMIT $${params.push(parseInt(limit))} OFFSET $${params.push(offset)}`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('getTransactions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── GET /fees/pending ─────────────────────────────────────────
const getPendingDues = async (req, res) => {
  const { branch_id, class_id, academic_year_id } = req.query;
  const params = [req.allowedBranchIds];
  const conds  = ['s.is_active = TRUE', 's.branch_id = ANY($1)', 'vfs.total_balance > 0'];

  if (branch_id)        conds.push(`s.branch_id = $${params.push(parseInt(branch_id))}`);
  if (class_id)         conds.push(`s.class_id  = $${params.push(parseInt(class_id))}`);
  if (academic_year_id) conds.push(`s.academic_year_id = $${params.push(parseInt(academic_year_id))}`);

  try {
    const { rows } = await db.query(
      `SELECT vfs.student_id, vfs.admission_number, vfs.student_name, vfs.phone1,
              vfs.class_name, vfs.section, vfs.branch_name,
              vfs.total_due, vfs.total_paid, vfs.total_balance
       FROM v_student_fee_summary vfs
       JOIN students s ON s.id = vfs.student_id
       WHERE ${conds.join(' AND ')}
       ORDER BY vfs.total_balance DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('getPendingDues error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── POST /fees/send-reminders ────────────────────────────────
const sendReminders = async (req, res) => {
  const { studentIds } = req.body;  // array of student IDs or empty for all pending
  try {
    let query, params;
    if (studentIds && studentIds.length) {
      query  = `SELECT s.id, s.student_name, s.phone1, vfs.total_balance
                FROM v_student_fee_summary vfs
                JOIN students s ON s.id = vfs.student_id
                WHERE s.id = ANY($1) AND vfs.total_balance > 0 AND s.is_active = TRUE`;
      params = [studentIds];
    } else {
      query  = `SELECT s.id, s.student_name, s.phone1, vfs.total_balance
                FROM v_student_fee_summary vfs
                JOIN students s ON s.id = vfs.student_id
                WHERE s.branch_id = ANY($1) AND vfs.total_balance > 0 AND s.is_active = TRUE`;
      params = [req.allowedBranchIds];
    }

    const { rows } = await db.query(query, params);
    let sent = 0;

    for (const student of rows) {
      try {
        await sms.sendReminder({
          phone:   student.phone1,
          name:    student.student_name,
          balance: student.total_balance,
        });
        await db.query(
          `INSERT INTO sms_log (student_id, phone, message_type, message_body, status, sent_at)
           VALUES ($1, $2, 'reminder', $3, 'sent', NOW())`,
          [student.id, student.phone1, `Dear parent, fee due: ₹${student.total_balance}`]
        );
        sent++;
      } catch (_) { /* continue */ }
    }

    res.json({ message: `Reminders sent to ${sent} students`, total: rows.length, sent });
  } catch (err) {
    console.error('sendReminders error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = { collectFee, getTransactions, getPendingDues, sendReminders };
