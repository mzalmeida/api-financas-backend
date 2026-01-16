const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const supabase = require("../config/supabase");

router.get("/gastos_banco", authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("vw_gastos_por_banco")
      .select("*");

    if (error) {
      return res.status(500).json({
        erro: "Erro ao consultar Supabase",
        detalhe: error.message
      });
    }

    return res.json({
      status: "ok",
      total_registros: data.length,
      dados: data
    });

  } catch (err) {
    return res.status(500).json({
      erro: "Erro inesperado",
      detalhe: err.message
    });
  }
});

module.exports = router;
