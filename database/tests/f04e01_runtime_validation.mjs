import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { Blob } from "node:buffer";
import { createClient } from "@supabase/supabase-js";

const backendDir = process.cwd();
const outputPath = path.join(backendDir, "database", "docs", "f04e01_runtime_validation.json");
const fixturePath = path.join(backendDir, "test", "fixtures", "nubank.ofx");

const {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Supabase environment variables are not fully configured.");
}

const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const marker = "F04E01";
const syntheticUsers = [
  { code: "A", email: "f04e01-user-a@example.invalid", displayName: "F04E01 User A" },
  { code: "B", email: "f04e01-user-b@example.invalid", displayName: "F04E01 User B" },
];

const result = {
  generated_at: new Date().toISOString(),
  fixture: path.relative(backendDir, fixturePath),
  synthetic_users: [],
  options: null,
  created_account: null,
  preview: null,
  preview_database: null,
  confirm: null,
  confirm_again: null,
  duplicate_preview: null,
  history: null,
  details: null,
  dashboard: {},
  ownership: {},
  cleanup: {},
  risks: [],
};

function buildPassword() {
  return `F04!${crypto.randomBytes(10).toString("hex")}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
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
  const { data: gmailIntegrations } = await adminClient.from("gmail_integrations").select("id").eq("user_id", publicUserId);
  const gmailIntegrationIds = (gmailIntegrations ?? []).map((row) => row.id);
  if (gmailIntegrationIds.length > 0) {
    await adminClient.from("gmail_messages").delete().in("gmail_integration_id", gmailIntegrationIds);
    await adminClient.from("gmail_integrations").delete().in("id", gmailIntegrationIds);
  }

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

  for (const table of ["reconciliations", "transactions", "cards", "counterparties", "categories", "financial_accounts", "user_settings"]) {
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
    const timer = setTimeout(() => reject(new Error(`Servidor nao iniciou. stdout=${stdout} stderr=${stderr}`)), 10000);
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

async function localRequest(pathname, { method = "GET", token, body, headers = {} } = {}) {
  const requestHeaders = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...headers,
  };

  const response = await fetch(`http://127.0.0.1:3000${pathname}`, {
    method,
    headers: requestHeaders,
    body,
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
    data,
  };
}

async function login(email, password) {
  const response = await localRequest("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usuario: email, senha: password }),
  });

  if (!response.ok || !response.data?.session?.access_token) {
    throw new Error("Falha ao autenticar usuario sintetico.");
  }

  return response.data.session;
}

async function getCatalogIds() {
  const { data, error } = await adminClient
    .from("financial_institutions")
    .select("id,name,normalized_name")
    .order("normalized_name");

  if (error) throw error;

  return {
    nubank: data.find((row) => row.normalized_name === "nubank"),
    inter: data.find((row) => row.normalized_name === "banco inter"),
  };
}

const runtimeUsers = [];

