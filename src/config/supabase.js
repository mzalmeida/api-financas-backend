const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Variáveis do Supabase não carregadas');
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

module.exports = supabase;
