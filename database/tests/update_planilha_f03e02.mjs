import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "file:///C:/Users/mateu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";

const workbookPath = "C:\\temp\\Projeto_Financeiro\\Plano_Implantacao_Projeto_Financeiro.xlsx";
const outputDir = "C:\\Users\\mateu\\.codex\\visualizations\\2026\\07\\26\\019f9e6f-6a43-7131-ac21-c5bb1d78de0e\\planilha_f03e02";

function toExcelSerial(date) {
  const epoch = Date.UTC(1899, 11, 30);
  return (date.getTime() - epoch) / 86400000;
}

const stamp = toExcelSerial(new Date("2026-08-02T12:30:00Z"));
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
  "F03-E02 em andamento: frontend publico com recuperacao de senha validada e usuario proprietario vinculado, aguardando ajuste da URL Configuration do Supabase Auth e confirmacao do proprietario real.",
]];

plan.getRange("A37:P37").copyTo(plan.getRange("A38:P38"), "all");
plan.getRange("A38:O38").values = [[
  "F03-E02",
  "Aplicacao",
  "Consolidar o usuario proprietario e implementar recuperacao de senha por e-mail",
  "Consolidar o owner real no Supabase Auth e em public.users, remover OWNER_PASSWORD do fluxo oficial, publicar no frontend o fluxo de primeiro acesso e de recuperacao/redefinicao por e-mail, validar localmente e no Render sem expor senha, token ou secrets, e concluir somente apos confirmacao do proprietario real.",
  "Frontend publico com Esqueci minha senha, solicitacao neutra, tela de nova senha e tratamento de PASSWORD_RECOVERY; owner real criado e vinculado em public.users; OWNER_PASSWORD removida do fluxo oficial e do .env.example; validacao local completa concluida com usuario sintetico; validacao publica confirmou o frontend publicado e o backend saudavel; etapa pausada porque a URL Configuration hospedada do Supabase Auth ainda precisa ser ajustada para usar o redirect publico correto nos e-mails administrativos.",
  "Em andamento",
  "Alta",
  "Codex",
  stamp,
  stamp,
  "80%",
  "F03-E01",
  "A implementacao oficial manteve o login mediado pelo backend e moveu apenas o fluxo sensivel de recuperacao/redefinicao para o frontend com supabase-js, expondo somente SUPABASE_URL e SUPABASE_ANON_KEY. O script administrativo do owner deixou de depender de OWNER_PASSWORD e passou a criar por convite ou reenviar recuperacao sem receber a nova senha. O bloqueio remanescente nao esta mais no codigo local: o Supabase Auth hospedado ainda precisa ter Site URL e Redirect URLs ajustadas para que os e-mails administrativos terminem no frontend publico do Render.",
  "api-financas-frontend/index.html; api-financas-frontend/app.js; api-financas-frontend/style.css; api-financas-frontend/README.md; api-financas-backend/database/tests/f03e01_bootstrap_owner_user.mjs; api-financas-backend/database/docs/f03e02_password_recovery_status.md; api-financas-backend/.env.example; api-financas-backend/README.md; README.md; docs/arquitetura.md; docs/decisoes.md; docs/governanca.md; docs/roadmap.md; Plano_Implantacao_Projeto_Financeiro.xlsx",
  stamp,
]];
plan.getRange("P38").clear({ applyTo: "contents" });

changelog.getRange("A20:G20").copyTo(changelog.getRange("A21:G21"), "all");
changelog.getRange("A21:G21").values = [[
  stamp,
  "F03-E02",
  "Implementacao do fluxo de recuperacao e redefinicao de senha por e-mail no frontend, consolidacao do owner real e remocao de OWNER_PASSWORD do fluxo oficial.",
  "api-financas-frontend/index.html; api-financas-frontend/app.js; api-financas-frontend/style.css; api-financas-frontend/README.md; api-financas-backend/database/tests/f03e01_bootstrap_owner_user.mjs; api-financas-backend/database/docs/f03e02_password_recovery_status.md; api-financas-backend/.env.example; api-financas-backend/README.md",
  "README.md; docs/arquitetura.md; docs/decisoes.md; docs/governanca.md; docs/roadmap.md; Plano_Implantacao_Projeto_Financeiro.xlsx",
  "Fluxo local validado de ponta a ponta; frontend publico publicado; owner real vinculado; nenhum secret registrado; etapa pausada por configuracao hospedada pendente do Supabase Auth",
  "Em andamento",
]];

