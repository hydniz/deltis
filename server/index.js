require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const BACKUP_LOCK = path.join(__dirname, '..', 'backups', '.backup.lock');

const app = express();

app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? false : 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());

// Schreibzugriffe während Backup-Modus blockieren
app.use((req, res, next) => {
  if (fs.existsSync(BACKUP_LOCK) && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return res.status(503).json({
      error: 'Backup läuft – Schreibzugriffe vorübergehend gesperrt. Bitte in Kürze erneut versuchen.'
    });
  }
  next();
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/activities', require('./routes/activities'));
app.use('/api/planner', require('./routes/planner'));
app.use('/api/habits', require('./routes/habits'));
app.use('/api/weight', require('./routes/weight'));
app.use('/api/goals', require('./routes/goals'));
app.use('/api/activity-types', require('./routes/activityTypes'));

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });
}

async function seedPredefinedData() {
  const HabitDefinition = require('./models/HabitDefinition');
  const habits = [
    { name: 'Screen Time', unitSymbol: 'h', type: 'duration' },
    { name: 'Kreatin', unitSymbol: 'g', type: 'amount' },
    { name: 'Zigaretten', unitSymbol: 'Stück', type: 'amount' },
    { name: 'Wasser', unitSymbol: 'ml', type: 'amount' },
    { name: 'Schlaf', unitSymbol: 'h', type: 'duration' },
    { name: 'Meditation', unitSymbol: 'min', type: 'duration' },
    { name: 'Koffein', unitSymbol: 'mg', type: 'amount' },
    { name: 'Alkohol', unitSymbol: 'Gläser', type: 'amount' },
  ];
  for (const h of habits) {
    await HabitDefinition.findOneAndUpdate(
      { name: h.name, userId: null },
      { ...h, userId: null, isPredefined: true },
      { upsert: true }
    );
  }
}

mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('✓ MongoDB verbunden');
    await seedPredefinedData();
    const PORT = process.env.PORT || 3001;
    app.listen(PORT, () => console.log(`✓ Server läuft auf Port ${PORT}`));
  })
  .catch(err => {
    console.error('✗ MongoDB Fehler:', err.message);
    process.exit(1);
  });
