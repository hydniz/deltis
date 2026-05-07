const mongoose = require('mongoose');

const intermediateStepSchema = new mongoose.Schema({
  date: { type: Date, required: true },
  targetValue: { type: Number, required: true },
  description: { type: String }
}, { _id: false });

const goalSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  description: { type: String },
  type: {
    type: String,
    enum: ['weekly-activity', 'weekly-habit', 'long-term-activity', 'long-term-habit'],
    required: true
  },
  targetRef: { type: String, required: true },
  targetRefModel: { type: String, enum: ['activity', 'habit'], required: true },
  condition: { type: String, enum: ['min', 'max', 'exact'], required: true },
  targetValue: { type: Number, required: true },
  unitSymbol: { type: String },
  startDate: { type: Date },
  endDate: { type: Date },
  startValue: { type: Number },
  intermediateSteps: [intermediateStepSchema],
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Goal', goalSchema);
