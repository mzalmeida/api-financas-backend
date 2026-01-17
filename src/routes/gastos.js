const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// 🔐 middleware JWT
function autenticar(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ erro: "Token não informado" });
  }

  const token = authHeader.split(" ")[1];

  try {
    jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ erro: "Token inválido" });
  }
}

// 🔹 helper genérico
async function buscarView(nomeView, res) {
  const { data, error } = await supabase.from(nomeView).select("*");

  if (error) {
    return res.status(500).json({ erro: error.message });
  }

  return res.json({
    status: "ok",
    total_registros: data.length,
    dados: data
  });
}

/* ===== ROTAS ===== */

router.get("/banco", autenticar, async (req, res) => {
  return buscarView("vw_gastos_por_banco", res);
});

router.get("/base", autenticar, async (req, res) => {
  return buscarView("vw_transacoes_base", res);
});

router.get("/recorrentes", autenticar, async (req, res) => {
  return buscarView("vw_transacoes_recorrentes", res);
});

router.get("/fornecedores", autenticar, async (req, res) => {
  return buscarView("view_transacoes_fornecedores", res);
});

router.get("/duplicadas", autenticar, async (req, res) => {
  return buscarView("view_transacoes_duplicadas", res);
});

module.exports = router;
