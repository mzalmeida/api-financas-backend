# F03-E02 - Consolidacao do usuario proprietario e recuperacao de senha

## Escopo implementado

- frontend publicado com botao `Esqueci minha senha`, solicitacao de e-mail, tela de nova senha, confirmacao e tratamento de `PASSWORD_RECOVERY`;
- fluxo de redefinicao executado diretamente no Supabase Auth pelo navegador, sem envio da nova senha ao backend;
- login principal preservado via backend;
- script `database/tests/f03e01_bootstrap_owner_user.mjs` atualizado para convite/recuperacao administrativa sem `OWNER_PASSWORD`;
- `api-financas-backend/.env.example` atualizado sem `OWNER_PASSWORD`.

## Usuario proprietario real

- e-mail administrativo real criado ou encontrado em 2026-08-02;
- registro correspondente vinculado em `public.users`;
- `auth_provider = 'supabase'`;
- `auth_subject` alinhado ao `sub` do Auth;
- `profile_code = 'owner'`;
- `status_code = 'active'`;
- sem duplicidade identificada durante a auditoria administrativa executada pelo script.

## Validacao local concluida

Fluxo validado com usuario sintetico:

- solicitacao de recuperacao com mensagem neutra;
- abertura do link de redefinicao;
- definicao de nova senha com confirmacao;
- rejeicao da senha antiga;
- login com a senha nova;
- refresh;
- logout;
- restauracao de sessao;
- acesso posterior a `/gastos/*`.

## Validacao publica concluida

- frontend publicado em `https://api-financas-frontend.onrender.com`;
- backend publico saudavel em `https://api-financas-backend1.onrender.com/health`;
- HTML publicado contem o botao `Esqueci minha senha` e os estados de recuperacao/redefinicao.

## Correcao do redirect hospedado

- em 2026-08-02 foi identificado que o campo `Site URL` do Supabase Auth estava salvo incorretamente como `Site URL https://api-financas-frontend.onrender.com`;
- o valor foi corrigido manualmente no painel para `https://api-financas-frontend.onrender.com`;
- as Redirect URLs autorizadas permaneceram:
  - `https://api-financas-frontend.onrender.com`
  - `https://api-financas-frontend.onrender.com/`
  - `http://localhost:8080`
  - `http://localhost:8080/`
  - `http://127.0.0.1:8080`
  - `http://127.0.0.1:8080/`
- o frontend foi endurecido para usar a URL publica canonica em producao;
- o script administrativo do owner passou a sanitizar qualquer `FRONTEND_URL` invalida ou contaminada por texto adicional.

## Validacao do reenvio real

- uma unica nova solicitacao real de recuperacao foi reenviada ao proprietario apos a correcao hospedada;
- o redirect administrativo final ficou alinhado a `https://api-financas-frontend.onrender.com`;
- nenhum token, link completo, UUID completo ou conteudo sensivel do e-mail foi registrado;
- tokens e links anteriormente expostos foram tratados como comprometidos e nao foram reutilizados.

## Validacao final do proprietario real

- o proprietario confirmou a definicao da senha pelo fluxo seguro do Supabase;
- o owner permaneceu com um unico registro em `public.users`;
- `auth_provider = 'supabase'`;
- `auth_subject` permaneceu alinhado ao `sub` do Auth;
- `profile_code = 'owner'`;
- `status_code = 'active'`;
- `email_confirmed` e `last_sign_in_at` ficaram positivos na auditoria final;
- o login publico abriu normalmente o painel com os botoes principais;
- a rota `/gastos/banco` respondeu publicamente e exibiu `Nenhum dado encontrado.`, validando o fluxo sem erro funcional.

## Estado final

- F03-E02 concluida em 2026-08-02;
- `OWNER_PASSWORD` removida do fluxo oficial, do `.env.example` e do script administrativo; remocao no Render informada pelo usuario;
- login mediado pelo backend preservado;
- recuperacao e redefinicao executadas diretamente com Supabase Auth no frontend;
- nenhum secret, senha, token ou link sensivel registrado em documentacao ou commit.