try {
  const fixtureBuffer = await fs.readFile(fixturePath);

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

  const backend = await startBackend();

  try {
    const userA = runtimeUsers[0];
    const userB = runtimeUsers[1];
    const catalog = await getCatalogIds();
    const sessionA = await login(userA.email, userA.password);
    const sessionB = await login(userB.email, userB.password);

    result.options = await localRequest("/imports/options", {
      token: sessionA.access_token,
    });

    const createAccountResponse = await localRequest("/imports/accounts", {
      method: "POST",
      token: sessionA.access_token,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `${marker} Conta Nubank`,
        financialInstitutionId: catalog.nubank.id,
        accountType: "checking",
        externalIdentifier: `${marker.toLowerCase()}-nubank`,
        maskedAccountNumber: "***1234",
        maskedBranchNumber: "***1",
      }),
    });
    result.created_account = createAccountResponse;

    const accountId = createAccountResponse.data?.account?.id;
    const formData = new FormData();
    formData.append("financialAccountId", accountId);
    formData.append("financialInstitutionId", catalog.nubank.id);
    formData.append("file", new Blob([fixtureBuffer], { type: "application/ofx" }), "nubank.ofx");

    const previewResponse = await localRequest("/imports/ofx/preview", {
      method: "POST",
      token: sessionA.access_token,
      body: formData,
    });
    result.preview = previewResponse;

    const importId = previewResponse.data?.preview?.import_id;

    const { data: importRow, error: importRowError } = await adminClient
      .from("imports")
      .select("id,status_code,total_rows,processed_rows,accepted_rows,rejected_rows,duplicate_rows,processing_summary")
      .eq("id", importId)
      .single();
    if (importRowError) throw importRowError;

    const { data: importFiles, error: importFilesError } = await adminClient
      .from("import_files")
      .select("id,file_hash,status_code,file_size_bytes")
      .eq("import_id", importId);
    if (importFilesError) throw importFilesError;

    const fileIds = importFiles.map((item) => item.id);
    const { data: importRows, error: importRowsError } = await adminClient
      .from("import_rows")
      .select("id,processing_status,source_hash,linked_transaction_id")
      .in("import_file_id", fileIds);
    if (importRowsError) throw importRowsError;

    result.preview_database = {
      import: importRow,
      import_files_count: importFiles.length,
      import_rows_count: importRows.length,
      accepted_rows: importRows.filter((row) => row.processing_status === "accepted").length,
      duplicate_rows: importRows.filter((row) => row.processing_status === "duplicate").length,
    };

    const confirmResponse = await localRequest("/imports/ofx/confirm", {
      method: "POST",
      token: sessionA.access_token,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ importId }),
    });
    result.confirm = confirmResponse;

    const confirmAgainResponse = await localRequest("/imports/ofx/confirm", {
      method: "POST",
      token: sessionA.access_token,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ importId }),
    });
    result.confirm_again = confirmAgainResponse;

    const detailsResponse = await localRequest(`/imports/${importId}`, {
      token: sessionA.access_token,
    });
    result.details = detailsResponse;

    const historyResponse = await localRequest("/imports?limit=10", {
      token: sessionA.access_token,
    });
    result.history = historyResponse;

    result.dashboard.base = await localRequest("/gastos/base?limit=50", {
      token: sessionA.access_token,
    });
    result.dashboard.banco = await localRequest("/gastos/banco?limit=50", {
      token: sessionA.access_token,
    });

    const duplicateFormData = new FormData();
    duplicateFormData.append("financialAccountId", accountId);
    duplicateFormData.append("financialInstitutionId", catalog.nubank.id);
    duplicateFormData.append("file", new Blob([fixtureBuffer], { type: "application/ofx" }), "nubank-repeat.ofx");

    result.duplicate_preview = await localRequest("/imports/ofx/preview", {
      method: "POST",
      token: sessionA.access_token,
      body: duplicateFormData,
    });

    result.ownership.user_b_cannot_open_user_a_import = await localRequest(`/imports/${importId}`, {
      token: sessionB.access_token,
    });

    const { data: transactions, error: txError } = await adminClient
      .from("transactions")
      .select("id,import_row_id,dedup_hash,financial_account_id,amount")
      .eq("user_id", userA.publicUser.id)
      .order("occurred_on", { ascending: true });
    if (txError) throw txError;

    const { data: linkedRows, error: linkedRowsError } = await adminClient
      .from("import_rows")
      .select("id,linked_transaction_id,processing_status")
      .in("id", importRows.map((row) => row.id));
    if (linkedRowsError) throw linkedRowsError;

    result.dashboard.database_transactions = {
      count: transactions.length,
      linked_rows: linkedRows.filter((row) => row.linked_transaction_id).length,
      transaction_hashes: transactions.map((row) => row.dedup_hash).filter(Boolean).length,
      total_amount: transactions.reduce((sum, row) => sum + Number(row.amount), 0),
      import_row_links_valid: transactions.every((row) => linkedRows.some((linked) => linked.id === row.import_row_id && linked.linked_transaction_id === row.id)),
    };

    if (previewResponse.data?.preview?.status !== "pending_confirmation") {
      result.risks.push("Preview nao retornou pending_confirmation.");
    }
    if (!confirmAgainResponse.data?.confirmation?.already_confirmed) {
      result.risks.push("Idempotencia da confirmacao nao foi comprovada.");
    }
    if (result.ownership.user_b_cannot_open_user_a_import.status !== 404) {
      result.risks.push("Usuario B conseguiu consultar importacao do usuario A.");
    }
    if (result.dashboard.base.data?.total_registros < transactions.length) {
      result.risks.push("Dashboard base nao refletiu todas as transacoes criadas.");
    }
  } finally {
    backend.kill();
  }
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
