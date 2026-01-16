const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase");
const authMiddleware = require("../middlewares/authMiddleware");

// 🔐 Rota protegida
router.get("/", authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("transacoes")
      .select("*")
      .order("data", { ascending: false });

    if (error) {
      return res.status(400).json({ erro: error.message });
    }

    res.json({
      status: "ok",
      total: data.length,
      dados: data,
    });
  } catch (err) {
    res.status(500).json({ erro: "Erro interno", detalhe: err.message });
  }
});

module.exports = router;
