const crypto = require("crypto");

const INSTITUTION_RULES = [
  {
    slug: "nubank",
    normalizedNames: ["nubank"],
    names: ["nubank", "nu pagamentos", "nu pagamentos s.a.", "nu bank"],
    codes: ["260", "0260"],
  },
  {
    slug: "inter",
    normalizedNames: ["banco inter", "inter"],
    names: ["banco inter", "inter", "intermedium"],
    codes: ["077"],
  },
];

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function parseOfxHeaders(buffer) {
  const rawHeaderText = Buffer.from(buffer)
    .toString("latin1")
    .split(/<OFX>/i)[0]
    .replace(/\r\n?/g, "\n");

  const headers = {};
  rawHeaderText.split("\n").forEach((line) => {
    const match = /^([A-Z0-9_]+):(.*)$/.exec(line.trim());
    if (!match) return;
    headers[match[1]] = match[2].trim();
  });
  return headers;
}

function decodeOfxBuffer(buffer) {
  const headers = parseOfxHeaders(buffer);
  const headerEncoding = normalizeText(headers.ENCODING);
  const headerCharset = normalizeText(headers.CHARSET);

  if (headerCharset === "1252" || headerEncoding === "usascii") {
    return {
      text: Buffer.from(buffer).toString("latin1"),
      encoding: "windows-1252",
      headers,
    };
  }

  const utf8 = Buffer.from(buffer).toString("utf8");
  const replacementCount = (utf8.match(/\uFFFD/g) || []).length;
  if (replacementCount > 3) {
    return {
      text: Buffer.from(buffer).toString("latin1"),
      encoding: "latin1",
      headers,
    };
  }

  return {
    text: utf8,
    encoding: "utf8",
    headers,
  };
}

function normalizeOfxText(rawText) {
  return rawText.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

function extractTagValue(source, tagName) {
  const regex = new RegExp(`<${tagName}>([\\s\\S]*?)(?=<\\/?[A-Z0-9_]+>|$)`, "i");
  const match = regex.exec(source);
  if (!match) return null;
  return match[1].trim();
}

function extractAllBlocks(source, tagName) {
  const blocks = [];
  const regex = new RegExp(`<${tagName}>([\\s\\S]*?)<\/${tagName}>`, "gi");
  let match = regex.exec(source);

  while (match) {
    blocks.push(match[1]);
    match = regex.exec(source);
  }

  if (blocks.length > 0) {
    return blocks;
  }

  const startRegex = new RegExp(`<${tagName}>`, "gi");
  let startMatch = startRegex.exec(source);
  while (startMatch) {
    const startIndex = startMatch.index + startMatch[0].length;
    const remainder = source.slice(startIndex);
    const nextTagMatch = /<\/?STMTTRN>|<\/BANKTRANLIST>|<\/?LEDGERBAL>|<\/?BANKMSGSRSV1>|<\/?CREDITCARDMSGSRSV1>/i.exec(remainder);
    const endIndex = nextTagMatch ? startIndex + nextTagMatch.index : source.length;
    blocks.push(source.slice(startIndex, endIndex));
    startMatch = startRegex.exec(source);
  }

  return blocks;
}

function parseOfxDate(rawValue) {
  if (!rawValue) return null;
  const trimmed = String(rawValue).trim();
  const digits = trimmed.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!digits) return null;
  const [, year, month, day] = digits;
  return `${year}-${month}-${day}`;
}

function parseTimezone(rawValue) {
  if (!rawValue) return null;
  const match = String(rawValue).match(/\[([^\]]+)\]/);
  return match ? match[1] : null;
}

function parseNumericAmount(rawValue) {
  if (rawValue == null) return null;
  const normalized = String(rawValue).replace(/,/g, ".").trim();
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null;
}