decisions.getRange("A60:G60").copyTo(decisions.getRange("A61:G61"), "all");
decisions.getRange("A60:G60").copyTo(decisions.getRange("A62:G62"), "all");
decisions.getRange("A60:G60").copyTo(decisions.getRange("A63:G63"), "all");
decisions.getRange("A61:G63").values = [
  ["DEC-060", stamp, "A recuperacao e a redefinicao de senha devem acontecer no frontend com supabase-js, mantendo o login mediado pelo backend.", "A F03-E02 precisava adicionar Esqueci minha senha e primeiro acesso por e-mail sem enviar a nova senha ao backend.", "Criar endpoints proprios de forgot/reset no backend; mover todo o login para o frontend; usar supabase-js apenas no trecho sensivel.", "Reduz o caminho sensivel da senha, evita duplicar logica de token de recuperacao e segue o fluxo suportado pelo Supabase Auth.", "O frontend passa a tratar PASSWORD_RECOVERY e a conviver com login mediado e reset direto no Supabase."],
  ["DEC-061", stamp, "OWNER_PASSWORD deixa de existir no fluxo oficial do usuario proprietario.", "O bootstrap da F03-E01 ainda mantinha OWNER_PASSWORD como opcional de operacao.", "Manter senha fixa fora do Git; exigir definicao manual de senha via backend; substituir por convite administrativo ou recuperacao por e-mail.", "Preserva o principio de nunca criar, exibir, documentar ou armazenar a senha real do proprietario.", "O script administrativo passa a depender da URL Configuration correta do Supabase Auth para gerar links publicos validos."],
  ["DEC-062", stamp, "A F03-E02 so pode ser concluida apos ajuste hospedado da URL Configuration do Supabase Auth e confirmacao manual do proprietario.", "A validacao local e a publicacao do frontend foram concluidas, mas convites/recuperacoes administrativos ainda podem cair no redirect legado local.", "Marcar a etapa como concluida apenas com HTTP 200; contornar o e-mail com senha temporaria; pausar formalmente ate corrigir o painel.", "A exigencia da etapa inclui redirect publico correto e conclusao segura do primeiro acesso.", "Documentacao, planilha e retorno da etapa devem registrar o bloqueio manual real sem mascarar o estado final."],
];

risks.getRange("A60:H60").copyTo(risks.getRange("A61:H61"), "all");
risks.getRange("A60:H60").copyTo(risks.getRange("A62:H62"), "all");
risks.getRange("A61:H62").values = [
  ["R-035", "Risco", "Enquanto a URL Configuration hospedada do Supabase Auth mantiver redirect legado local, convites e recuperacoes administrativas podem apontar para destino publico incorreto.", "Alto", "Alta", "Alta", "Ajustar Site URL e Redirect URLs no painel do Supabase antes de reenviar o e-mail ao proprietario real.", "Codex"],
  ["P-026", "Pendencia", "A F03-E02 depende apenas da acao manual de ajustar o painel do Supabase Auth e da confirmacao de recebimento/definicao da senha pelo proprietario real.", "Baixo", "Alta", "Baixa", "Depois do ajuste hospedado, reenviar a recuperacao, pedir somente a confirmacao do proprietario e revalidar o login publico final.", "Codex"],
];

await renderSheet("Visao_Geral", "visao_geral_after.png");
await renderSheet("Plano_Implantacao", "plano_implantacao_after.png");
await renderSheet("Registro_Alteracoes", "registro_alteracoes_after.png");
await renderSheet("Decisoes", "decisoes_after.png");
await renderSheet("Riscos_Pendencias", "riscos_after.png");

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(workbookPath);

console.log("Workbook updated for F03-E02");
