# 💰 Money Matters Backend API

Backend server for Money Matters app with authentication, data storage, and sync.

## Features

- 👤 User registration & login (JWT authentication)
- 💾 Store expenses, goals, and budget in MongoDB
- 📊 Calculate totals & savings
- ☁️ Sync data across devices
- 🔐 Secure password hashing (bcrypt)

## Setup

### 1. Install dependencies

```bash
cd server
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and update:

```bash
cp .env.example .env
```

Edit `.env`:
```
PORT=5000
MONGODB_URI=mongodb://localhost:27017/money-matters
JWT_SECRET=your-super-secret-jwt-key-change-this
NODE_ENV=development
```

### 3. Start MongoDB

Make sure MongoDB is running locally, or use MongoDB Atlas (cloud):

```bash
# Local MongoDB
mongod

# Or use MongoDB Atlas (free cloud DB)
# Update MONGODB_URI in .env to your Atlas connection string
```

### 4. Run the server

```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

Server runs on `http://localhost:5000`

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user

### Expenses
- `GET /api/expenses` - Get all expenses (requires auth)
- `POST /api/expenses` - Add expense (requires auth)
- `DELETE /api/expenses/:id` - Delete expense (requires auth)
- `GET /api/expenses/totals` - Get today/month totals (requires auth)

### Goals
- `GET /api/goals` - Get all goals (requires auth)
- `POST /api/goals` - Create goal (requires auth)
- `PATCH /api/goals/:id/deposit` - Deposit to goal (requires auth)
- `DELETE /api/goals/:id` - Delete goal (requires auth)

### Budget
- `GET /api/budget` - Get budget (requires auth)
- `PUT /api/budget` - Update budget (requires auth)

### User
- `GET /api/user/profile` - Get user profile (requires auth)

## Authentication

All protected routes require a JWT token in the Authorization header:

```
Authorization: Bearer <your-token>
```

## Database Schema

- **Users**: name, email, password (hashed), xp, level, streak
- **Expenses**: userId, amount, description, category, date
- **Goals**: userId, name, target, current
- **Budget**: userId, income, fixed, savings

---

Next: Update the React app to use this API instead of localStorage.
