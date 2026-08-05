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

O endpoint aceita o token nos cabeçalhos `x-kirvano-token`, `x-webhook-token`, `authorization` ou `token`. Os eventos são idempotentes e não armazenam documento ou telefone do comprador.

## 4. Fluxo de identificação

O checkout é aberto pelo proprietário autenticado e recebe nome, e-mail e o identificador do escritório nos parâmetros aceitos pela Kirvano. O webhook usa o identificador em `utm_term` e, como fallback, o e-mail do comprador para localizar o tenant.

## 5. Banco de dados

Aplicar a migração `20260804170000_kirvano_subscriptions.sql` antes de ativar o webhook. Escritórios existentes recebem 14 dias de experiência sem serem bloqueados imediatamente.

