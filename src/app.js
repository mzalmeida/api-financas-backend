const express = require('express');
const cors = require('cors');

const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const gastosRoutes = require('./routes/gastos'); // se existir

const app = express();

// 🔥 CORS CONFIGURADO CORRETAMENTE
app.use(cors({
  origin: [
    'https://api-financas-frontend.onrender.com',
    'http://localhost:5500',
    'http://127.0.0.1:5500'
  ],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'API Finanças online' });
});

app.use('/health', healthRoutes);
app.use('/auth', authRoutes);
app.use('/gastos_banco', gastosRoutes); // ajuste se o nome for outro

module.exports = app;
