import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const backendDir = process.cwd();
const outputPath = path.join(backendDir, "database", "docs", "f03e01_runtime_validation.json");

const {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
  FRONTEND_URL = "https://api-financas-frontend.onrender.com",
} = process.env;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Supabase environment variables are not fully configured.");
}

const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const marker = "F03E01";
const syntheticUsers = [
  { code: "A", email: "f03e01-user-a@example.invalid", displayName: "F03E01 User A" },
  { code: "B", email: "f03e01-user-b@example.invalid", displayName: "F03E01 User B" },
];

const result = {
  generated_at: new Date().toISOString(),
  synthetic_users: [],
  login_valid: null,
  login_invalid: null,
  refresh_session: null,
  logout: null,
  restore_session: null,
  token_absent: null,
  token_malformed: null,
  token_expired: null,
  health: {},
  cors: {},
  user_a: {},
  user_b: {},
  isolation: {},
  frontend_scan: {},
  cleanup: {},
};

function buildPassword() {
  return `F03!${crypto.randomBytes(10).toString("hex")}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function fakeExpiredJwt() {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    sub: "expired-user",
    exp: Math.floor(Date.now() / 1000) - 300,
  })).toString("base64url");
  return `${header}.${payload}.signature`;
}

async function listAuthUsers() {
  const { data, error } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw error;
  return data.users;
}

async function ensureSyntheticAuthUser(spec) {
  const password = buildPassword();
  const existingUsers = await listAuthUsers();
  const existing = existingUsers.find((user) => user.email === spec.email);

  if (existing) {
    const { data, error } = await adminClient.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      user_metadata: { ...(existing.user_metadata ?? {}), marker, code: spec.code },
    });
    if (error) throw error;
    return { authUser: data.user, password };
  }

  const { data, error } = await adminClient.auth.admin.createUser({
    email: spec.email,
    password,
    email_confirm: true,
    user_metadata: { marker, code: spec.code },
  });
  if (error) throw error;
  return { authUser: data.user, password };
}

async function upsertPublicUser(authUser, spec) {
  const { data: existingRows, error: selectError } = await adminClient
    .from("users")
    .select("*")
    .eq("auth_provider", "supabase")
    .eq("auth_subject", authUser.id)
    .limit(1);

  if (selectError) throw selectError;

  if ((existingRows ?? []).length > 0) {
    const { data, error } = await adminClient
      .from("users")
      .update({
        email: spec.email,
        display_name: spec.displayName,
        profile_code: "owner",
        status_code: "active",
        archived_at: null,
      })
      .eq("id", existingRows[0].id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await adminClient
    .from("users")
    .insert({
      auth_provider: "supabase",
      auth_subject: authUser.id,
      email: spec.email,
      display_name: spec.displayName,
      profile_code: "owner",
      status_code: "active",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function cleanupForPublicUser(publicUserId) {
  const { data: imports } = await adminClient.from("imports").select("id").eq("user_id", publicUserId);
  const importIds = (imports ?? []).map((row) => row.id);
  if (importIds.length > 0) {
    const { data: files } = await adminClient.from("import_files").select("id").in("import_id", importIds);
    const fileIds = (files ?? []).map((row) => row.id);
    if (fileIds.length > 0) {
      await adminClient.from("import_rows").delete().in("import_file_id", fileIds);
      await adminClient.from("import_files").delete().in("id", fileIds);
    }
    await adminClient.from("imports").delete().in("id", importIds);
  }

  const { data: txRows } = await adminClient.from("transactions").select("id").eq("user_id", publicUserId);
  const txIds = (txRows ?? []).map((row) => row.id);
  if (txIds.length > 0) {
    await adminClient.from("reconciliation_items").delete().in("transaction_id", txIds);
  }

  for (const table of [
    "reconciliations",
    "transactions",
    "cards",
    "counterparties",
    "categories",
    "financial_accounts",
    "user_settings",
  ]) {
    await adminClient.from(table).delete().eq("user_id", publicUserId);
  }
}

async function cleanupSyntheticUsers(runtimeUsers) {
  for (const runtimeUser of runtimeUsers) {
    await cleanupForPublicUser(runtimeUser.publicUser.id);
    await adminClient.from("users").delete().eq("id", runtimeUser.publicUser.id);
    await adminClient.auth.admin.deleteUser(runtimeUser.authUser.id);
  }
}

async function signInWithSupabase(email, password) {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}

async function startBackend() {
  const child = spawn(process.execPath, ["./src/server.js"], {
    cwd: backendDir,
    env: process.env,
    windowsHide: true,
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Servidor nao iniciou. stdout=${stdout} stderr=${stderr}`)), 8000);
    const checkReady = () => {
      if (stdout.includes("Servidor rodando na porta")) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on("data", checkReady);
    child.on("exit", () => {
      clearTimeout(timer);
      reject(new Error(`Servidor encerrou antes do pronto. stdout=${stdout} stderr=${stderr}`));
    });
    checkReady();
  });

  return child;
}