function compactDescription(name, memo) {
  const parts = [name, memo]
    .map((value) => String(value ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  return parts.join(" - ").slice(0, 500);
}

function inferMovementType(trnType, amount, description) {
  const normalizedType = normalizeText(trnType);
  const normalizedDescription = normalizeText(description);
  const isTransfer = ["xfer", "transfer", "xferdep", "xferwd"].includes(normalizedType)
    || normalizedDescription.includes("transfer")
    || normalizedDescription.includes("ted")
    || normalizedDescription.includes("pix");

  if (isTransfer) return "transfer";
  if (amount == null || amount === 0) return "adjustment";
  return amount < 0 ? "expense" : "income";
}

function buildRowHash(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function detectStatementKind(text) {
  if (/<CREDITCARDMSGSRSV1>/i.test(text) || /<CCSTMTRS>/i.test(text)) {
    return "credit_card";
  }
  if (/<BANKMSGSRSV1>/i.test(text) || /<STMTRS>/i.test(text)) {
    return "bank_account";
  }
  return "unknown";
}

function detectInstitution(rawText, header, institutions = []) {
  const normalizedOrg = normalizeText(header.org);
  const normalizedFid = String(header.fid ?? "").trim();
  const normalizedBankId = String(header.bankId ?? "").trim();
  const textEvidence = normalizeText([
    header.org,
    header.accountId,
    header.accountType,
    header.curDef,
    rawText.slice(0, 4000),
  ].filter(Boolean).join(" "));

  const matchedRule = INSTITUTION_RULES.find((rule) => (
    rule.codes.includes(normalizedFid)
    || rule.codes.includes(normalizedBankId)
    || rule.names.some((matcher) => normalizedOrg.includes(normalizeText(matcher)))
    || rule.names.some((matcher) => textEvidence.includes(normalizeText(matcher)))
  ));
  if (!matchedRule) {
    return {
      institutionId: null,
      slug: null,
      label: null,
      confidence: "low",
    };
  }

  const institution = institutions.find((item) => matchedRule.normalizedNames.includes(normalizeText(item.normalized_name || item.name)));
  return {
    institutionId: institution?.id ?? null,
    slug: matchedRule.slug,
    label: institution?.name ?? (matchedRule.slug === "inter" ? "Banco Inter" : "Nubank"),
    confidence: institution ? "high" : "medium",
  };
}

function extractInstallmentMetadata(description) {
  const match = String(description ?? "").match(/parcela\s+(\d+)\s*\/\s*(\d+)/i);
  if (!match) return null;
  return {
    current: Number.parseInt(match[1], 10),
    total: Number.parseInt(match[2], 10),
  };
}

function parseTransactions(blocks, statementKind) {
  return blocks.map((block, index) => {
    const trnType = extractTagValue(block, "TRNTYPE");
    const name = extractTagValue(block, "NAME");
    const memo = extractTagValue(block, "MEMO");
    const refNum = extractTagValue(block, "REFNUM");
    const description = compactDescription(name, memo);
    const amount = parseNumericAmount(extractTagValue(block, "TRNAMT"));
    const rawPosted = extractTagValue(block, "DTPOSTED");
    const rawUser = extractTagValue(block, "DTUSER");
    const postedOn = parseOfxDate(rawPosted);
    const userDate = parseOfxDate(rawUser);
    const transaction = {
      rowNumber: index + 1,
      trnType,
      amount,
      postedOn,
      occurredOn: userDate || postedOn,
      fitId: extractTagValue(block, "FITID"),
      checkNum: extractTagValue(block, "CHECKNUM"),
      refNum,
      name,
      memo,
      description,
      statementKind,
      movementType: inferMovementType(trnType, amount, description),
      installment: extractInstallmentMetadata(description),
      rawData: {
        trnType,
        trnAmt: extractTagValue(block, "TRNAMT"),
        dtPosted: rawPosted,
        dtUser: rawUser,
        fitId: extractTagValue(block, "FITID"),
        checkNum: extractTagValue(block, "CHECKNUM"),
        refNum,
        name,
        memo,
      },
    };

    transaction.rowHash = buildRowHash(transaction.rawData);
    return transaction;
  });
}

function parseOfxBuffer(buffer, institutions = []) {
  const decoded = decodeOfxBuffer(buffer);
  const text = normalizeOfxText(decoded.text);
  const statementKind = detectStatementKind(text);
  const transactionBlocks = extractAllBlocks(text, "STMTTRN");
  const transactions = parseTransactions(transactionBlocks, statementKind);

  const header = {
    ofxHeader: decoded.headers.OFXHEADER || null,
    data: decoded.headers.DATA || null,
    version: decoded.headers.VERSION || null,
    security: decoded.headers.SECURITY || null,
    headerEncoding: decoded.headers.ENCODING || null,
    headerCharset: decoded.headers.CHARSET || null,
    statementKind,
    org: extractTagValue(text, "ORG"),
    fid: extractTagValue(text, "FID"),
    bankId: extractTagValue(text, "BANKID"),
    branchId: extractTagValue(text, "BRANCHID"),
    accountId: extractTagValue(text, "ACCTID"),
    accountType: extractTagValue(text, "ACCTTYPE"),
    curDef: extractTagValue(text, "CURDEF") || "BRL",
    startDate: parseOfxDate(extractTagValue(text, "DTSTART")),
    endDate: parseOfxDate(extractTagValue(text, "DTEND")),
    startTimezone: parseTimezone(extractTagValue(text, "DTSTART")),
    endTimezone: parseTimezone(extractTagValue(text, "DTEND")),
    ledgerBalance: parseNumericAmount(extractTagValue(text, "BALAMT")),
    ledgerAsOf: parseOfxDate(extractTagValue(text, "DTASOF")),
    availableBalance: parseNumericAmount(extractTagValue(text, "AVAILBAL")),
    availableAsOf: parseOfxDate(extractTagValue(text, "DTASOF")),
    serverDate: parseOfxDate(extractTagValue(text, "DTSERVER")),
    serverTimezone: parseTimezone(extractTagValue(text, "DTSERVER")),
    language: extractTagValue(text, "LANGUAGE"),
  };

  const detection = detectInstitution(text, header, institutions);
  const warnings = [];

  if (!header.startDate || !header.endDate) {
    warnings.push("Periodo do extrato nao foi identificado integralmente.");
  }

  if (!detection.institutionId) {
    warnings.push("Instituicao nao detectada automaticamente.");
  }

  if (statementKind === "credit_card") {
    warnings.push("Extrato identificado como cartao de credito; nao deve ser mesclado ao saldo disponivel.");
  }

  return {
    encoding: decoded.encoding,
    header,
    detection,
    warnings,
    transactions,
    rawText: text,
  };
}

module.exports = {
  normalizeText,
  parseOfxBuffer,
  parseOfxDate,
  parseNumericAmount,
  compactDescription,
  inferMovementType,
  detectStatementKind,
};
