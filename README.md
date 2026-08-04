# RebeccaCash - Backend

Backend Node.js/Express responsavel por autenticar contra o Supabase Auth, validar tokens de usuario e consultar as views financeiras no contexto do usuario autenticado.

## Estado final da F03-E02

- `POST /auth/login` autentica no Supabase Auth usando `usuario` + `senha`.
- `GET /auth/me` valida o `Bearer token` e devolve o contexto minimo de `req.user`.
- `POST /auth/refresh` renova a sessao via refresh token do Supabase.
- `POST /auth/logout` encerra a sessao do usuario autenticado.
- `GET /gastos/*` usa cliente Supabase com `SUPABASE_ANON_KEY` + `Authorization: Bearer <access_token>`, respeitando RLS.
- O cliente administrativo com `SUPABASE_SERVICE_ROLE_KEY` permanece isolado para rotinas controladas.
- O frontend publicado passou a executar recuperacao e redefinicao de senha diretamente com `supabase-js`, usando apenas `SUPABASE_URL` e `SUPABASE_ANON_KEY`.
- `/health` e a rota canonica. `/health/health` permanece apenas como compatibilidade temporaria.

## Estado local da F04-E01

- `POST /imports/ofx/preview` recebe um arquivo OFX via `multipart/form-data`, faz parsing em memoria, detecta instituicao, calcula hash, registra `imports`/`import_files`/`import_rows` e devolve preview sem criar `transactions`.
- `POST /imports/ofx/confirm` confirma uma importacao previamente registrada e cria `transactions` apenas para linhas aceitas e ainda nao confirmadas.
- `GET /imports` lista o historico resumido das importacoes do usuario autenticado.
- `GET /imports/:id` devolve os detalhes resumidos da importacao e das linhas processadas.
- `POST /imports/:id/cancel` cancela apenas importacoes ainda nao confirmadas.
- `GET /imports/options` lista instituicoes suportadas e contas financeiras do usuario.
- `POST /imports/accounts` permite criar a conta financeira de destino diretamente no fluxo de importacao.
- O upload usa `multer` com `memoryStorage`, limite de 5 MB e um arquivo por operacao.
- O parser OFX foi implementado em Node.js puro com suporte local a OFX SGML e XML, incluindo fixtures sinteticas de Nubank e Banco Inter.
- A analise mascarada dos OFX reais ficou registrada em `database/docs/ofx_real_samples_analysis.md`.
- Testes automatizados locais atuais: `npm test` cobre o parser OFX com fixtures sinteticas.
- A integracao Gmail/Google OAuth foi adiada por decisao do usuario nesta etapa.
- As tabelas `gmail_integrations` e `gmail_messages`, a migration 092 e os servicos relacionados permanecem apenas como infraestrutura futura inativa, sem uso no fluxo oficial atual.
- O backend sobe de forma saudavel sem `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` e `GMAIL_TOKEN_SECRET`.
- A solucao adotada para esta passada foi nao montar `/integrations/gmail` enquanto `GMAIL_INTEGRATION_ENABLED` nao estiver explicitamente habilitada.

## Estado local da RC 1.0

- `GET /portal/overview` consolida metricas, resumo bancario, ultimas transacoes, ultimas importacoes, categorias e tendencia mensal com dados reais.
- `GET /portal/profile` e `PUT /portal/profile` expõem e atualizam o perfil funcional do usuario no dominio financeiro.
- `PUT /portal/settings` atualiza `user_settings`, incluindo preferencias do dashboard e configuracoes do portal.
- `GET|POST|PUT|DELETE /portal/catalog/:entity` cria a camada real de CRUD para `accounts`, `categories`, `cards`, `counterparties` e `institutions`.
- O backend passou a sustentar o menu completo do frontend 1.0 sem depender de componentes ilustrativos ou rotas vazias.
- A validacao `npm run validate:f04e01` continuou aprovada apos a introducao das novas rotas de portal, preservando o fluxo OFX homologado.

## Estado local da F04-E01-R2

- a integracao Gmail voltou a ser tratada como feature ativa do RebeccaCash, protegida por `GMAIL_INTEGRATION_ENABLED`;
- `/integrations/gmail/status` passou a ser coberta por testes automatizados de roteamento, inclusive nos cenarios com feature ligada e desligada;
- o backend ganhou `404` controlado com JSON para impedir regressao para o fallback HTML padrao do Express;
- a validacao publica em `2026-08-02` confirmou:
  - `/health` -> `200`;
  - `/health/health` -> `200`;
  - `/integrations/gmail/status` sem token -> `401 missing_token`;
  - rota inexistente -> `404`;
- `src/services/gmailService.js` passou a validar configuracao minima do OAuth e a URL publica de callback em ambiente `production`;
- a criptografia AES-256-GCM do refresh token ganhou testes dedicados em `test/gmailCrypto.test.js`;
- o roteamento principal ganhou testes dedicados em `test/routing.test.js`.

## Estado consolidado da F05

- `src/services/ofxParser.js` passou a detectar extratos de conta e cartao pelo envelope OFX;
- `src/services/importsService.js` agora valida compatibilidade entre o tipo do OFX e a conta financeira de destino;
- `src/services/financeExperienceService.js` concentra overview, movimentacoes, duplicidades e parcelamentos;
- `src/services/transactionClassificationService.js` aplica regras de classificacao automatica na confirmacao da importacao;
- novas migrations F05:
  - `20260802_093__expand_financial_accounts_for_f05.sql`
  - `20260802_094__create_installment_plans.sql`
  - `20260802_095__create_installment_plan_items.sql`
  - `20260802_096__create_transaction_classification_rules.sql`
  - `20260802_097__secure_f05_tables.sql`
