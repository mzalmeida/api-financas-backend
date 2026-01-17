const express = require('express');
const cors = require('cors');

const router = express.Router();

// 🔥 CORS ESPECÍFICO PARA AUTH (RESOLVE O PREFLIGHT)
router.use(cors({
  origin: [
    'https://api-financas-frontend.onrender.com',
    'http://localhost:5500',
    'http://127.0.0.1:5500'
  ],
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// 🔥 RESPONDE EXPLICITAMENTE O PREFLIGHT
router.options('/login', (req, res) => {
  res.sendStatus(200);
});

// 👉 SUA ROTA REAL
router.post('/login', async (req, res) => {
  try {
    // seu código de login aqui
    res.json({ message: 'Login OK' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro no login' });
  }
});

module.exports = router;
