const express = require("express");
const cors = require("cors");

const healthRoutes = require("./routes/health");
const authRoutes = require("./routes/auth");
const gastosRoutes = require("./routes/gastos");
const importsRoutes = require("./routes/imports");
const { allowedOrigins, gmailIntegrationEnabled, isOriginAllowed } = require("./config/runtime");

const app = express();

app.use(cors({
  origin(origin, callback) {
    if (!origin || isOriginAllowed(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Origin not allowed by CORS"));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

app.use(express.json());

app.get("/", (req, res) => {
  res.json({ status: "API Financas online" });
});

app.get("/auth", (req, res) => {
  res.json({
    status: "ok",
    auth_provider: "supabase",
    allowed_origins: allowedOrigins,
  });
});

app.use("/health", healthRoutes);
app.use("/auth", authRoutes);
app.use("/gastos", gastosRoutes);
app.use("/imports", importsRoutes);

if (gmailIntegrationEnabled) {
  const gmailRoutes = require("./routes/gmail");
  app.use("/integrations/gmail", gmailRoutes);
}

app.use((error, req, res, next) => {
  if (error?.message === "Origin not allowed by CORS") {
    return res.status(403).json({
      erro: "Origem nao permitida",
      codigo: "cors_not_allowed",
    });
  }

  if (error) {
    console.error("Erro nao tratado:", error.message);
    return res.status(500).json({
      erro: "Falha interna",
      codigo: "internal_error",
    });
  }

  return next();
});

module.exports = app;
