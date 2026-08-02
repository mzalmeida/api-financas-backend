import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "file:///C:/Users/mateu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";

const workbookPath = "C:\\temp\\Projeto_Financeiro\\Plano_Implantacao_Projeto_Financeiro.xlsx";
const outputDir = "C:\\Users\\mateu\\.codex\\visualizations\\2026\\07\\26\\019f9e6f-6a43-7131-ac21-c5bb1d78de0e\\planilha_f05";

function toExcelSerial(date) {
  const epoch = Date.UTC(1899, 11, 30);
  return (date.getTime() - epoch) / 86400000;
}

const stamp = toExcelSerial(new Date("2026-08-02T20:58:00Z"));
const input = await FileBlob.load(workbookPath);
const workbook = await SpreadsheetFile.importXlsx(input);

async function renderSheet(sheetName, fileName) {
  const blob = await workbook.render({
    sheetName,
    autoCrop: "all",
    scale: 1,
    format: "png",
  });
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, fileName), new Uint8Array(await blob.arrayBuffer()));
}

function nextUsedRow(sheet) {
  return sheet.getUsedRange().values.length + 1;
}

const overview = workbook.worksheets.getItem("Visao_Geral");
const plan = workbook.worksheets.getItem("Plano_Implantacao");
const changelog = workbook.worksheets.getItem("Registro_Alteracoes");
const decisions = workbook.worksheets.getItem("Decisoes");
const risks = workbook.worksheets.getItem("Riscos_Pendencias");

overview.getRange("E5").values = [[19]];
overview.getRange("E8").values = [[19 / 33]];
overview.getRange("B10").values = [[
  "F05 concluida: migrations 093-097 aplicadas no Supabase real, OFX real de cartao Nubank homologado, OFX sintetico Nubank/Inter preservado, regra de salario persistida, validacao autenticada final executada e deploy corretivo backend/frontend confirmado.",
]];

plan.getRange("F41").values = [["Concluido"]];
plan.getRange("J41").values = [[stamp]];
plan.getRange("K41").values = [["100%"]];
plan.getRange("M41").values = [[
  "Migrations 093-097 aplicadas no Supabase real; estrutura remota validada; OFX real de cartao Nubank homologado com 29 linhas, 28 transacoes criadas e 1 duplicidade tratada; OFX sintetico de conta Nubank e Inter preservados; regra `Salario portabilidade` persistida por usuario; categorizacao manual, decisao de duplicidade e operacao de parcelamentos publicadas e validadas.",
]];
plan.getRange("N41").values = [[
  "api-financas-backend/src/routes/portal.js; api-financas-backend/src/services/financeExperienceService.js; api-financas-backend/src/services/portalService.js; api-financas-backend/src/services/transactionClassificationService.js; api-financas-backend/test/financeExperienceService.test.js; api-financas-backend/database/docs/f05_runtime_validation.md; api-financas-backend/database/docs/f05_runtime_validation.json; api-financas-backend/database/tests/update_planilha_f05.mjs; api-financas-frontend/app.js; api-financas-backend/README.md; api-financas-frontend/README.md; README.md; docs/arquitetura.md; docs/governanca.md; docs/decisoes.md; docs/roadmap.md; docs/ofx_importacao.md; docs/cartao_credito_ofx.md; docs/parcelamentos.md; Plano_Implantacao_Projeto_Financeiro.xlsx",
]];
plan.getRange("O41").values = [[stamp]];

changelog.getRange("A26:G26").values = [[
  stamp,
  "F05",
  "Conclusao da F05 com migrations aplicadas no Supabase real, homologacao do OFX real de cartao Nubank, regra inicial de salario persistida, validacao autenticada final e deploy corretivo backend/frontend.",
  "api-financas-backend/database/docs/f05_runtime_validation.md; api-financas-backend/database/docs/f05_runtime_validation.json; api-financas-backend/src/routes/portal.js; api-financas-backend/src/services/financeExperienceService.js; api-financas-backend/src/services/portalService.js; api-financas-backend/src/services/transactionClassificationService.js; api-financas-backend/test/financeExperienceService.test.js; api-financas-frontend/app.js",
  "README.md; api-financas-backend/README.md; api-financas-frontend/README.md; docs/arquitetura.md; docs/governanca.md; docs/decisoes.md; docs/roadmap.md; docs/ofx_importacao.md; docs/cartao_credito_ofx.md; docs/parcelamentos.md; Plano_Implantacao_Projeto_Financeiro.xlsx",
  "Supabase CLI db push; validacao remota autenticada; OFX real autorizado sem versionamento; node --check; testes diretos de parser e roteamento; deploy hook frontend; health backend 200",
  "Concluido",
]];

const nextDecisionRow = nextUsedRow(decisions);
decisions.getRange(`A${nextDecisionRow}:G${nextDecisionRow}`).values = [[
  "DEC-071",
  stamp,
  "A F05 deve persistir uma regra padrao de salario por usuario.",
  "A homologacao final da F05 exigiu reconhecer descricoes equivalentes a salario por portabilidade sem depender de banco, numero ou dado pessoal.",
  "Classificar salario apenas por ajuste manual posterior; usar heuristica solta fora da base persistida.",
  "Persistir `Salario portabilidade` em `transaction_classification_rules` preserva a arquitetura aprovada e reduz retrabalho manual sem gravar dados sensiveis.",
  "Cada usuario passa a receber automaticamente a regra padrao apontando para a categoria compartilhada `Salario` com `movement_type = income`.",
]];

risks.getRange("A65:H65").values = [[
  "P-005",
  "Pendencia",
  "Monitorar homologacoes futuras de OFX reais fora do conjunto aprovado atual (Nubank conta/cartao e Inter).",
  "Baixo",
  "Media",
  "Baixa",
  "Abrir etapa dedicada sempre que um novo banco ou novo emissor de cartao precisar entrar no parser universal homologado.",
  "Mateus + Codex",
]];

await renderSheet("Visao_Geral", "visao_geral_after.png");
await renderSheet("Plano_Implantacao", "plano_implantacao_after.png");
await renderSheet("Registro_Alteracoes", "registro_alteracoes_after.png");
await renderSheet("Decisoes", "decisoes_after.png");
await renderSheet("Riscos_Pendencias", "riscos_after.png");

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(workbookPath);

console.log("Workbook updated for F05");
