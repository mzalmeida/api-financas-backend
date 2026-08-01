const express = require("express");

const requireSupabaseAuth = require("../middlewares/requireSupabaseAuth");
const { createSupabaseUserClient } = require("../config/supabaseClients");

const router = express.Router();

const viewByRoute = {
  banco: "vw_gastos_por_banco",
  base: "vw_transacoes_base",
  recorrentes: "vw_transacoes_recorrentes",
  fornecedores: "view_transacoes_fornecedores",
  duplicadas: "view_transacoes_duplicadas",
};

async function buscarView(nomeView, req, res) {
  try {
    const supabase = createSupabaseUserClient(req.accessToken);
    const { data, error } = await supabase.from(nomeView).select("*");

    if (error) {
      console.error(`Erro Supabase ao consultar ${nomeView}:`, error.message);
      return res.status(502).json({
        erro: "Erro ao consultar dados financeiros",
        codigo: "supabase_query_error",
      });
    }

    return res.json({
      status: "ok",
      total_registros: data.length,
      dados: data,
    });
  } catch (error) {
    console.error(`Falha interna ao consultar ${nomeView}:`, error.message);
    return res.status(500).json({
      erro: "Falha interna ao consultar dados financeiros",
      codigo: "internal_query_error",
    });
  }
}

for (const [routeName, viewName] of Object.entries(viewByRoute)) {
  router.get(`/${routeName}`, requireSupabaseAuth, async (req, res) => {
    return buscarView(viewName, req, res);
  });
}

module.exports = router;
