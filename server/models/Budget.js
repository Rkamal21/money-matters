import mongoose from 'mongoose';

const budgetSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  },
  income: {
    type: Number,
    default: 0,
    min: 0,
  },
  fixed: {
    type: Number,
    default: 0,
    min: 0,
  },
  savings: {
    type: Number,
    default: 0,
    min: 0,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

budgetSchema.index({ userId: 1 });

export default mongoose.model('Budget', budgetSchema);
