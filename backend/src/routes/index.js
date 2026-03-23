const express        = require('express');
const multer         = require('multer');
const router         = express.Router();
const upload         = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const auth           = require('../middleware/auth');
const authCtrl       = require('../controllers/authController');
const studentCtrl    = require('../controllers/studentController');
const feeCtrl        = require('../controllers/feeController');
const reportCtrl     = require('../controllers/reportController');

const { authenticate, requireRole, resolveBranchAccess, logActivity } = auth;

// ── Auth (public) ─────────────────────────────────────────────
router.post('/auth/login',  authCtrl.login);

// ── Auth (protected) ─────────────────────────────────────────
router.post('/auth/change-password',       authenticate, authCtrl.changePassword);
router.post('/auth/admin/reset-password',  authenticate, requireRole('admin'), authCtrl.adminResetPassword);

// ── Students ──────────────────────────────────────────────────
router.get(
  '/students',
  authenticate, resolveBranchAccess, logActivity('students', 'list'),
  studentCtrl.getStudents
);
router.get(
  '/students/:id',
  authenticate, resolveBranchAccess,
  studentCtrl.getStudentById
);
router.post(
  '/students',
  authenticate, resolveBranchAccess, logActivity('students', 'create'),
  studentCtrl.createStudent
);
router.put(
  '/students/:id',
  authenticate, resolveBranchAccess, logActivity('students', 'update'),
  studentCtrl.updateStudent
);
router.delete(
  '/students/:id',
  authenticate, requireRole('admin'), logActivity('students', 'delete'),
  studentCtrl.deleteStudent
);
router.post(
  '/students/bulk-upload',
  authenticate, requireRole('admin'),
  upload.single('file'),
  logActivity('students', 'bulk_upload'),
  studentCtrl.bulkUpload
);

// ── Fees ──────────────────────────────────────────────────────
router.post(
  '/fees/collect',
  authenticate, resolveBranchAccess, logActivity('fees', 'collect'),
  feeCtrl.collectFee
);
router.get(
  '/fees/transactions',
  authenticate, resolveBranchAccess, logActivity('fees', 'transactions'),
  feeCtrl.getTransactions
);
router.get(
  '/fees/pending',
  authenticate, resolveBranchAccess,
  feeCtrl.getPendingDues
);
router.post(
  '/fees/send-reminders',
  authenticate, resolveBranchAccess, requireRole(['admin', 'accountant']),
  feeCtrl.sendReminders
);

// ── Reports ───────────────────────────────────────────────────
router.get(
  '/reports/collection-summary',
  authenticate, resolveBranchAccess, logActivity('reports', 'collection'),
  reportCtrl.collectionSummary
);
router.get(
  '/reports/defaulters',
  authenticate, resolveBranchAccess, logActivity('reports', 'defaulters'),
  reportCtrl.defaulters
);
router.get(
  '/reports/daybook',
  authenticate, resolveBranchAccess, logActivity('reports', 'daybook'),
  reportCtrl.daybook
);
router.get(
  '/reports/export',
  authenticate, resolveBranchAccess, requireRole(['admin', 'accountant']),
  reportCtrl.exportReport
);

// ── Users (admin only) ────────────────────────────────────────
const userCtrl = require('../controllers/userController');
router.get(    '/users',       authenticate, requireRole('admin'), userCtrl.getUsers);
router.post(   '/users',       authenticate, requireRole('admin'), userCtrl.createUser);
router.put(    '/users/:id',   authenticate, requireRole('admin'), userCtrl.updateUser);
router.delete( '/users/:id',   authenticate, requireRole('admin'), userCtrl.deleteUser);
router.get(    '/users/:id/activity', authenticate, requireRole('admin'), userCtrl.getUserActivity);

// ── Settings (admin only) ─────────────────────────────────────
const settingsCtrl = require('../controllers/settingsController');
router.post('/settings/promote-class',  authenticate, requireRole('admin'), settingsCtrl.promoteClass);
router.get( '/settings/branches',       authenticate, settingsCtrl.getBranches);
router.post('/settings/branches',       authenticate, requireRole('admin'), settingsCtrl.createBranch);
router.get( '/settings/academic-years', authenticate, settingsCtrl.getAcademicYears);
router.post('/settings/academic-years', authenticate, requireRole('admin'), settingsCtrl.createAcademicYear);

module.exports = router;
