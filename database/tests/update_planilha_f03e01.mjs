import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "file:///C:/Users/mateu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";

const workbookPath = "C:\\temp\\Projeto_Financeiro\\Plano_Implantacao_Projeto_Financeiro.xlsx";
const outputDir = "C:\\Users\\mateu\\.codex\\visualizations\\2026\\07\\26\\019f9e6f-6a43-7131-ac21-c5bb1d78de0e\\planilha_f03e01";

function toExcelSerial(date) {
  const epoch = Date.UTC(1899, 11, 30);
  return (date.getTime() - epoch) / 86400000;
}

const stamp = toExcelSerial(new Date("2026-08-01T18:30:00Z"));
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

const overview = workbook.worksheets.getItem("Visao_Geral");
const plan = workbook.worksheets.getItem("Plano_Implantacao");
const changelog = workbook.worksheets.getItem("Registro_Alteracoes");
const decisions = workbook.worksheets.getItem("Decisoes");
const risks = workbook.worksheets.getItem("Riscos_Pendencias");

overview.getRange("E5").values = [[18]];
overview.getRange("E8").values = [[18 / 33]];
overview.getRange("B10").values = [[
  "Autenticacao funcional migrada para Supabase Auth com leituras por usuario e RLS efetivo; pendente apenas comprovacao operacional final do deploy no Render",
]];

plan.getRange("A36:P36").copyTo(plan.getRange("A37:P37"), "all");
plan.getRange("A37:O37").values = [[
  "F03-E01",
  "Aplicacao",
  "Adaptar autenticacao, acesso ao Supabase e implantacao no Render",
  "Revisar o fluxo atual, substituir o JWT legado das rotas financeiras por autenticacao compativel com Supabase Auth, consolidar clientes Supabase por contexto, adaptar frontend somente no necessario, validar localmente, preparar deploy no Render, revisar secrets e atualizar a documentacao e a planilha sem expor chaves.",
  "Backend e frontend adaptados para sessao baseada em token do Supabase; middleware oficial consolidado; leituras de /gastos/* movidas para cliente de usuario com RLS; /health oficial criado com compatibilidade legada; scripts de bootstrap e validacao adicionados; validacao local automatizada aprovada com usuarios sinteticos A e B, CORS, refresh, logout e ausencia de service_role no frontend.",
  "Concluido",
  "Alta",
  "Codex",
  stamp,
  stamp,
  "100%",
  "F02-E14",
  "A implementacao local removeu o uso funcional do JWT proprio nas rotas financeiras e passou a depender de access token do Supabase Auth propagado pelo frontend. O backend agora separa claramente cliente de autenticacao, cliente de usuario e cliente administrativo, preservando service_role apenas para rotinas controladas. A validacao local automatizada comprovou isolamento entre usuarios sinteticos A e B em todas as rotas /gastos/*. A comprovacao operacional final do Render continua dependente do ambiente externo e deve ser registrada separadamente quando o deploy publico for confirmado.",
  "api-financas-backend/src/app.js; api-financas-backend/src/routes/auth.js; api-financas-backend/src/routes/gastos.js; api-financas-backend/src/routes/health.js; api-financas-backend/src/config/runtime.js; api-financas-backend/src/config/supabaseClients.js; api-financas-backend/src/config/supabase.js; api-financas-backend/src/config/supabaseClient.js; api-financas-backend/src/middlewares/requireSupabaseAuth.js; api-financas-backend/src/middlewares/auth.js; api-financas-backend/src/middlewares/authMiddleware.js; api-financas-backend/database/tests/f03e01_runtime_validation.mjs; api-financas-backend/database/tests/f03e01_bootstrap_owner_user.mjs; api-financas-backend/database/docs/f03e01_runtime_validation.json; api-financas-backend/database/docs/f03e01_auth_render_report.md; api-financas-backend/README.md; api-financas-frontend/index.html; api-financas-frontend/app.js; api-financas-frontend/style.css; api-financas-frontend/README.md; README.md; docs/arquitetura.md; docs/decisoes.md; docs/governanca.md; Plano_Implantacao_Projeto_Financeiro.xlsx",
  stamp,
]];
plan.getRange("P37").clear({ applyTo: "contents" });

changelog.getRange("A19:G19").copyTo(changelog.getRange("A20:G20"), "all");
changelog.getRange("A20:G20").values = [[
  stamp,
  "F03-E01",
  "Adaptacao funcional de autenticacao e leituras para Supabase Auth com RLS efetivo, incluindo atualizacao minima do frontend e consolidacao documental.",
  "api-financas-backend/src/app.js; api-financas-backend/src/routes/auth.js; api-financas-backend/src/routes/gastos.js; api-financas-backend/src/routes/health.js; api-financas-backend/src/config/runtime.js; api-financas-backend/src/config/supabaseClients.js; api-financas-backend/src/middlewares/requireSupabaseAuth.js; api-financas-backend/database/tests/f03e01_runtime_validation.mjs; api-financas-backend/database/tests/f03e01_bootstrap_owner_user.mjs; api-financas-backend/database/docs/f03e01_runtime_validation.json; api-financas-backend/database/docs/f03e01_auth_render_report.md; api-financas-backend/README.md; api-financas-frontend/index.html; api-financas-frontend/app.js; api-financas-frontend/style.css; api-financas-frontend/README.md",
  "README.md; docs/arquitetura.md; docs/decisoes.md; docs/governanca.md; Plano_Implantacao_Projeto_Financeiro.xlsx",
  "Validacao local automatizada aprovada; nenhum secret registrado; deploy publico depende de comprovacao operacional do Render; frontend preservado sem service_role",
  "Concluido localmente com prontidao tecnica para deploy controlado",
]];

