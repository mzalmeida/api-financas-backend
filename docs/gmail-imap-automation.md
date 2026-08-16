# Automacao Gmail por IMAP

## Objetivo

Capturar anexos OFX recebidos no Gmail sem usar Google Cloud ou Gmail API. Os anexos validos entram no fluxo oficial como preview com status `pending_confirmation`; nenhuma transacao e confirmada automaticamente.

## Protecoes

- a senha normal da conta Google nao e aceita; usar senha de aplicativo exclusiva;
- a senha de aplicativo existe somente em `GMAIL_IMAP_APP_PASSWORD` no ambiente do backend;
- mensagens precisam combinar remetente autorizado, assunto contendo `extrato` e anexo `.ofx` nao vazio de ate 5 MB;
- o OFX precisa confirmar a mesma instituicao indicada pelo remetente;
- conta corrente e cartao de credito sao separados pelo envelope do OFX;
- arquivos identicos sao bloqueados pelo hash SHA-256;
- mensagens e anexos ja processados sao bloqueados por identificadores persistidos;
- nenhum e-mail e apagado, movido ou marcado como lido;
- logs e respostas nunca devolvem senha de aplicativo ou conteudo bruto do OFX.

## Variaveis do Render

Obrigatorias:

```text
GMAIL_INTEGRATION_ENABLED=true
GMAIL_INTEGRATION_MODE=imap
GMAIL_IMAP_USER=<conta que recebe os OFX>
GMAIL_IMAP_APP_PASSWORD=<senha de aplicativo sem espacos>
GMAIL_SYNC_SECRET=<segredo aleatorio com no minimo 32 caracteres>
OWNER_EMAIL=<usuario proprietario no RebeccaCash>
```

Opcionais:

```text
GMAIL_IMAP_HOST=imap.gmail.com
GMAIL_IMAP_PORT=993
GMAIL_IMAP_SECURE=true
GMAIL_IMAP_MAILBOX=INBOX
GMAIL_IMAP_LOOKBACK_DAYS=45
GMAIL_IMAP_MESSAGE_LIMIT=50
GMAIL_IMAP_ALLOWED_SENDERS=todomundo@nubank.com.br,no-reply@inter.co
```

## Rotas

- `GET /integrations/gmail/status`: status mascarado, exige sessao RebeccaCash.
- `POST /integrations/gmail/sync`: sincronizacao manual, exige sessao RebeccaCash.
- `POST /integrations/gmail/scheduled-sync`: sincronizacao do agendador, exige `x-gmail-sync-secret`.

## Agendamento

O Supabase Cron deve realizar `POST` para:

```text
https://api-financas-backend1.onrender.com/integrations/gmail/scheduled-sync
```

Cabecalhos obrigatorios:

```text
Content-Type: application/json
x-gmail-sync-secret: <mesmo valor seguro configurado no Render>
```

O segredo deve ser armazenado no Supabase Vault. Nao inserir o valor literal em migration, documentacao ou Git.

## Operacao

1. O agendador acorda o backend e solicita a sincronizacao.
2. O backend pesquisa apenas remetentes autorizados dentro da janela configurada.
3. Cada anexo passa por validacao de nome, tamanho, remetente, assunto, instituicao e tipo de conta.
4. Um preview e registrado no historico com origem `integration`.
5. O usuario revisa e confirma pelo fluxo normal do portal.
6. Uma nova execucao ignora mensagens, anexos e hashes ja registrados.
