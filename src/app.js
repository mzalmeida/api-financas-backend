const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const healthRoutes = require("./routes/health");
const authRoutes = require("./routes/auth");
const gastosRoutes = require("./routes/gastos");
const importsRoutes = require("./routes/imports");
const portalRoutes = require("./routes/portal");
const { gmailIntegrationEnabled, isOriginAllowed } = require("./config/runtime");

const app = express();

if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));

app.use(cors({
  origin(origin, callback) {
    if (!origin || isOriginAllowed(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Origin not allowed by CORS"));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

app.use(express.json({ limit: "256kb" }));

app.get("/", (req, res) => {
  res.json({ status: "RebeccaCash API online" });
});

app.get("/auth", (req, res) => {
  res.json({
    status: "ok",
    auth_provider: "supabase",
  });
});

app.use("/health", healthRoutes);

if (gmailIntegrationEnabled) {
  const gmailRoutes = require("./routes/gmail");
  app.use("/integrations/gmail", gmailRoutes);
}

app.use("/auth", authRoutes);
app.use("/portal", portalRoutes);
app.use("/imports", importsRoutes);
app.use("/gastos", gastosRoutes);

app.use((req, res) => {
  res.status(404).json({
    erro: "Rota nao encontrada",
    codigo: "route_not_found",
  });
});

app.use((error, req, res, next) => {
  if (error?.type === "entity.too.large") {
    return res.status(413).json({
      erro: "Conteudo enviado excede o limite permitido",
      codigo: "payload_too_large",
    });
  }

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
