const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");

const router = express.Router();

/* 🔥 CORS PARA AUTH */
router.use(cors({
  origin: [
    "https://api-financas-frontend.onrender.com",
    "http://localhost:5500",
    "http://127.0.0.1:5500"
  ],
  methods: ["POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

router.options("/login", (req, res) => {
  res.sendStatus(200);
});

/* 🔐 LOGIN REAL */
router.post("/login", async (req, res) => {
  const { usuario, senha, linkedin } = req.body;

  if (!usuario || !senha || !linkedin) {
    return res.status(400).json({ erro: "Dados obrigatórios ausentes" });
  }

  try {
    // 🔑 AQUI depois você valida usuário/senha no banco
    // por enquanto vamos assumir válido

    const token = jwt.sign(
      { usuario },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    return res.json({
      status: "ok",
      token
    });

  } catch (err) {
    console.error("Erro no login:", err);
    return res.status(500).json({ erro: "Erro no login" });
  }
});

module.exports = router;