async function localRequest(pathname, { method = "GET", origin, token, body } = {}) {
  const headers = {
    ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    ...(origin ? { Origin: origin } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const response = await fetch(`http://127.0.0.1:3000${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  return {
    ok: response.ok,
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    data,
  };
}

async function getCatalogIds() {
  const institutions = await adminClient
    .from("financial_institutions")
    .select("id,normalized_name")
    .order("normalized_name");
  const categories = await adminClient
    .from("categories")
    .select("id,normalized_name")
    .is("user_id", null)
    .order("normalized_name");

  if (institutions.error || categories.error) {
    throw institutions.error ?? categories.error;
  }

  return {
    nubank: institutions.data.find((row) => row.normalized_name === "nubank"),
    inter: institutions.data.find((row) => row.normalized_name === "banco inter"),
    sharedTransfer: categories.data.find((row) => row.normalized_name === "transferencia entre contas proprias"),
  };
}

async function createSetupData(runtimeUsers) {
  const [userA, userB] = runtimeUsers;
  const catalog = await getCatalogIds();

  const { data: accountA, error: accountAError } = await adminClient
    .from("financial_accounts")
    .insert({
      user_id: userA.publicUser.id,
      financial_institution_id: catalog.nubank.id,
      name: `${marker} Account A`,
      account_type: "checking",
      external_identifier: "f03e01-account-a",
      opening_balance: 0,
    })
    .select("*")
    .single();
  if (accountAError) throw accountAError;

  const { data: accountB, error: accountBError } = await adminClient
    .from("financial_accounts")
    .insert({
      user_id: userB.publicUser.id,
      financial_institution_id: catalog.inter.id,
      name: `${marker} Account B`,
      account_type: "checking",
      external_identifier: "f03e01-account-b",
      opening_balance: 0,
    })
    .select("*")
    .single();
  if (accountBError) throw accountBError;

  const { data: counterpartyA, error: counterpartyAError } = await adminClient
    .from("counterparties")
    .insert({
      user_id: userA.publicUser.id,
      display_name: `${marker} Counterparty A`,
      normalized_name: "f03e01 counterparty a",
      counterparty_type: "merchant",
    })
    .select("*")
    .single();
  if (counterpartyAError) throw counterpartyAError;

  const { data: counterpartyB, error: counterpartyBError } = await adminClient
    .from("counterparties")
    .insert({
      user_id: userB.publicUser.id,
      display_name: `${marker} Counterparty B`,
      normalized_name: "f03e01 counterparty b",
      counterparty_type: "merchant",
    })
    .select("*")
    .single();
  if (counterpartyBError) throw counterpartyBError;

  const { data: categoryA, error: categoryAError } = await adminClient
    .from("categories")
    .insert({
      user_id: userA.publicUser.id,
      name: `${marker} Category A`,
      normalized_name: "f03e01 category a",
      movement_type: "expense",
      display_order: 200,
    })
    .select("*")
    .single();
  if (categoryAError) throw categoryAError;

  const { data: categoryB, error: categoryBError } = await adminClient
    .from("categories")
    .insert({
      user_id: userB.publicUser.id,
      name: `${marker} Category B`,
      normalized_name: "f03e01 category b",
      movement_type: "expense",
      display_order: 200,
    })
    .select("*")
    .single();
  if (categoryBError) throw categoryBError;

  const transactions = [
    {
      user_id: userA.publicUser.id,
      financial_account_id: accountA.id,
      counterparty_id: counterpartyA.id,
      category_id: categoryA.id,
      transaction_source: "manual",
      movement_type: "expense",
      posting_status: "posted",
      reconciliation_status: "pending",
      occurred_on: "2026-08-01",
      original_description: `${marker} Expense A`,
      normalized_description: `${marker} Expense A`,
      amount: -10,
      currency_code: "BRL",
      duplicate_group_key: "f03e01-a",
      dedup_hash: sha256("f03e01-a"),
    },
    {
      user_id: userA.publicUser.id,
      financial_account_id: accountA.id,
      counterparty_id: counterpartyA.id,
      category_id: catalog.sharedTransfer.id,
      transaction_source: "manual",
      movement_type: "transfer",
      posting_status: "posted",
      reconciliation_status: "pending",
      occurred_on: "2026-08-02",
      original_description: `${marker} Shared`,
      normalized_description: `${marker} Shared`,
      amount: -5,
      currency_code: "BRL",
    },
    {
      user_id: userB.publicUser.id,
      financial_account_id: accountB.id,
      counterparty_id: counterpartyB.id,
      category_id: categoryB.id,
      transaction_source: "manual",
      movement_type: "expense",
      posting_status: "posted",
      reconciliation_status: "pending",
      occurred_on: "2026-08-01",
      original_description: `${marker} Expense B`,
      normalized_description: `${marker} Expense B`,
      amount: -20,
      currency_code: "BRL",
      duplicate_group_key: "f03e01-b",
      dedup_hash: sha256("f03e01-b"),
    },
  ];

  const { error: txError } = await adminClient
    .from("transactions")
    .insert(transactions);

  if (txError) throw txError;
}

const runtimeUsers = [];

try {
  for (const spec of syntheticUsers) {
    const authState = await ensureSyntheticAuthUser(spec);
    const publicUser = await upsertPublicUser(authState.authUser, spec);
    await cleanupForPublicUser(publicUser.id);
    runtimeUsers.push({ ...spec, ...authState, publicUser });
    result.synthetic_users.push({
      code: spec.code,
      email_masked: spec.email.replace("@", "+masked@"),
      auth_user_id_masked: `${authState.authUser.id.slice(0, 8)}...`,
      public_user_id_masked: `${publicUser.id.slice(0, 8)}...`,
    });
  }

  await createSetupData(runtimeUsers);

  const backend = await startBackend();
  try {
    result.health.root = await localRequest("/");
    result.health.official = await localRequest("/health");
    result.health.legacy = await localRequest("/health/health");

    result.cors.allowed = await localRequest("/health", { origin: FRONTEND_URL });
    result.cors.blocked = await localRequest("/health", { origin: "https://origem-nao-aprovada.example.invalid" });

    const userA = runtimeUsers[0];
    const userB = runtimeUsers[1];

    result.login_valid = await localRequest("/auth/login", {
      method: "POST",
      body: { usuario: userA.email, senha: userA.password },
    });

    result.login_invalid = await localRequest("/auth/login", {
      method: "POST",
      body: { usuario: userA.email, senha: "senha-incorreta" },
    });

    const sessionA = result.login_valid.data?.session;
    result.restore_session = await localRequest("/auth/me", {
      token: sessionA?.access_token,
    });

    result.refresh_session = await localRequest("/auth/refresh", {
      method: "POST",
      body: { refreshToken: sessionA?.refresh_token },
    });

    result.token_absent = await localRequest("/gastos/banco");
    result.token_malformed = await localRequest("/gastos/banco", { token: "abc.def" });
    result.token_expired = await localRequest("/gastos/banco", { token: fakeExpiredJwt() });

    const loginB = await localRequest("/auth/login", {
      method: "POST",
      body: { usuario: userB.email, senha: userB.password },
    });
    const sessionB = loginB.data?.session;

    for (const viewName of ["banco", "base", "recorrentes", "fornecedores", "duplicadas"]) {
      result.user_a[viewName] = await localRequest(`/gastos/${viewName}`, {
        token: sessionA?.access_token,
      });
      result.user_b[viewName] = await localRequest(`/gastos/${viewName}`, {
        token: sessionB?.access_token,
      });
    }

    result.logout = await localRequest("/auth/logout", {
      method: "POST",
      token: sessionA?.access_token,
    });

    result.isolation = {
      banco: {
        user_a_total: result.user_a.banco.data?.total_registros,
        user_b_total: result.user_b.banco.data?.total_registros,
      },
      base: {
        user_a_total: result.user_a.base.data?.total_registros,
        user_b_total: result.user_b.base.data?.total_registros,
      },
      fornecedores: {
        user_a_total: result.user_a.fornecedores.data?.total_registros,
        user_b_total: result.user_b.fornecedores.data?.total_registros,
      },
    };
  } finally {
    backend.kill();
  }

  const frontendHtml = await fs.readFile(path.join(backendDir, "..", "api-financas-frontend", "index.html"), "utf8");
  const frontendJs = await fs.readFile(path.join(backendDir, "..", "api-financas-frontend", "app.js"), "utf8");
  result.frontend_scan = {
    contains_service_role_string: frontendHtml.includes("SERVICE_ROLE") || frontendJs.includes("SERVICE_ROLE"),
    contains_supabase_service_role_key: frontendHtml.includes("SUPABASE_SERVICE_ROLE_KEY") || frontendJs.includes("SUPABASE_SERVICE_ROLE_KEY"),
    stores_session_in_local_storage: frontendJs.includes("localStorage"),
  };
} finally {
  if (runtimeUsers.length > 0) {
    await cleanupSyntheticUsers(runtimeUsers);
    result.cleanup.synthetic_users_removed = true;
  } else {
    result.cleanup.synthetic_users_removed = false;
  }
  await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

console.log(`Runtime validation written to ${path.relative(backendDir, outputPath)}`);
