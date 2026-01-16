const express = require('express');
const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');

const app = express();

app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'API Finanças online' });
});

app.use(healthRoutes);
app.use('/auth', authRoutes);

module.exports = app;
