# WAHA no Advora CRM

O CRM suporta uma sessão WAHA isolada por escritório. Depois da leitura do QR
Code, mensagens enviadas no CRM usam o WAHA e mensagens recebidas entram em
**Comunicações**. A API oficial da Meta continua disponível como alternativa.

## 1. Preparar o servidor WAHA

Execute o WAHA em um host persistente, com HTTPS e armazenamento persistente
para as sessões. Proteja a API com uma chave forte. No ambiente do WAHA:

```dotenv
WAHA_API_KEY=sha512:<HASH_SHA512_DA_CHAVE>
```

O valor em texto puro correspondente ao hash será usado apenas no segredo
`WAHA_API_KEY` do Worker. Não exponha o dashboard ou a API sem autenticação.

## 2. Configurar os segredos do CRM

Configure estas quatro variáveis no ambiente do Worker:

```dotenv
WAHA_BASE_URL=https://waha.seu-dominio.com
WAHA_API_KEY=<CHAVE_EM_TEXTO_PURO>
WAHA_WEBHOOK_URL=https://advora.life/webhooks/waha
WAHA_WEBHOOK_HMAC_KEY=<SEGREDO_ALEATORIO_EXCLUSIVO>
```

`WAHA_BASE_URL` não deve terminar com `/`. A API key e o segredo HMAC nunca são
enviados ao navegador nem persistidos em tabelas acessíveis ao usuário.

## 3. Aplicar o banco e publicar

Aplique a migration `20260810120000_waha_whatsapp_provider.sql` antes de
publicar o Worker. Ela cria somente o mapeamento privado entre escritório,
instância interna e sessão WAHA.

## 4. Conectar o número

No Advora, acesse **Integrações → WhatsApp via WAHA**, clique em **Conectar com
WAHA** e leia o QR Code em **WhatsApp → Aparelhos conectados → Conectar
aparelho**.

## Segurança e operação

- O endpoint `/webhooks/waha` aceita somente `POST` assinado com HMAC SHA-512.
- Grupos, canais e status são ignorados nesta primeira versão.
- Os eventos configurados são `message`, `message.ack` e `session.status`.
- O envio valida o número com `contacts/check-exists`, importante para números
  brasileiros antigos com variação do nono dígito.
- O WAHA usa o protocolo do WhatsApp Web, não a Cloud API oficial da Meta. Use
  um número operacional dedicado e acompanhe as políticas e riscos da conta.
