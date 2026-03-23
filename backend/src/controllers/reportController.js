const db      = require('../config/db');
const ExcelJS = require('exceljs');

// ── GET /reports/collection-summary ──────────────────────────
const collectionSummary = async (req, res) => {
  const { academic_year_id } = req.query;
  const params = [req.allowedBranchIds];
  const conds  = ['s.branch_id = ANY($1)', 's.is_active = TRUE'];
  if (academic_year_id) conds.push(`s.academic_year_id = $${params.push(parseInt(academic_year_id))}`);

  try {
    const { rows } = await db.query(
      `SELECT b.name AS branch, c.name AS class, c.section,
              COUNT(DISTINCT s.id)           AS total_students,
              COALESCE(SUM(ft.amount_due),  0) AS total_due,
              COALESCE(SUM(ft.amount_paid), 0) AS total_collected,
              COALESCE(SUM(ft.balance),     0) AS total_pending
       FROM students s
       JOIN branches b       ON b.id  = s.branch_id
       JOIN classes  c       ON c.id  = s.class_id
       LEFT JOIN fee_transactions ft ON ft.student_id = s.id
       WHERE ${conds.join(' AND ')}
       GROUP BY b.name, c.name, c.section
       ORDER BY b.name, c.name`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('collectionSummary error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── GET /reports/defaulters ───────────────────────────────────
const defaulters = async (req, res) => {
  const { branch_id, min_balance = 0 } = req.query;
  const params = [req.allowedBranchIds, parseFloat(min_balance)];
  const conds  = ['s.branch_id = ANY($1)', 's.is_active = TRUE', 'vfs.total_balance > $2'];
  if (branch_id) conds.push(`s.branch_id = $${params.push(parseInt(branch_id))}`);

  try {
    const { rows } = await db.query(
      `SELECT vfs.admission_number, vfs.student_name, vfs.phone1,
              vfs.class_name, vfs.section, vfs.branch_name,
              vfs.total_due, vfs.total_paid, vfs.total_balance,
              MAX(ft.payment_date) AS last_payment_date
       FROM v_student_fee_summary vfs
       JOIN students s ON s.id = vfs.student_id
       LEFT JOIN fee_transactions ft ON ft.student_id = s.id AND ft.status != 'due'
       WHERE ${conds.join(' AND ')}
       GROUP BY vfs.student_id, vfs.admission_number, vfs.student_name, vfs.phone1,
                vfs.class_name, vfs.section, vfs.branch_name,
                vfs.total_due, vfs.total_paid, vfs.total_balance
       ORDER BY vfs.total_balance DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('defaulters error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── GET /reports/daybook ──────────────────────────────────────
const daybook = async (req, res) => {
  const { from_date, to_date, branch_id } = req.query;
  if (!from_date || !to_date) {
    return res.status(400).json({ error: 'from_date and to_date are required' });
  }

  const params = [req.allowedBranchIds, from_date, to_date];
  const conds  = [
    's.branch_id = ANY($1)',
    'ft.payment_date >= $2',
    'ft.payment_date <= $3',
    'ft.status != \'due\''
  ];
  if (branch_id) conds.push(`s.branch_id = $${params.push(parseInt(branch_id))}`);

  try {
    const { rows } = await db.query(
      `SELECT ft.payment_date, ft.payment_mode, ft.receipt_number,
              s.student_name, s.admission_number,
              fh.name AS fee_head, ft.term,
              ft.amount_paid, b.name AS branch_name,
              u.name AS collected_by
       FROM fee_transactions ft
       JOIN students   s  ON s.id  = ft.student_id
       JOIN branches   b  ON b.id  = s.branch_id
       JOIN fee_heads  fh ON fh.id = ft.fee_head_id
       LEFT JOIN users u  ON u.id  = ft.collected_by
       WHERE ${conds.join(' AND ')}
       ORDER BY ft.payment_date, ft.receipt_number`,
      params
    );

    // Totals by payment mode
    const totals = rows.reduce((acc, r) => {
      acc[r.payment_mode] = (acc[r.payment_mode] || 0) + parseFloat(r.amount_paid);
      acc.grand_total     = (acc.grand_total     || 0) + parseFloat(r.amount_paid);
      return acc;
    }, {});

    res.json({ transactions: rows, totals });
  } catch (err) {
    console.error('daybook error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── GET /reports/export ───────────────────────────────────────
// Returns an Excel file for any of the above report types
const exportReport = async (req, res) => {
  const { type, branch_id, from_date, to_date, academic_year_id } = req.query;

  let data = [];
  let sheetName = 'Report';
  let filename  = 'report.xlsx';

  // Re-use existing report queries
  if (type === 'defaulters') {
    req.query.min_balance = 0;
    const fakeRes = { json: (rows) => { data = rows; } };
    await defaulters({ ...req, query: req.query }, fakeRes);
    sheetName = 'Defaulters';
    filename  = 'defaulters.xlsx';
  } else if (type === 'daybook') {
    const fakeRes = { json: (d) => { data = d.transactions; } };
    await daybook({ ...req, query: req.query }, fakeRes);
    sheetName = 'Day Book';
    filename  = `daybook_${from_date}_to_${to_date}.xlsx`;
  } else if (type === 'collection') {
    const fakeRes = { json: (rows) => { data = rows; } };
    await collectionSummary({ ...req, query: req.query }, fakeRes);
    sheetName = 'Collection Summary';
    filename  = 'collection_summary.xlsx';
  } else {
    return res.status(400).json({ error: 'Invalid report type' });
  }

  // Build Excel workbook
  const workbook  = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName);

  if (data.length) {
    // Auto-generate columns from first row keys
    worksheet.columns = Object.keys(data[0]).map(key => ({
      header: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      key,
      width: 20
    }));

    // Header styling
    worksheet.getRow(1).font  = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill  = {
      type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A5C9E' }
    };
    worksheet.getRow(1).alignment = { horizontal: 'center' };

    // Data rows
    data.forEach(row => worksheet.addRow(row));

    // Alternate row shading
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1 && rowNumber % 2 === 0) {
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F4FA' } };
      }
    });
  }

  res.setHeader('Content-Type',        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);
  res.end();
};

module.exports = { collectionSummary, defaulters, daybook, exportReport };
