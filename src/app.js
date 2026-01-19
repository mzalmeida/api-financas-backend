const express = require('express');
const cors = require('cors');

const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const gastosRoutes = require('./routes/gastos');

const app = express();

// 🔥 CORS — SEM app.options (Node 22 safe)
app.use(cors({
  origin: [
    'https://api-financas-frontend.onrender.com',
    'http://localhost:5500',
    'http://127.0.0.1:5500'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// rota raiz
app.get('/', (req, res) => {
  res.json({ status: 'API Finanças online' });
});

// rotas
app.use('/health', healthRoutes);
app.use('/auth', authRoutes);
app.use('/gastos', gastosRoutes);

module.exports = app;
