require("dotenv").config();
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const gastosRoutes = require("./routes/gastos");

const app = express();

/**
 * 🔓 CORS ABERTO PARA DEMO PÚBLICA
 * (necessário para frontend no Render)
 */
app.use(cors());

app.use(express.json());

// rota teste
app.get("/", (req, res) => {
  res.json({ status: "API rodando" });
});

// rota healthcheck
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "api-financas",
    timestamp: new Date().toISOString()
  });
});

// rotas
app.use("/auth", authRoutes);
app.use(gastosRoutes);

app.listen(process.env.PORT || 3000, () => {
  console.log("Servidor rodando na porta", process.env.PORT || 3000);
});
