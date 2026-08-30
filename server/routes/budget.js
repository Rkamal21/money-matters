import express from 'express';
import { body, validationResult } from 'express-validator';
import { authenticate } from '../middleware/auth.js';
import Budget from '../models/Budget.js';

const router = express.Router();

// Get budget
router.get('/', authenticate, async (req, res) => {
  try {
    let budget = await Budget.findOne({ userId: req.user._id });
    if (!budget) {
      budget = new Budget({ userId: req.user._id, income: 0, fixed: 0, savings: 0 });
      await budget.save();
    }
    res.json(budget);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update budget
router.put(
  '/',
  authenticate,
  [
    body('income').optional().isFloat({ min: 0 }),
    body('fixed').optional().isFloat({ min: 0 }),
    body('savings').optional().isFloat({ min: 0 }),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      let budget = await Budget.findOne({ userId: req.user._id });
      if (!budget) {
        budget = new Budget({ userId: req.user._id });
      }

      if (req.body.income !== undefined) budget.income = Number(req.body.income);
      if (req.body.fixed !== undefined) budget.fixed = Number(req.body.fixed);
      if (req.body.savings !== undefined) budget.savings = Number(req.body.savings);
      budget.updatedAt = new Date();

      await budget.save();
      res.json(budget);
    } catch (error) {
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }
);

export default router;