decisions.getRange("A55:G55").copyTo(decisions.getRange("A56:G56"), "all");
decisions.getRange("A55:G55").copyTo(decisions.getRange("A57:G57"), "all");
decisions.getRange("A55:G55").copyTo(decisions.getRange("A58:G58"), "all");
decisions.getRange("A55:G55").copyTo(decisions.getRange("A59:G59"), "all");
decisions.getRange("A56:G59").values = [
  ["DEC-055", stamp, "Login permanece mediado pelo backend, mas a identidade final passa a ser do Supabase Auth.", "A etapa precisava adotar Supabase Auth sem reescrever o frontend inteiro nem manter dois fluxos concorrentes de autenticacao.", "Login direto no frontend com supabase-js; login mediado pelo backend usando Supabase Auth.", "Reduz impacto no frontend estatico, centraliza o tratamento de erro e evita uma pilha paralela de autenticacao.", "O frontend passa a lidar apenas com a sessao devolvida pelo backend e com o envio do bearer token."],
  ["DEC-056", stamp, "Rotas /gastos/* devem usar cliente de usuario com SUPABASE_ANON_KEY + bearer token.", "As leituras com service_role anulavam o isolamento funcional mesmo com o banco remoto ja validado.", "Manter service_role e filtrar por aplicacao; propagar o token do usuario e deixar o RLS decidir.", "Alinha o backend ao mapeamento sub -> users.auth_subject -> users.id e elimina a confianca em user_id enviado pelo cliente.", "Service_role fica restrita a rotinas controladas e scripts administrativos."],
  ["DEC-057", stamp, "/health passa a ser canonico e /health/health vira compatibilidade temporaria.", "O backend antigo gerava a rota duplicada por causa da combinacao entre app.use('/health') e router.get('/health').", "Quebrar imediatamente a rota antiga; manter compatibilidade temporaria.", "Permite ajustar o Render sem quebrar o servico atual no meio da transicao.", "A remocao do legado depende de confirmacao posterior do health check oficial no Render."],
  ["DEC-058", stamp, "Usuario proprietario real deve ser criado por bootstrap controlado ou painel do Supabase Auth.", "O sistema e pessoal e o banco remoto validado ainda nao tinha usuarios reais em public.users.", "Criar por seed/migration; abrir cadastro publico; usar bootstrap controlado.", "Evita senha em SQL, Git e documentacao e preserva o principio de nao abrir cadastro publico sem aprovacao.", "O script de bootstrap deve ser executado apenas com ambiente seguro e fora do frontend."],
];

risks.getRange("A57:H57").copyTo(risks.getRange("A58:H58"), "all");
risks.getRange("A57:H57").copyTo(risks.getRange("A59:H59"), "all");
risks.getRange("A57:H57").copyTo(risks.getRange("A60:H60"), "all");
risks.getRange("A58:H60").values = [
  ["R-033", "Risco", "O deploy publico da F03-E01 no Render pode falhar se o servico backend ainda estiver com health check legado ou variaveis desatualizadas.", "Alto", "Alta", "Alta", "Confirmar health check path=/health, revisar variaveis do backend e validar as URLs publicas apos o push na branch usada pelo servico.", "Codex"],
  ["R-034", "Risco", "Ainda nao existe usuario proprietario real ativo em public.users, o que impede validacao publica com credencial definitiva sem bootstrap controlado.", "Medio", "Alta", "Media", "Executar o bootstrap controlado do owner ou criar o usuario pelo painel do Supabase Auth antes da homologacao final de producao.", "Codex"],
  ["P-025", "Pendencia", "A comprovacao operacional final do Render depende do ambiente externo e deve ser registrada separadamente se o deploy nao puder ser observado integralmente nesta etapa.", "Medio", "Alta", "Alta", "Registrar o resultado real do push, do deploy e das URLs publicas assim que o ambiente permitir observacao completa sem expor logs sensiveis.", "Codex"],
];

await renderSheet("Visao_Geral", "visao_geral_after.png");
await renderSheet("Plano_Implantacao", "plano_implantacao_after.png");
await renderSheet("Registro_Alteracoes", "registro_alteracoes_after.png");
await renderSheet("Decisoes", "decisoes_after.png");
await renderSheet("Riscos_Pendencias", "riscos_after.png");

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(workbookPath);

console.log("Workbook updated for F03-E01");
