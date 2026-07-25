// Mongoose model: one completion of a todo on one local day. A recurring todo
// has one row per completed occurrence; a 'once' todo has at most one.
const mongoose = require('mongoose');

const todoCompletionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  todoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Todo', required: true },
  date: { type: Date, required: true },   // local day start
  createdAt: { type: Date, default: Date.now },
});

// One completion per todo per day.
todoCompletionSchema.index({ userId: 1, todoId: 1, date: 1 }, { unique: true });
todoCompletionSchema.index({ userId: 1, date: -1 });

module.exports = mongoose.model('TodoCompletion', todoCompletionSchema);
