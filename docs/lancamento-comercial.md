# Publicação comercial do Advora

## Recuperação e Auth

O Worker deve servir a aplicação Nitro em todo o domínio, inclusive pedidos diretos a /auth/recuperar. No Cloudflare, confirme o Worker associado a advora.life em Domains & Routes, o commit da versão ativa em Deployments e o ambiente Production em Builds. Em um projeto publicado pelo Lovable, confira o repositório conectado e publique a versão que contém o hotfix 98057b4 ou um descendente. Um build verde no GitHub não confirma essa publicação.

No Supabase Auth, configure Site URL como https://advora.life e autorize https://advora.life/auth/callback e https://advora.life/auth/recuperar. Habilite confirmação de e-mail e configure SMTP com remetente verificado. Teste com uma caixa controlada: confirme a conta, crie um único escritório, confira a data final do teste, saia, solicite recuperação e abra o link em janela privada. Redefina a senha, saia e valide o login com a nova senha. Preserve o acesso do proprietário à cobrança após a expiração.

## Banco e retorno de versão

O banco já tinha as funções administrativas e de cobrança da release. A mudança incremental de sete dias substitui somente create_trial_subscription(). A cópia da definição anterior está em supabase/rollback/20261124030000_restore_trial_72h.sql. Para reverter essa mudança, execute esse SQL em transação pelo editor administrativo do projeto correto. Confirme a definição com pg_get_functiondef e confira o gatilho em pg_trigger. A reversão vale para os próximos escritórios. Não altere os vencimentos de escritórios existentes.

Para futuras mudanças de dados, registre no painel Supabase Database → Backups o ponto recuperável e valide a restauração em projeto isolado antes da execução. Guarde backups fora do Git com acesso restrito. Para retornar o frontend, selecione o deployment anterior no Worker. Preserve o webhook compatível durante qualquer reversão que envolva assinaturas em processamento.

## Pagamento e integrações

Use os secrets do Worker e configure ofertas e eventos conforme docs/kirvano-setup.md. Primeiro valide em staging com ofertas de teste disponibilizadas pela Kirvano. Configure KIRVANO_CHECKOUT_ENABLED=true apenas em staging durante os testes. Confira nos logs da Kirvano a entrega HTTP 200, na assinatura o escritório e o plano corretos e no ledger o processamento único de cada evento. Valide aprovação, renovação, cancelamento e reembolso. Se a conta não tiver ambiente de teste, obtenha um evento de homologação do fornecedor. Só habilite o checkout em produção após essa confirmação.

Em Integrações, use número e destinatário de teste do escritório para validar envio e resposta pelo mesmo provedor de WhatsApp. Para WAHA, consulte docs/waha-setup.md. No DataJud, consulte um CNJ público conhecido e confira o tribunal e a data da movimentação. Para IA, configure OPENAI_API_KEY como secret e OPENAI_MODEL no Worker de staging, use uma pergunta sem dados de clientes e confirme resposta e consumo na conta do provedor. Registre data, provedor e resultado de cada teste antes de divulgar o recurso.
