# Akshara School Fee Management System — Backend

Node.js + Express + PostgreSQL REST API.

---

## Folder Structure

```
akshara-backend/
├── sql/
│   └── schema.sql              ← Full PostgreSQL schema (run this first)
├── src/
│   ├── app.js                  ← Express entry point
│   ├── config/
│   │   └── db.js               ← PostgreSQL connection pool
│   ├── middleware/
│   │   └── auth.js             ← JWT + role + branch access guards
│   ├── routes/
│   │   └── index.js            ← All route definitions
│   ├── controllers/
│   │   ├── authController.js
│   │   ├── studentController.js
│   │   ├── feeController.js
│   │   ├── reportController.js
│   │   ├── userController.js
│   │   └── settingsController.js
│   └── utils/
│       └── smsService.js       ← MSG91 SMS integration
├── .env.example
└── package.json
```

---

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Create your `.env` file
```bash
cp .env.example .env
# Edit .env and fill in your database credentials, JWT secret, and SMS API key
```

### 3. Set up PostgreSQL
```bash
# Create database and user
psql -U postgres -c "CREATE DATABASE akshara_school;"
psql -U postgres -c "CREATE USER akshara_user WITH PASSWORD 'your_password';"
psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE akshara_school TO akshara_user;"

# Run the schema
psql -U akshara_user -d akshara_school -f sql/schema.sql
```

### 4. Start the server
```bash
# Development (with hot reload)
npm run dev

# Production
npm start
```

---

## API Reference

### Authentication
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/login` | Public | Login, returns JWT |
| POST | `/api/auth/change-password` | User | Change own password |
| POST | `/api/auth/admin/reset-password` | Admin | Reset any user's password |

### Students
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/students` | User | List students (branch-filtered) |
| GET | `/api/students/:id` | User | Get one student |
| POST | `/api/students` | User | Create student |
| PUT | `/api/students/:id` | User | Update student |
| DELETE | `/api/students/:id` | Admin | Soft-delete student |
| POST | `/api/students/bulk-upload` | Admin | Upload Excel file |

### Fees
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/fees/collect` | User | Record payment + auto receipt |
| GET | `/api/fees/transactions` | User | Payment history |
| GET | `/api/fees/pending` | User | Students with dues |
| POST | `/api/fees/send-reminders` | Accountant+ | Send bulk SMS reminders |

### Reports
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/reports/collection-summary` | User | Branch/class-wise summary |
| GET | `/api/reports/defaulters` | User | Students with pending dues |
| GET | `/api/reports/daybook` | User | Day-wise transactions |
| GET | `/api/reports/export?type=defaulters` | Accountant+ | Download Excel |

### Users (Admin only)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/users` | List all users with branch access |
| POST | `/api/users` | Create user |
| PUT | `/api/users/:id` | Update user / change branches |
| DELETE | `/api/users/:id` | Deactivate user |
| GET | `/api/users/:id/activity` | View user activity log |

### Settings (Admin only)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/settings/promote-class` | Bulk promote students |
| GET/POST | `/api/settings/branches` | Manage branches |
| GET/POST | `/api/settings/academic-years` | Manage academic years |

---

## Default Admin Login

```
Username: admin
Password: Admin@1234
```
**Change this immediately after first login.**

---

## Excel Bulk Upload Format

The bulk upload file must have these column headers:

| Column | Required | Notes |
|--------|----------|-------|
| admission_number | Yes | Must be unique |
| student_name | Yes | Full name |
| father_name | No | |
| mother_name | No | |
| phone1 | Yes | Father's mobile |
| phone2 | No | Mother/guardian |
| dob | Yes | YYYY-MM-DD format |
| aadhaar | No | 12 digits |
| caste | No | OC, SC, ST, BC-A … BC-F |
| sub_caste | No | |
| branch_name | Yes | Must match branch exactly |
| class_name | Yes | e.g. "Class 5" |

---

## Security Notes

- All passwords are hashed with bcrypt (12 rounds)
- JWT tokens expire after 8 hours (configurable)
- Branch access is enforced in every query via middleware
- Only `admin` role can delete students or users
- Rate limiting: 10 login attempts / 15 min; 200 API calls / min
- Soft delete used throughout — no data is permanently destroyed
