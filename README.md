# API Financas - Backend

Backend Node.js/Express responsavel por autenticar contra o Supabase Auth, validar tokens de usuario e consultar as views financeiras no contexto do usuario autenticado.

## Estado da F03-E01

- `POST /auth/login` autentica no Supabase Auth usando `usuario` + `senha`.
- `GET /auth/me` valida o `Bearer token` e devolve o contexto minimo de `req.user`.
- `POST /auth/refresh` renova a sessao via refresh token do Supabase.
- `POST /auth/logout` encerra a sessao do usuario autenticado.
- `GET /gastos/*` usa cliente Supabase com `SUPABASE_ANON_KEY` + `Authorization: Bearer <access_token>`, respeitando RLS.
- O cliente administrativo com `SUPABASE_SERVICE_ROLE_KEY` permanece isolado para rotinas controladas.
- `/health` e a rota canonica. `/health/health` permanece apenas como compatibilidade temporaria.

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
- `OWNER_PASSWORD`
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
