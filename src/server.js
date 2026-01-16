require("dotenv").config();
const express = require("express");
const cors = require("cors");
const authRoutes = require("./routes/auth");
const gastosRoutes = require("./routes/gastos");

const app = express();

app.use(cors({
  origin: function (origin, callback) {
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      "http://localhost:8080",
      "http://127.0.0.1:8080"
    ];

    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

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

app.use(authRoutes);

// rotas protegidas
app.use(gastosRoutes);

app.listen(process.env.PORT || 3000, () => {
  console.log("Servidor rodando na porta", process.env.PORT || 3000);
});
