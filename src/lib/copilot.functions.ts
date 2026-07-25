import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getServerEnv } from "@/integrations/supabase/runtime-env.server";

const Schema = z.object({ prompt: z.string().min(1).max(4000) });

export const clearCopilotHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .maybeSingle();
    if (profileError || !profile?.tenant_id) throw new Error("Não foi possível identificar o escritório atual.");

    // A exclusão usa a credencial de servidor depois de confirmar a sessão e
    // o tenant do usuário. Assim, uma política RLS sem DELETE não faz a tela
    // aparentar que limpou algo que continuará salvo no banco.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("ai_messages")
      .delete()
      .eq("tenant_id", profile.tenant_id);
    if (error) throw new Error("Não foi possível limpar o histórico agora.");
    return { cleared: true };
  });

export const askCopilot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => Schema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await enforceRateLimit(supabase, "copilot_prompt");

    // contexto do tenant: pega tenant_id e amostras pequenas
    const { data: profile } = await supabase.from("profiles").select("tenant_id, full_name").eq("id", userId).maybeSingle();
    const tenantId = profile?.tenant_id;

    let summary = "Sem dados ainda no escritório.";
    if (tenantId) {
      const [{ count: clientsCount }, { count: casesCount }, { data: deadlines }] = await Promise.all([
        supabase.from("clients").select("id", { count: "exact", head: true }),
        supabase.from("cases").select("id", { count: "exact", head: true }),
        supabase.from("deadlines").select("title, due_at, done").eq("done", false).order("due_at", { ascending: true }).limit(5),
      ]);
      summary = `Escritório possui ${clientsCount ?? 0} clientes e ${casesCount ?? 0} processos. Próximos prazos: ${
        (deadlines ?? []).map(d => `${d.title} (${new Date(d.due_at).toLocaleDateString("pt-BR")})`).join("; ") || "nenhum"
      }.`;
    }

    // grava pergunta
    if (tenantId) {
      await supabase.from("ai_messages").insert({ tenant_id: tenantId, user_id: userId, role: "user", content: data.prompt });
    }

    const apiKey = getServerEnv("OPENAI_API_KEY");
    if (!apiKey) {
      const fallback = `Copiloto em modo demo (sem chave AI). Resumo: ${summary}`;
      if (tenantId) await supabase.from("ai_messages").insert({ tenant_id: tenantId, user_id: userId, role: "assistant", content: fallback });
      return { reply: fallback };
    }

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: getServerEnv("OPENAI_MODEL") ?? "gpt-5-mini",
        messages: [
          { role: "system", content: `Você é o Copiloto Jurídico da Advora Legal OS, assistente para advogados brasileiros. Seja direto, prático e cite a legislação aplicável (CPC, CLT, CDC, CC) quando relevante. Contexto do escritório: ${summary}` },
          { role: "user", content: data.prompt },
        ],
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`OpenAI API error ${res.status}: ${txt.slice(0, 200)}`);
    }
    const json = await res.json() as { choices?: { message?: { content?: string } }[] };
    const reply = json.choices?.[0]?.message?.content ?? "Sem resposta.";

    if (tenantId) {
      await supabase.from("ai_messages").insert({ tenant_id: tenantId, user_id: userId, role: "assistant", content: reply });
    }
    return { reply };
  });