- novas fixtures e testes cobrem OFX sintetico de cartao Nubank;
- a validacao remota final de 2026-08-02 confirmou OFX real de cartao Nubank com 29 linhas, 28 transacoes criadas, 1 duplicidade tratada, idempotencia confirmada e regra `Salario portabilidade` persistida em `transaction_classification_rules`;
- `PATCH /portal/movements/:id`, `PATCH /portal/duplicates/:id` e `PATCH /portal/installments/:planId` fecharam a operacao manual de categorizacao, duplicidade e parcelamentos;
- a suite local combinou `node --check`, testes diretos de parser/roteamento e novos testes unitarios de parcelamento/rule matching.

## Estado consolidado da F06

- `GET /portal/suppliers` passou a expor analise agregada de fornecedores por periodo, banco, conta e categoria;
- `src/services/financeExperienceService.js` passou a normalizar fornecedor por descricao quando a contraparte ainda nao estiver cadastrada;
- `src/services/importsService.js` passou a devolver estados finais mais especificos para confirmacao incremental: `completed_with_duplicates` e `no_new_transactions`;
- a documentacao runtime historica da F03-E01 foi higienizada com `access_token` e `refresh_token` substituidos por `[REDACTED]`;
- a validacao autenticada publicada de 2026-08-04 confirmou dashboard real, `Revisoes` publicado, `Fornecedores` publicado e separacao entre saldo disponivel e cartao de credito.

## Variaveis de ambiente

- `NODE_ENV`
- `PORT`
- `FRONTEND_URL`
- `ADDITIONAL_FRONTEND_ORIGINS`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GMAIL_INTEGRATION_ENABLED` opcional; manter ausente ou `false` enquanto a automacao por e-mail estiver adiada
- `JWT_SECRET` somente se alguma dependencia legada residual ainda precisar
- `OWNER_EMAIL`
- `OWNER_DISPLAY_NAME`
- `OWNER_PROFILE_CODE`
- `OWNER_STATUS_CODE`

Nunca registrar valores reais em documentacao, Git, logs ou scripts versionados.

## Fluxo de autenticacao

1. O frontend envia `POST /auth/login` com `usuario` e `senha`.
2. O backend autentica no Supabase Auth.
3. O backend devolve apenas a sessao necessaria ao frontend.
4. O frontend envia `Authorization: Bearer <access_token>` nas rotas protegidas.
5. O middleware `requireSupabaseAuth` valida o token com `supabase.auth.getUser(token)`.
6. As consultas financeiras usam um cliente de usuario, nunca `service_role`.

## Clientes Supabase oficiais

- Cliente de usuario: `src/config/supabaseClients.js` -> `createSupabaseUserClient(accessToken)`
- Cliente de autenticacao: `src/config/supabaseClients.js` -> `createSupabaseAuthClient()`
- Cliente administrativo: `src/config/supabaseClients.js` -> `adminSupabaseClient`

## Scripts relevantes

- `npm start`
- `npm run validate:auth-flow`
- `npm run bootstrap:owner`

## Validacao local da F03-E01

O script `database/tests/f03e01_runtime_validation.mjs` cobre:

- login valido e invalido;
- token ausente, malformado e expirado;
- `/auth/me`, refresh e logout;
- `/health` e `/health/health`;
- CORS permitido e bloqueado;
- isolamento entre usuarios sinteticos A e B em todas as rotas `/gastos/*`;
- ausencia de `service_role` no frontend.

Resultado atual consolidado:
- `database/docs/f03e01_runtime_validation.json`

## Bootstrap controlado do usuario proprietario

O script `database/tests/f03e01_bootstrap_owner_user.mjs` existe para preparar o usuario proprietario real sem gravar senha em migration, seed ou documentacao.

Ele deve ser executado apenas com variaveis de ambiente seguras e fora do frontend.

Na F03-E02 ele deixou de depender de `OWNER_PASSWORD` e passou a:

- criar o owner por convite administrativo quando o usuario ainda nao existe no Supabase Auth;
- alinhar metadados e o vinculo em `public.users`;
- reenviar recuperacao de senha por e-mail sem passar a senha pelo backend.

Conclusao:
- a URL Configuration hospedada do Supabase Auth foi corrigida;
- o redirect administrativo final ficou alinhado a `https://api-financas-frontend.onrender.com`;
- o proprietario definiu a propria senha com sucesso;
- a remocao de `OWNER_PASSWORD` no Render ficou registrada como informada pelo usuario.

## Deploy

Repositorio oficial:
- `https://github.com/mzalmeida/api-financas-backend.git`

Branch atual ligada ao deploy:
- `main`

O deploy publico no Render deve usar:
- `NODE_ENV=production`
- `FRONTEND_URL` apontando para a URL publica do frontend
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `health check path` = `/health`

`SUPABASE_SERVICE_KEY` deve permanecer apenas como alias legado enquanto nao houver prova de remocao completa do ambiente.

## Estado publico da F03-E01-R1

- backend publico validado em `https://api-financas-backend1.onrender.com`
- `GET /` retorna `200` com `{"status":"API Financas online"}`
- `GET /health` retorna `200` com status `ok`
- `GET /health/health` permanece ativo apenas como compatibilidade temporaria
- o fluxo publico validou login, refresh, logout, CORS e isolamento entre usuarios sinteticos A e B nas rotas `/gastos/*`
- artefatos da validacao publica:
  - `database/docs/f03e01_render_rollout_validation.json`
  - `database/docs/f03e01_render_rollout_validation.md`
