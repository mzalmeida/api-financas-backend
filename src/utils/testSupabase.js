require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");

console.log("SUPABASE_URL =", process.env.SUPABASE_URL);
console.log("SUPABASE_SERVICE_KEY =", process.env.SUPABASE_SERVICE_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

(async () => {
  const { data, error } = await supabase.from("transacoes").select("*").limit(1);

  if (error) {
    console.error("Erro Supabase:", error.message);
  } else {
    console.log("Conexão OK. Dados:", data);
  }
})();
