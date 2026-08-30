# 🚀 Backend Integration Complete!

Your Money Matters app is now connected to a backend API with authentication and cloud sync.

## ✅ What's Been Added

### Backend (`server/` folder)
- ✅ Express.js API server
- ✅ MongoDB database models (User, Expense, Goal, Budget)
- ✅ JWT authentication (register/login)
- ✅ RESTful API endpoints for all features
- ✅ Password hashing with bcrypt
- ✅ XP, level, and streak tracking

### Frontend Updates
- ✅ Authentication context & hooks
- ✅ Login/Register screens
- ✅ API service layer (`src/utils/api.js`)
- ✅ All data now syncs to backend instead of localStorage
- ✅ User profile display in menu
- ✅ Logout functionality

## 📋 Setup Instructions

### 1. Install Backend Dependencies

```bash
cd servecd r
npm install
```

### 2. Set Up MongoDB

**Option A: Local MongoDB**
- Install MongoDB: https://www.mongodb.com/try/download/community
- Start MongoDB: `mongod`
- Default connection: `mongodb://localhost:27017/money-matters`

**Option B: MongoDB Atlas (Cloud - Recommended)**
- Sign up at https://www.mongodb.com/cloud/atlas (free tier available)
- Create a cluster
- Get connection string (e.g., `mongodb+srv://user:pass@cluster.mongodb.net/money-matters`)
- Update `.env` with your connection string

### 3. Configure Backend Environment

```bash
cd server
cp .env.example .env
```

Edit `server/.env`:
```
PORT=5000
MONGODB_URI=mongodb://localhost:27017/money-matters
# OR for Atlas:
# MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/money-matters

JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
NODE_ENV=development
```

### 4. Start Backend Server

```bash
cd server
npm run dev
```

Server runs on `http://localhost:5000`

### 5. Configure Frontend

Create `.env` in the project root (same level as `package.json`):

```bash
VITE_API_URL=http://localhost:5000/api
```

### 6. Start Frontend

```bash
npm run dev
```

Frontend runs on `http://localhost:5173`

## 🎯 How It Works

### Authentication Flow
1. User opens app → sees Login screen
2. User registers/logs in → receives JWT token
3. Token stored in localStorage
4. All API requests include token in Authorization header
5. Backend validates token and returns user data

### Data Sync
- **Expenses**: Saved to MongoDB, synced across devices
- **Goals**: Stored per user, accessible from any device
- **Budget**: User-specific, cloud-synced
- **XP/Level/Streak**: Calculated server-side, synced automatically

### API Endpoints

All endpoints require authentication (Bearer token):

- `POST /api/auth/register` - Create account
- `POST /api/auth/login` - Login
- `GET /api/expenses` - Get all expenses
- `POST /api/expenses` - Add expense
- `DELETE /api/expenses/:id` - Delete expense
- `GET /api/expenses/totals` - Get today/month totals
- `GET /api/goals` - Get all goals
- `POST /api/goals` - Create goal
- `PATCH /api/goals/:id/deposit` - Deposit to goal
- `DELETE /api/goals/:id` - Delete goal
- `GET /api/budget` - Get budget
- `PUT /api/budget` - Update budget
- `GET /api/user/profile` - Get user profile

## 🔐 Security Features

- ✅ Passwords hashed with bcrypt (never stored in plain text)
- ✅ JWT tokens expire after 30 days
- ✅ All API routes protected with authentication middleware
- ✅ User data isolated (users can only access their own data)

## 📱 Testing

1. **Register a new account**:
   - Open app → Click "Sign up"
   - Enter name, email, password (min 6 chars)
   - Account created, auto-logged in

2. **Add expenses**:
   - Go to Home tab
   - Add expense → Saved to database
   - XP increases automatically

3. **Create goals**:
   - Go to Goals tab
   - Create goal → Saved to database
   - Deposit money → Updates in real-time

4. **Set budget**:
   - Go to Budget tab
   - Enter income/fixed/savings → Auto-saved

5. **Logout & Login**:
   - Open menu → Click "Logout"
   - Login again → All data loads from server

## 🚀 Deployment

### Backend Deployment (e.g., Railway, Render, Heroku)

1. Push `server/` folder to GitHub
2. Deploy to platform (Railway/Render recommended)
3. Set environment variables:
   - `MONGODB_URI` (your MongoDB connection)
   - `JWT_SECRET` (random secret string)
   - `PORT` (usually auto-set by platform)
4. Update frontend `.env`:
   ```
   VITE_API_URL=https://your-backend-url.com/api
   ```

### Frontend Deployment

Deploy as before (Vercel/Netlify), but make sure `.env` is set with your backend URL.

## 🐛 Troubleshooting

**"Failed to load data"**
- Check backend is running (`http://localhost:5000/api/health`)
- Check MongoDB is running/connected
- Check `.env` files are set correctly

**"Token is not valid"**
- User logged out → Login again
- Token expired → Login again

**"User already exists"**
- Email already registered → Use login instead

**CORS errors**
- Backend CORS is configured for all origins
- If issues persist, check `server/server.js` cors settings

---

🎉 **Your app now has a full backend with authentication and cloud sync!**
