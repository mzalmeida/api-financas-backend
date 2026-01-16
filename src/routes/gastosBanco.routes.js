const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/auth");
const supabase = require("../config/supabaseClient");

router.get("/gastos_banco", authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("transacoes")
      .select("banco, valor")
      .lt("valor", 0);

    if (error) {
      return res.status(400).json({ erro: error.message });
    }

    // Agrupar gastos por banco
    const resultado = {};

    data.forEach((item) => {
      if (!resultado[item.banco]) {
        resultado[item.banco] = 0;
      }
      resultado[item.banco] += item.valor;
    });

    res.json({
      status: "ok",
      dados: resultado
    });

  } catch (err) {
    res.status(500).json({ erro: "Erro interno no servidor" });
  }
});

module.exports = router;
