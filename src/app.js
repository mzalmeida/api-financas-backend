const express = require('express');
const path = require('path');
const cors = require('cors');

const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const gastosRoutes = require(path.join(__dirname, 'routes', 'gastos'));

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

/* 🔥 corrige o erro no navegador de 
Response to preflight request doesn't pass access control check
No 'Access-Control-Allow-Origin' header is present*/
app.options('/*', cors({
  origin: [
    'https://api-financas-frontend.onrender.com',
    'http://localhost:5500'
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
app.use('/gastos', gastosRoutes); 

module.exports = app;
