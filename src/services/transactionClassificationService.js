const { adminSupabaseClient } = require("../config/supabaseClients");

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function learnedPatternFromDescription(value) {
  return normalizeText(value)
    .replace(/\bparcela\s+\d+\s*\/\s*\d+\b/g, " ")
    .replace(/\b\d{2}[./-]\d{2}(?:[./-]\d{2,4})?\b/g, " ")
    .replace(/\b\d{3,}\b/g, " ")
    .replace(/\s*[-|]\s*$/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function matchRule(rule, transaction) {
  const sourceMap = {
    description: transaction.description,
    memo: transaction.memo,
    name: transaction.name,
    fitid: transaction.fitId,
  };

  const haystack = normalizeText(sourceMap[rule.match_field] ?? transaction.description);
  const pattern = normalizeText(rule.pattern_text);

  if (!haystack || !pattern) return false;

  switch (rule.match_operator) {
    case "equals":
      return haystack === pattern;
    case "starts_with":
      return haystack.startsWith(pattern);
    case "ends_with":
      return haystack.endsWith(pattern);
    case "regex":
      try {
        return new RegExp(rule.pattern_text, "i").test(sourceMap[rule.match_field] ?? transaction.description ?? "");
      } catch {
        return false;
      }
    case "contains":
    default:
      return haystack.includes(pattern);
  }
}

async function findSharedSalaryCategory() {
  const { data } = await adminSupabaseClient
    .from("categories")
    .select("id")
    .is("user_id", null)
    .eq("normalized_name", "salario")
    .maybeSingle();

  return data?.id ?? null;
}

async function ensureDefaultClassificationRules(appUserId) {
  const salaryCategoryId = await findSharedSalaryCategory();
  if (!salaryCategoryId) return;

  const ruleName = "Salario portabilidade";
  const { data: existing } = await adminSupabaseClient
    .from("transaction_classification_rules")
    .select("id")
    .eq("user_id", appUserId)
    .eq("rule_name", ruleName)
    .is("archived_at", null)
    .maybeSingle();

  if (existing?.id) return;

  await adminSupabaseClient
    .from("transaction_classification_rules")
    .insert({
      user_id: appUserId,
      category_id: salaryCategoryId,
      rule_name: ruleName,
      match_field: "description",
      match_operator: "regex",
      pattern_text: "(sal[aá]rio|portabilidade|folha|pagamento\\s+de\\s+sal[aá]rio)",
      priority: 15,
      target_movement_type: "income",
      notes: "Regra inicial padrao para identificar salario sem depender de banco ou identificador pessoal.",
      is_active: true,
    });
}

async function loadClassificationRules(client, appUserId) {
  await ensureDefaultClassificationRules(appUserId);

  const { data, error } = await client
    .from("transaction_classification_rules")
    .select("id,rule_name,match_field,match_operator,pattern_text,priority,target_movement_type,category_id,counterparty_id,is_active")
    .eq("user_id", appUserId)
    .eq("is_active", true)
    .is("archived_at", null)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    return [];
  }

  return data ?? [];
}

async function ensureCounterpartyForRule(appUserId, displayName) {
  const normalizedName = normalizeText(displayName);

  const { data: existing } = await adminSupabaseClient
    .from("counterparties")
    .select("id")
    .eq("user_id", appUserId)
    .eq("normalized_name", normalizedName)
    .maybeSingle();

  if (existing?.id) return existing.id;

  const { data } = await adminSupabaseClient
    .from("counterparties")
    .insert({
      user_id: appUserId,
      display_name: displayName,
      normalized_name: normalizedName,
      counterparty_type: "merchant",
    })
    .select("id")
    .single();

  return data?.id ?? null;
}

async function applyClassificationRuleSet(client, appUserId, transaction) {
  const rules = await loadClassificationRules(client, appUserId);
  const matchedRule = rules.find((rule) => matchRule(rule, transaction));

  if (!matchedRule) {
    return {
      category_id: null,
      counterparty_id: null,
      movement_type: transaction.movementType,
      matched_rule_id: null,
      matched_rule_name: null,
    };
  }

  let counterpartyId = matchedRule.counterparty_id ?? null;
  if (!counterpartyId && transaction.description) {
    counterpartyId = await ensureCounterpartyForRule(appUserId, transaction.description.slice(0, 160));
  }

  return {
    category_id: matchedRule.category_id ?? null,
    counterparty_id: counterpartyId,
    movement_type: matchedRule.target_movement_type || transaction.movementType,
    matched_rule_id: matchedRule.id,
    matched_rule_name: matchedRule.rule_name,
  };
}

async function learnClassificationRule(client, appUserId, transaction, categoryId, counterpartyId = null) {
  const patternText = learnedPatternFromDescription(transaction.description);
  if ((!categoryId && !counterpartyId) || patternText.length < 4) return null;

  const { data: existing, error: existingError } = await client
    .from("transaction_classification_rules")
    .select("id")
    .eq("user_id", appUserId)
    .eq("match_field", "description")
    .eq("match_operator", "contains")
    .eq("pattern_text", patternText)
    .is("archived_at", null)
    .limit(1)
    .maybeSingle();

  if (existingError) throw existingError;

  const payload = {
    rule_name: `Aprendida: ${patternText}`.slice(0, 120),
    pattern_text: patternText,
    priority: 50,
    target_movement_type: null,
    notes: "Regra criada automaticamente a partir de categorizacao manual.",
    is_active: true,
    archived_at: null,
  };
  if (categoryId) payload.category_id = categoryId;
  if (counterpartyId) payload.counterparty_id = counterpartyId;

  if (existing?.id) {
    const { data, error } = await client
      .from("transaction_classification_rules")
      .update(payload)
      .eq("id", existing.id)
      .eq("user_id", appUserId)
      .select("id,category_id,counterparty_id,pattern_text")
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await client
    .from("transaction_classification_rules")
    .insert({
      user_id: appUserId,
      match_field: "description",
      match_operator: "contains",
      ...payload,
    })
    .select("id,category_id,counterparty_id,pattern_text")
    .single();
  if (error) throw error;
  return data;
}

module.exports = {
  applyClassificationRuleSet,
  learnedPatternFromDescription,
  learnClassificationRule,
  matchRule,
};
