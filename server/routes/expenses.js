import express from 'express';
import { body, validationResult } from 'express-validator';
import { authenticate } from '../middleware/auth.js';
import Expense from '../models/Expense.js';
import User from '../models/User.js';
import { todayStr, yesterdayStr } from '../utils/dateHelpers.js';

const router = express.Router();

// Get all expenses
router.get('/', authenticate, async (req, res) => {
  try {
    const expenses = await Expense.find({ userId: req.user._id })
      .sort({ date: -1 })
      .limit(100);
    res.json(expenses);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Add expense
router.post(
  '/',
  authenticate,
  [
    body('amount').isFloat({ min: 0 }).withMessage('Amount must be positive'),
    body('category')
      .isIn(['Food', 'Transport', 'Travel', 'Shopping', 'Bills', 'Other'])
      .withMessage('Invalid category'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { amount, description, category } = req.body;

      const expense = new Expense({
        userId: req.user._id,
        amount: Number(amount),
        description: description || category,
        category: category || 'Other',
      });

      await expense.save();

      // Update user XP and streak
      const user = await User.findById(req.user._id);
      user.xp += 10;
      const newLevel = Math.floor(user.xp / 100) + 1;
      if (newLevel > user.level) {
        user.level = newLevel;
      }

      // Update streak
      const today = todayStr();
      const yesterday = yesterdayStr();
      if (!user.lastActivityDate) {
        user.streak = 1;
      } else if (user.lastActivityDate === today) {
        // Already logged today, keep streak
      } else if (user.lastActivityDate === yesterday) {
        user.streak += 1;
      } else {
        user.streak = 1;
      }
      user.lastActivityDate = today;
      await user.save();

      res.status(201).json(expense);
    } catch (error) {
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }
);

// Delete expense
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const expense = await Expense.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!expense) {
      return res.status(404).json({ message: 'Expense not found' });
    }

    res.json({ message: 'Expense deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get totals (today, this month)
router.get('/totals', authenticate, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    const todayExpenses = await Expense.aggregate([
      {
        $match: {
          userId: req.user._id,
          date: { $gte: today },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' },
        },
      },
    ]);

    const monthExpenses = await Expense.aggregate([
      {
        $match: {
          userId: req.user._id,
          date: { $gte: monthStart },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' },
        },
      },
    ]);

    res.json({
      today: todayExpenses[0]?.total || 0,
      month: monthExpenses[0]?.total || 0,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

export default router;
