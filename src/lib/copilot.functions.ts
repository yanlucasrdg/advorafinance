import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { enforceRateLimit } from "@/lib/rate-limit";

const Schema = z.object({ prompt: z.string().min(1).max(4000) });

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

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      const fallback = `Copiloto em modo demo (sem chave AI). Resumo: ${summary}`;
      if (tenantId) await supabase.from("ai_messages").insert({ tenant_id: tenantId, user_id: userId, role: "assistant", content: fallback });
      return { reply: fallback };
    }

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: `Você é o Copiloto Jurídico da Advora Legal OS, assistente para advogados brasileiros. Seja direto, prático e cite a legislação aplicável (CPC, CLT, CDC, CC) quando relevante. Contexto do escritório: ${summary}` },
          { role: "user", content: data.prompt },
        ],
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`AI Gateway error ${res.status}: ${txt.slice(0, 200)}`);
    }
    const json = await res.json() as { choices?: { message?: { content?: string } }[] };
    const reply = json.choices?.[0]?.message?.content ?? "Sem resposta.";

    if (tenantId) {
      await supabase.from("ai_messages").insert({ tenant_id: tenantId, user_id: userId, role: "assistant", content: reply });
    }
    return { reply };
  });
