## Auditoria + plano de execução

Fiz uma auditoria do código atual e do schema. O pedido é enorme (centenas de KPIs em 6+ telas, com realtime, exportações, drill-down, IA e novos módulos de CRM/pipeline). Muita coisa que você lista **não existe no banco hoje** — sem criar as tabelas primeiro, qualquer "métrica real" seria mockada de novo. Então proponho executar em ondas, começando pela fundação e pelo que já dá para calcular do schema atual.

### O que existe hoje no banco
- `cases` (status, area, responsible, value_cents, last_movement_at, distribution_date)
- `clients` (type PF/PJ, status, created_at)
- `financial_entries` (kind=income/expense, status=pending/paid/overdue, amount_cents, due_date, paid_at)
- `deadlines` (kind, due_at, done)
- `case_movements`, `whatsapp_*`, `ai_messages`, `profiles`, `user_roles`, `tenants`

### O que **não** existe (e precisa migration antes de virar métrica real)
- Pipeline CRM: `leads`, `pipeline_stages`, `lead_activities`, campos de origem/probabilidade/valor
- Áreas jurídicas normalizadas, fases de processo, ganho/perdido, arquivado/suspenso
- Contratos, mensalidades, parcelamentos, receita recorrente vs única
- Cidade/estado do cliente, LTV, origem do cliente, campanhas, CAC
- Custos por advogado, lucro bruto/líquido (precisa categorias de despesa)

---

### Onda 1 — Fundação (o que destrava tudo)
1. **Hook `useRealtimeTable`** que assina `postgres_changes` de uma tabela e invalida as queries do React Query — usado por todas as telas.
2. **Camada `src/lib/metrics.ts`** com funções puras que recebem as linhas cruas e devolvem os KPIs (mês, YTD, 12m, ticket médio, inadimplência, aging, taxa de êxito, tempo médio, etc.). Zero mock.
3. **Loading skeletons + estado vazio "Sem dados"** padronizados. Nenhum fallback numérico fictício.
4. **`GlobalFiltersContext`** (período, advogado, cliente, área, status) consumido por Dashboard / Financeiro / Processos / CRM.

### Onda 2 — Dashboard "Centro de Operações" real
Só KPIs deriváveis do schema atual, agrupados: Financeiro (MRR proxy, receita mês/YTD/12m, aberto, vencido, inadimplência %, ticket médio, receita por advogado/área/cliente), Processos (ativos/encerrados/arquivados/suspensos por `status`, valor em causa, por área, por responsável, sem movimentação 30/60/90d), Clientes (ativos/inativos, novos no mês, PF vs PJ, por responsável), Agenda (hoje/semana, vencidos, próximos 7d). Gráficos linha/área/barras/pizza usando Recharts com dados reais + filtros globais. Realtime nas 4 tabelas.

### Onda 3 — Financeiro operacional
Refatorar `financeiro.tsx`: receitas/despesas/fluxo diário-semanal-mensal-anual, contas a pagar/receber, aging, top clientes/áreas/advogados, comparação mês anterior e YoY, projeção linear dos próximos 3 meses. Export CSV/Excel (SheetJS). Realtime.

### Onda 4 — Processos + Agenda
Kanban por `status` com drag-to-update, histórico em `case_movements`, KPIs (tempo médio, sem movimentação, urgentes por prazo próximo). Agenda já tem base — remover os fallbacks `|| 8`, `|| 12`, etc., trocar por estado vazio.

### Onda 5 — CRM Pipeline (requer migration)
Migration criando `leads`, `pipeline_stages`, `lead_activities` (com origem, valor, probabilidade, owner, campanha). Refatorar `crm.tsx` como pipeline Kanban com forecast, taxa de conversão, valor ganho/perdido, ranking por advogado, funil, tempo médio de fechamento. Realtime.

### Onda 6 — Extras (fora do schema atual)
Contratos/mensalidades/recorrência, cidade/estado, CAC/LTV, IA de priorização, exportação PDF, heatmap, drill-down clicável. Cada um vira migration + UI dedicada.

---

### O que **não** vou fazer nesta rodada
- Inventar dado que não existe (LTV, CAC, campanhas, cidade/estado do cliente, custos por advogado) — esses viram Onda 6 com migration própria.
- Substituir a lógica de negócio, integrações (DataJud, Z-API), auth ou permissões existentes.
- Criar Views/Triggers no Postgres antes das ondas 5-6 — para os KPIs atuais o cálculo no client (com índice) já é suficiente e mais fácil de evoluir.

### Como quero prosseguir
Aprove e eu executo **Onda 1 + Onda 2 nesta resposta** (fundação + Dashboard totalmente real, com realtime, filtros globais, skeletons e estado vazio). Depois seguimos onda a onda para não empilhar mudanças gigantes sem você validar cada etapa.

Se preferir outra ordem (ex.: começar por Financeiro ou pelo CRM Pipeline com migration), me diz que eu reordeno.