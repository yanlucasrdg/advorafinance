# Painel administrativo da plataforma

O painel global fica em `/admin` e é separado da administração de equipe do escritório. Apenas usuários com a função global `master_admin` podem abrir as páginas ou executar as RPCs administrativas.

## Ativação

1. Confirme que as migrações anteriores, especialmente `20260805210000_enterprise_p0_security.sql`, já foram aplicadas.
2. Aplique `supabase/migrations/20260903230000_platform_admin.sql` no mesmo projeto Supabase usado pela aplicação publicada.
3. Torne uma conta existente administradora global pelo SQL Editor, substituindo o e-mail:

```sql
insert into public.user_roles (user_id, tenant_id, role)
select p.id, null, 'master_admin'::public.app_role
from public.profiles p
where lower(p.email) = lower('admin@seu-dominio.com')
  and not exists (
    select 1 from public.user_roles ur
    where ur.user_id = p.id and ur.role = 'master_admin'
  );
```

Saia e entre novamente na aplicação e acesse `/admin`. Para revogar:

```sql
delete from public.user_roles
where user_id = (select id from public.profiles where lower(email) = lower('admin@seu-dominio.com'))
  and role = 'master_admin';
```

## Modelo de planos

O painel mostra `Free`, `Starter`, `Pro` e `Enterprise`. Eles reutilizam os registros existentes, respectivamente `trial`, `essential`, `performance` e `business`. A assinatura pertence ao escritório (`tenant`), portanto mudar um usuário muda as permissões comerciais de todos os membros do mesmo workspace.

- `active`: acesso conforme o plano selecionado.
- `suspended`: acesso aos módulos do CRM é bloqueado.
- `expired`: a conta e os dados são preservados, mas as regras e limites efetivos passam a ser os do Free.
- data vazia: acesso sem expiração.

Alterações manuais passam a usar `provider = 'manual'`; a integração Kirvano existente não é removida nem reconfigurada nesta etapa. Cada mudança grava antes/depois em `subscription_admin_audit`.

## Verificação recomendada

1. Usuário comum em `/admin`, `/admin/users` ou URL direta de edição: deve retornar ao dashboard e as RPCs devem responder `PLATFORM_ADMIN_REQUIRED`.
2. `master_admin`: dashboard e listagem devem carregar; busca, filtros e paginação devem funcionar.
3. Alterar plano e validade: recarregar uma sessão do escritório e confirmar liberação/bloqueio dos módulos.
4. Definir `suspended`: confirmar bloqueio do CRM e das operações protegidas no banco.
5. Definir `expired` ou uma data passada: confirmar downgrade efetivo para Free sem exclusão de dados.
6. Consultar `subscription_admin_audit` com a conta administrativa e confirmar o registro da alteração.

Não inclua a chave `service_role` em variáveis públicas ou no bundle do frontend. O painel usa a sessão do usuário e autorização `master_admin` em duas camadas: função de servidor e RPC do Postgres.
