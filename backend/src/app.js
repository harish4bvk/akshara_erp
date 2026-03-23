require('dotenv').config();

const express      = require('express');
const helmet       = require('helmet');
const cors         = require('cors');
const compression  = require('compression');
const morgan       = require('morgan');
const rateLimit    = require('express-rate-limit');

const routes = require('./routes/index');

const app = express();

// ── Security & utility middleware ────────────────────────────
app.use(helmet());
app.use(cors({
  origin:      process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  credentials: true,
}));
app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '10mb' }));

// ── Rate limiting ─────────────────────────────────────────────
app.use('/api/auth/login', rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max:      10,               // max 10 login attempts
  message:  { error: 'Too many login attempts. Try again after 15 minutes.' }
}));

app.use('/api', rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  max:      200,
}));

// ── Routes ────────────────────────────────────────────────────
app.use('/api', routes);

// ── Health check ──────────────────────────────────────────────
app.get('/health', (req, res) => res.json({
  status: 'ok',
  service: 'Akshara School Fee Management API',
  timestamp: new Date().toISOString()
}));

// ── 404 handler ───────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// ── Global error handler ──────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start server ──────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🏫  Akshara School API running on port ${PORT}`);
  console.log(`📦  Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`✅  Health: http://localhost:${PORT}/health\n`);
});

module.exports = app;
