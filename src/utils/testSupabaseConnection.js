require('dotenv').config();
const supabase = require('../config/supabase');

const test = async () => {
  const { data, error } = await supabase
    .from('transacoes')
    .select('*')
    .limit(1);

  if (error) {
    console.error('❌ Erro Supabase:', error.message);
  } else {
    console.log('✅ Conectado ao Supabase:', data);
  }
};

test();
