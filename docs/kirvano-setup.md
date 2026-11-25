# Integração Kirvano

## 1. Ofertas recorrentes

Crie um produto Advora na Kirvano e seis ofertas de assinatura:

| Plano | Mensal | Anual |
| --- | ---: | ---: |
| Essencial | R$ 149 | R$ 1.428 |
| Performance | R$ 399 | R$ 3.828 |
| Business | R$ 999 | R$ 9.588 |

O valor anual equivale a R$ 119, R$ 319 e R$ 799 por mês, respectivamente. A recorrência anual pode ser parcelada no checkout conforme as regras da Kirvano.

## 2. Variáveis do ambiente

Configure no ambiente hospedado:

```text
KIRVANO_WEBHOOK_TOKEN=
KIRVANO_ESSENTIAL_MONTHLY_CHECKOUT_URL=https://pay.kirvano.com/...
KIRVANO_ESSENTIAL_ANNUAL_CHECKOUT_URL=https://pay.kirvano.com/...
KIRVANO_PERFORMANCE_MONTHLY_CHECKOUT_URL=https://pay.kirvano.com/...
KIRVANO_PERFORMANCE_ANNUAL_CHECKOUT_URL=https://pay.kirvano.com/...
KIRVANO_BUSINESS_MONTHLY_CHECKOUT_URL=https://pay.kirvano.com/...
KIRVANO_BUSINESS_ANNUAL_CHECKOUT_URL=https://pay.kirvano.com/...
KIRVANO_ESSENTIAL_MONTHLY_OFFER_ID=
KIRVANO_ESSENTIAL_ANNUAL_OFFER_ID=
KIRVANO_PERFORMANCE_MONTHLY_OFFER_ID=
KIRVANO_PERFORMANCE_ANNUAL_OFFER_ID=
KIRVANO_BUSINESS_MONTHLY_OFFER_ID=
KIRVANO_BUSINESS_ANNUAL_OFFER_ID=
```

Também é possível configurar `KIRVANO_ESSENTIAL_PRODUCT_ID`, `KIRVANO_PERFORMANCE_PRODUCT_ID` e `KIRVANO_BUSINESS_PRODUCT_ID` como fallback. Ofertas separadas são preferíveis porque identificam corretamente o plano e o ciclo.

## 3. Webhook

Na Kirvano, acesse **Integrações → Webhooks** e configure:

- URL: `https://SEU-DOMINIO/webhooks/kirvano`
- Token: o mesmo valor de `KIRVANO_WEBHOOK_TOKEN`
- Eventos: compra aprovada, assinatura renovada, assinatura atrasada, assinatura cancelada, reembolso e chargeback.

O painel envia o token no cabeçalho `Security-Token`. Inclua também o evento de devolução PIX (SALE_MED). Use os logs do painel para conferir entrega e reenvio durante a homologação. [Documentação da Kirvano](https://help.kirvano.com/hc/pt-br/articles/1765385505-configurando-integracao-via-webhook)

## 4. Fluxo de identificação

O checkout é aberto pelo proprietário autenticado. Na primeira compra, use o e-mail confirmado da conta proprietária do escritório. O banco confere esse vínculo e o identificador enviado pelo checkout. Eventos posteriores da mesma venda usam o vínculo já registrado.

## 5. Banco de dados

Após as migrations anteriores do projeto, aplique `20261124010000_business_trial.sql` e `20261124020000_atomic_kirvano.sql` antes de publicar o frontend e o webhook. Novos escritórios recebem 7 dias de Business. No Supabase Auth, autorize os retornos do domínio de produção em `/auth/callback` e `/auth/recuperar`.

