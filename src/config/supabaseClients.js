const { createClient } = require("@supabase/supabase-js");

const {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Supabase environment variables are not fully configured.");
}

function buildClient(key, extraOptions = {}) {
  return createClient(SUPABASE_URL, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      ...(extraOptions.auth ?? {}),
    },
    global: extraOptions.global ?? {},
  });
}

function createSupabaseAuthClient() {
  return buildClient(SUPABASE_ANON_KEY);
}

function createSupabaseUserClient(accessToken) {
  return buildClient(SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

const adminSupabaseClient = buildClient(SUPABASE_SERVICE_ROLE_KEY);

module.exports = {
  createSupabaseAuthClient,
  createSupabaseUserClient,
  adminSupabaseClient,
};
