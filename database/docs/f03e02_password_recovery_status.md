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

## Bloqueio atual

- o Supabase Auth hospedado ainda esta com `Site URL` e/ou `Redirect URLs` incompletas para o fluxo administrativo de convite/recuperacao;
- ao gerar link administrativo de recuperacao, o projeto ainda caiu no redirect legado local, evidenciando que a URL publica exata ainda nao esta autorizada no painel;
- sem esse ajuste, o envio real ao proprietario nao pode ser considerado concluido.

## Acao manual pendente

Ajustar no painel do Supabase Auth:

- `Site URL` = `https://api-financas-frontend.onrender.com`
- Redirect URLs autorizadas:
  - `https://api-financas-frontend.onrender.com`
  - `https://api-financas-frontend.onrender.com/`
  - `http://localhost:8080`
  - `http://localhost:8080/`
  - `http://127.0.0.1:8080`
  - `http://127.0.0.1:8080/`

Depois do ajuste hospedado:

1. reenviar a recuperacao para o e-mail do proprietario real;
2. pedir apenas confirmacao de recebimento e definicao da senha;
3. revalidar login publico final;
4. encerrar a mesma F03-E02.
