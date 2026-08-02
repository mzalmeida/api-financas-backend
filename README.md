# API Financas - Backend

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

## Variaveis de ambiente

- `NODE_ENV`
- `PORT`
- `FRONTEND_URL`
- `ADDITIONAL_FRONTEND_ORIGINS`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
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
