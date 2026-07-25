// Mongoose model: a to-do. Like a habit it can be one-off or recurring and can
// be scheduled by weekday, interval or an event trigger — but it is a simple
// done/not-done task, completed per occurrence in TodoCompletion.
const mongoose = require('mongoose');

// Same trigger shape the habit scheduler uses (services/habitSchedule.js), plus
// 'todo' as a source kind so todos can chain off each other.
const triggerSchema = new mongoose.Schema({
  kind: { type: String, enum: ['habit', 'activityType', 'stravaSport', 'trainingType', 'todo'], required: true },
  direction: { type: String, enum: ['after', 'before'], default: 'after' },
  offsetDays: { type: Number, default: 0, min: 0, max: 30 },
  refId: { type: mongoose.Schema.Types.ObjectId },   // habit/activityType/training/todo id
  sport: { type: String },                            // stravaSport only
}, { _id: false });

const todoSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  title: { type: String, required: true, trim: true, maxlength: 200 },
  notes: { type: String, default: '', maxlength: 2000 },
  priority: { type: String, enum: ['low', 'normal', 'high'], default: 'normal' },

  // Scheduling — mirrors the habit scheduler.
  //   once     – due only on `dueDate`
  //   daily    – due every day
  //   weekly   – due on `scheduleDays` (0 = Sunday … 6 = Saturday)
  //   interval – due every `scheduleIntervalDays` from `scheduleAnchorDate`
  //   trigger  – due relative to another event (`scheduleTrigger`)
  scheduleMode: { type: String, enum: ['once', 'daily', 'weekly', 'interval', 'trigger'], default: 'once' },
  dueDate: { type: String, default: null },            // 'YYYY-MM-DD' for 'once'
  scheduleDays: { type: [Number], default: [] },
  scheduleIntervalDays: { type: Number, default: null },
  scheduleAnchorDate: { type: String, default: null },
  scheduleTrigger: { type: triggerSchema, default: null },

  // Local time the companion nags if a todo due today is still open ('HH:MM').
  // null = fall back to the user-level default.
  reminderTime: { type: String, default: null },

  // A 'once' todo hides itself once completed; recurring ones reset per day.
  deletedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
});

todoSchema.index({ userId: 1, deletedAt: 1 });

module.exports = mongoose.model('Todo', todoSchema);
