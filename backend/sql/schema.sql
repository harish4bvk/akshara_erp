-- ============================================================
-- AKSHARA SCHOOL FEE MANAGEMENT SYSTEM
-- PostgreSQL Schema
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE user_role AS ENUM ('admin', 'accountant', 'data_entry', 'viewer');
CREATE TYPE caste_category AS ENUM ('OC', 'SC', 'ST', 'BC-A', 'BC-B', 'BC-C', 'BC-D', 'BC-E', 'BC-F');
CREATE TYPE fee_frequency AS ENUM ('per_term', 'annual', 'per_exam');
CREATE TYPE payment_mode AS ENUM ('cash', 'upi', 'neft', 'rtgs', 'cheque', 'dd');
CREATE TYPE sms_status AS ENUM ('sent', 'failed', 'pending');
CREATE TYPE payment_status AS ENUM ('paid', 'partial', 'due', 'waived');

-- ============================================================
-- BRANCHES
-- ============================================================

CREATE TABLE branches (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    address     TEXT,
    city        VARCHAR(100),
    phone       VARCHAR(15),
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO branches (name, city, phone) VALUES
  ('Kukatpally', 'Hyderabad', '040-23456789'),
  ('Miyapur',    'Hyderabad', '040-23456790'),
  ('KPHB',       'Hyderabad', '040-23456791'),
  ('Bachupally', 'Hyderabad', '040-23456792'),
  ('Kondapur',   'Hyderabad', '040-23456793');

-- ============================================================
-- ACADEMIC YEARS
-- ============================================================

CREATE TABLE academic_years (
    id          SERIAL PRIMARY KEY,
    label       VARCHAR(20)  NOT NULL UNIQUE, -- e.g. "2024-25"
    start_date  DATE         NOT NULL,
    end_date    DATE         NOT NULL,
    is_current  BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Ensure only one academic year is current at a time
CREATE UNIQUE INDEX unique_current_year ON academic_years (is_current) WHERE is_current = TRUE;

INSERT INTO academic_years (label, start_date, end_date, is_current) VALUES
  ('2023-24', '2023-06-01', '2024-03-31', FALSE),
  ('2024-25', '2024-06-01', '2025-03-31', TRUE);

-- ============================================================
-- USERS
-- ============================================================

CREATE TABLE users (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(100)  NOT NULL,
    username        VARCHAR(50)   NOT NULL UNIQUE,
    password_hash   TEXT          NOT NULL,
    role            user_role     NOT NULL DEFAULT 'data_entry',
    is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
    last_login      TIMESTAMPTZ,
    last_module     VARCHAR(50),
    created_by      INTEGER       REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Branch-level access control (admin bypasses this table)
CREATE TABLE user_branch_access (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    branch_id   INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, branch_id)
);

-- Seed admin user (password: Admin@1234 — change immediately after deploy)
INSERT INTO users (name, username, password_hash, role) VALUES
  ('System Admin', 'admin',
   crypt('Admin@1234', gen_salt('bf', 12)),
   'admin');

-- ============================================================
-- CLASSES
-- ============================================================

CREATE TABLE classes (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(20)  NOT NULL,  -- "Class 1", "Class 10"
    section         VARCHAR(5)   NOT NULL DEFAULT 'A',
    branch_id       INTEGER      NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    academic_year_id INTEGER     NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (name, section, branch_id, academic_year_id)
);

-- ============================================================
-- STUDENTS
-- ============================================================

CREATE TABLE students (
    id                  SERIAL PRIMARY KEY,
    admission_number    VARCHAR(30)      NOT NULL UNIQUE,
    student_name        VARCHAR(150)     NOT NULL,
    father_name         VARCHAR(150),
    mother_name         VARCHAR(150),
    phone1              VARCHAR(15)      NOT NULL,   -- Father
    phone2              VARCHAR(15),                 -- Mother/Guardian
    dob                 DATE             NOT NULL,
    aadhaar             VARCHAR(12),                 -- Optional
    caste               caste_category,
    sub_caste           VARCHAR(100),
    branch_id           INTEGER          NOT NULL REFERENCES branches(id),
    class_id            INTEGER          NOT NULL REFERENCES classes(id),
    academic_year_id    INTEGER          NOT NULL REFERENCES academic_years(id),
    is_active           BOOLEAN          NOT NULL DEFAULT TRUE,
    created_by          INTEGER          REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_students_branch     ON students(branch_id);
CREATE INDEX idx_students_class      ON students(class_id);
CREATE INDEX idx_students_year       ON students(academic_year_id);
CREATE INDEX idx_students_phone1     ON students(phone1);
CREATE INDEX idx_students_name       ON students USING gin(to_tsvector('english', student_name));

-- ============================================================
-- FEE STRUCTURE
-- ============================================================

CREATE TABLE fee_heads (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(100)    NOT NULL,
    description     TEXT,
    frequency       fee_frequency   NOT NULL DEFAULT 'per_term',
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

INSERT INTO fee_heads (name, frequency) VALUES
  ('Tuition Fee',   'per_term'),
  ('Transport Fee', 'per_term'),
  ('Lab Fee',       'annual'),
  ('Exam Fee',      'per_exam'),
  ('Annual Day Fee','annual');

-- Fee amounts per class group, branch, and academic year
CREATE TABLE fee_structure (
    id              SERIAL PRIMARY KEY,
    fee_head_id     INTEGER         NOT NULL REFERENCES fee_heads(id) ON DELETE CASCADE,
    branch_id       INTEGER         NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    academic_year_id INTEGER        NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    class_group     VARCHAR(10)     NOT NULL, -- '1-5', '6-8', '9-10'
    amount          NUMERIC(10,2)   NOT NULL CHECK (amount >= 0),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    UNIQUE (fee_head_id, branch_id, academic_year_id, class_group)
);

-- ============================================================
-- FEE TRANSACTIONS (RECEIPTS)
-- ============================================================

CREATE SEQUENCE receipt_seq START 1000;

CREATE TABLE fee_transactions (
    id              SERIAL PRIMARY KEY,
    receipt_number  VARCHAR(30)     NOT NULL UNIQUE,
    student_id      INTEGER         NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
    fee_head_id     INTEGER         NOT NULL REFERENCES fee_heads(id),
    academic_year_id INTEGER        NOT NULL REFERENCES academic_years(id),
    term            VARCHAR(20),                    -- 'Term 1', 'Term 2', 'Annual' etc.
    amount_due      NUMERIC(10,2)   NOT NULL,
    amount_paid     NUMERIC(10,2)   NOT NULL CHECK (amount_paid >= 0),
    balance         NUMERIC(10,2)   GENERATED ALWAYS AS (amount_due - amount_paid) STORED,
    status          payment_status  NOT NULL DEFAULT 'due',
    payment_mode    payment_mode,
    reference_id    VARCHAR(100),                   -- UPI/Cheque ref
    payment_date    DATE,
    collected_by    INTEGER         REFERENCES users(id) ON DELETE SET NULL,
    notes           TEXT,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_txn_student    ON fee_transactions(student_id);
CREATE INDEX idx_txn_date       ON fee_transactions(payment_date);
CREATE INDEX idx_txn_status     ON fee_transactions(status);

-- Auto-generate receipt numbers (e.g. KPHB-2025-001234)
CREATE OR REPLACE FUNCTION generate_receipt_number(p_branch_id INT, p_year_label VARCHAR)
RETURNS VARCHAR AS $$
DECLARE
    branch_code VARCHAR;
    seq_val     BIGINT;
BEGIN
    SELECT UPPER(LEFT(name, 4)) INTO branch_code FROM branches WHERE id = p_branch_id;
    seq_val := nextval('receipt_seq');
    RETURN branch_code || '-' || SUBSTRING(p_year_label, 6, 2) || '-' || LPAD(seq_val::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- SMS LOG
-- ============================================================

CREATE TABLE sms_log (
    id              SERIAL PRIMARY KEY,
    student_id      INTEGER         REFERENCES students(id) ON DELETE SET NULL,
    phone           VARCHAR(15)     NOT NULL,
    message_type    VARCHAR(50)     NOT NULL,  -- 'receipt', 'reminder', 'custom'
    message_body    TEXT            NOT NULL,
    status          sms_status      NOT NULL DEFAULT 'pending',
    gateway_ref     VARCHAR(100),
    sent_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- ============================================================
-- USER ACTIVITY LOG
-- ============================================================

CREATE TABLE user_activity_log (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    module      VARCHAR(50)     NOT NULL,
    action      VARCHAR(100)    NOT NULL,
    ip_address  INET,
    metadata    JSONB,
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_activity_user ON user_activity_log(user_id);
CREATE INDEX idx_activity_time ON user_activity_log(created_at);

-- ============================================================
-- TRIGGERS: updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_students_updated
  BEFORE UPDATE ON students
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- VIEWS: commonly used aggregations
-- ============================================================

-- Student fee summary view
CREATE VIEW v_student_fee_summary AS
SELECT
    s.id                AS student_id,
    s.admission_number,
    s.student_name,
    s.phone1,
    b.name              AS branch_name,
    c.name              AS class_name,
    c.section,
    ay.label            AS academic_year,
    COALESCE(SUM(ft.amount_due),  0) AS total_due,
    COALESCE(SUM(ft.amount_paid), 0) AS total_paid,
    COALESCE(SUM(ft.balance),     0) AS total_balance
FROM students s
JOIN branches b       ON b.id = s.branch_id
JOIN classes c        ON c.id = s.class_id
JOIN academic_years ay ON ay.id = s.academic_year_id
LEFT JOIN fee_transactions ft ON ft.student_id = s.id
WHERE s.is_active = TRUE
GROUP BY s.id, s.admission_number, s.student_name, s.phone1,
         b.name, c.name, c.section, ay.label;

-- Branch collection summary view
CREATE VIEW v_branch_collection AS
SELECT
    b.name              AS branch_name,
    ay.label            AS academic_year,
    COUNT(DISTINCT s.id)            AS total_students,
    COALESCE(SUM(ft.amount_due),  0) AS total_due,
    COALESCE(SUM(ft.amount_paid), 0) AS total_collected,
    COALESCE(SUM(ft.balance),     0) AS total_pending
FROM branches b
JOIN students s        ON s.branch_id = b.id AND s.is_active = TRUE
JOIN academic_years ay ON ay.id = s.academic_year_id
LEFT JOIN fee_transactions ft ON ft.student_id = s.id
GROUP BY b.name, ay.label;
