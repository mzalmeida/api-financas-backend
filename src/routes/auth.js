const express = require("express");

const requireSupabaseAuth = require("../middlewares/requireSupabaseAuth");
const { createSupabaseAuthClient, createSupabaseUserClient } = require("../config/supabaseClients");

const router = express.Router();

function normalizeIdentifier(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email ?? null,
  };
}

function sanitizeSession(session) {
  if (!session) return null;
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    token_type: session.token_type,
    user: sanitizeUser(session.user),
  };
}

router.post("/login", async (req, res) => {
  const { usuario, senha } = req.body;
  const email = normalizeIdentifier(usuario);

  if (!email || !senha) {
    return res.status(400).json({
      erro: "Usuario e senha sao obrigatorios",
      codigo: "missing_credentials",
    });
  }

  try {
    const supabase = createSupabaseAuthClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password: senha,
    });

    if (error) {
      return res.status(401).json({
        erro: "Credenciais invalidas",
        codigo: "invalid_credentials",
      });
    }

    return res.json({
      status: "ok",
      auth_provider: "supabase",
      session: sanitizeSession(data.session),
      user: sanitizeUser(data.user ?? data.session?.user),
    });
  } catch (error) {
    console.error("Erro ao autenticar no Supabase:", error.message);
    return res.status(502).json({
      erro: "Falha ao autenticar no Supabase",
      codigo: "supabase_auth_error",
    });
  }
});

router.post("/refresh", async (req, res) => {
  const refreshToken = typeof req.body?.refreshToken === "string" ? req.body.refreshToken.trim() : "";
  if (!refreshToken) {
    return res.status(400).json({ erro: "Refresh token nao informado", codigo: "missing_refresh_token" });
  }

  try {
    const supabase = createSupabaseAuthClient();
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error || !data?.session) {
      return res.status(401).json({ erro: "Refresh token invalido", codigo: "invalid_refresh_token" });
    }

    return res.json({
      status: "ok",
      session: sanitizeSession(data.session),
      user: sanitizeUser(data.user ?? data.session?.user),
    });
  } catch (error) {
    console.error("Erro ao renovar sessao no Supabase:", error.message);
    return res.status(502).json({ erro: "Falha ao renovar sessao", codigo: "refresh_integration_error" });
  }
});

router.post("/logout", requireSupabaseAuth, async (req, res) => {
  try {
    const userClient = createSupabaseUserClient(req.accessToken);
    const { error } = await userClient.auth.signOut({ scope: "global" });

    if (error) {
      return res.status(502).json({ erro: "Falha ao encerrar sessao", codigo: "logout_integration_error" });
    }

    return res.json({ status: "ok" });
  } catch (error) {
    console.error("Erro ao encerrar sessao no Supabase:", error.message);
    return res.status(502).json({ erro: "Falha ao encerrar sessao", codigo: "logout_integration_error" });
  }
});

router.get("/me", requireSupabaseAuth, async (req, res) => {
  return res.json({
    status: "ok",
    user: req.user,
  });
});

module.exports = router;
