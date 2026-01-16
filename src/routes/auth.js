const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");

router.post("/login", (req, res) => {
   console.log("BODY RECEBIDO:", req.body);
  const { usuario, senha, linkedin } = req.body || {};

  // 1️⃣ validação de campos
  if (!usuario || !senha || !linkedin) {
    return res.status(400).json({
      erro: "Usuário, senha e LinkedIn são obrigatórios"
    });
  }

  // 2️⃣ login fixo (demo)
  if (usuario !== "testem" || senha !== "mteste") {
    return res.status(401).json({
      erro: "Senha inválida"
    });
  }

  // 3️⃣ gera token
  const token = jwt.sign(
    { usuario, linkedin },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );

  // 4️⃣ REGISTRA LOG DE ACESSO
  const log = {
    usuario,
    linkedin,
    ip: req.ip,
    data: new Date().toISOString()
  };

  const logPath = path.join(__dirname, "../../logs/acessos.log");

  fs.appendFileSync(logPath, JSON.stringify(log) + "\n");

  // 5️⃣ resposta
  res.json({
    status: "ok",
    token
  });
});

module.exports = router;
