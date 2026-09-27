// ============================================================
//  Agente do ControlMoney — Supabase Edge Function (Deno)
//
//  Por que isto existe do lado do servidor: o app é um site estático no
//  GitHub Pages. Uma chave da Anthropic no front-end fica visível para
//  qualquer pessoa que abrir o inspetor — e quem paga a conta é o dono
//  do projeto. Aqui a chave vive num segredo do Supabase e nunca sai daqui.
//
//  Como publicar (sem CLI e sem Node instalado):
//    1. Painel do Supabase → Edge Functions → Deploy a new function → Via Editor
//    2. Nome: agente
//    3. Cole este arquivo inteiro e publique
//    4. Edge Functions → Secrets → ANTHROPIC_API_KEY = sua chave
//
//  Fase 1: sem cobrança. Só quem estiver em `ia_acesso.liberado` usa, e
//  cada chamada é medida em `ia_uso` — é essa medição que vai definir o
//  preço da assinatura depois.
// ============================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";
import Anthropic from "npm:@anthropic-ai/sdk";

const MODELO = "claude-opus-5";

// US$ por milhão de tokens (platform.claude.com/docs/en/about-claude/pricing).
// Se trocar de modelo, troque esta tabela junto — ela é o que transforma
// a medição em dinheiro.
const PRECO = { entrada: 5, cacheEscrita: 6.25, cacheLeitura: 0.5, saida: 25 };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const brl = (n: number) =>
  Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

const nomeMes = (mes: string) => {
  const [y, m] = mes.split("-").map(Number);
  return `${MESES[m - 1]} de ${y}`;
};

// ------------------------------------------------------------
//  O retrato financeiro que vai junto de toda conversa.
//  Sai daqui, e não do navegador, por dois motivos: o cliente do
//  Supabase já vem preso ao RLS do usuário (ninguém lê o mês de outro),
//  e o texto é montado uma vez só, do mesmo jeito, o que deixa o cache
//  de prompt funcionar entre os turnos da conversa.
// ------------------------------------------------------------
async function retratoFinanceiro(supabase: any, mes: string) {
  const anterior = (n: number) => {
    const [y, m] = mes.split("-").map(Number);
    const i = y * 12 + (m - 1) - n;
    return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
  };
  const inicio = anterior(5);

  const [gastos, meses, entradas, metas, categorias, fixos, historico] = await Promise.all([
    supabase.from("gastos").select("nome, valor, pago, data, subcategoria, categoria_id, observacao, parcela_atual, total_parcelas, fixo_id").eq("mes", mes),
    supabase.from("meses").select("renda").eq("mes", mes).maybeSingle(),
    supabase.from("entradas").select("descricao, valor, data").eq("mes", mes),
    supabase.from("metas").select("categoria_id, valor").eq("mes", mes),
    supabase.from("categorias").select("id, nome"),
    supabase.from("fixos").select("nome, valor, dia, ativo"),
    supabase.from("gastos").select("mes, valor").gte("mes", inicio).lt("mes", mes),
  ]);

  const nomeCat: Record<string, string> = {};
  (categorias.data || []).forEach((c: any) => { nomeCat[c.id] = c.nome; });

  const lista = gastos.data || [];
  const soma = (xs: any[]) => xs.reduce((s, g) => s + Number(g.valor || 0), 0);
  const total = soma(lista);
  const rendaFixa = Number(meses.data?.renda || 0);
  const extras = soma(entradas.data || []);
  const renda = rendaFixa + extras;

  const L: string[] = [];
  L.push(`# Retrato financeiro de ${nomeMes(mes)}`);
  L.push("");
  L.push(`Renda do mês: ${brl(renda)} (fixa ${brl(rendaFixa)}${extras ? `, avulsas ${brl(extras)}` : ""})`);
  L.push(`Total de gastos: ${brl(total)}`);
  L.push(`${renda - total >= 0 ? "Sobra" : "Falta"}: ${brl(Math.abs(renda - total))}`);
  L.push(`Já pago: ${brl(soma(lista.filter((g: any) => g.pago)))} · Em aberto: ${brl(soma(lista.filter((g: any) => !g.pago)))}`);
  L.push("");

  const porCat: Record<string, any[]> = {};
  lista.forEach((g: any) => {
    const nome = nomeCat[g.categoria_id] || "Sem categoria";
    (porCat[nome] ||= []).push(g);
  });

  const metaPorCat: Record<string, number> = {};
  (metas.data || []).forEach((m: any) => { metaPorCat[nomeCat[m.categoria_id]] = Number(m.valor); });

  L.push("## Gastos por categoria");
  Object.entries(porCat)
    .sort((a, b) => soma(b[1]) - soma(a[1]))
    .forEach(([nome, itens]) => {
      const sub = soma(itens);
      const meta = metaPorCat[nome];
      const pct = renda > 0 ? ` — ${((sub / renda) * 100).toFixed(1).replace(".", ",")}% da renda` : "";
      const alvo = meta ? ` — meta ${brl(meta)}, ${sub <= meta ? `sobram ${brl(meta - sub)}` : `passou ${brl(sub - meta)}`}` : "";
      L.push(`### ${nome}: ${brl(sub)}${pct}${alvo}`);
      itens.forEach((g: any) => {
        const partes = [g.data ? String(g.data).slice(8, 10) + "/" + String(g.data).slice(5, 7) : "", g.nome];
        if (g.subcategoria) partes.push(`(${g.subcategoria})`);
        if (g.total_parcelas > 1) partes.push(`parcela ${g.parcela_atual}/${g.total_parcelas}`);
        if (g.fixo_id) partes.push("[conta fixa]");
        L.push(`- ${partes.filter(Boolean).join(" ")}: ${brl(g.valor)}${g.pago ? " [pago]" : " [em aberto]"}`);
        if (g.observacao) L.push(`  obs: ${g.observacao}`);
      });
      L.push("");
    });

  const ativas = (fixos.data || []).filter((f: any) => f.ativo);
  if (ativas.length) {
    L.push("## Contas fixas ativas");
    ativas.forEach((f: any) => L.push(`- ${f.nome}, dia ${f.dia}${f.valor ? `: ${brl(f.valor)}/mês` : " (valor variável)"}`));
    L.push(`Soma das que têm valor: ${brl(soma(ativas.filter((f: any) => f.valor)))}/mês`);
    L.push("");
  }

  const parceladas = lista.filter((g: any) => g.total_parcelas > 1 && g.parcela_atual < g.total_parcelas);
  if (parceladas.length) {
    L.push("## Parcelas que seguem nos próximos meses");
    parceladas.forEach((g: any) => {
      const faltam = g.total_parcelas - g.parcela_atual;
      L.push(`- ${g.nome}: ${brl(g.valor)}/mês, faltam ${faltam} (${brl(Number(g.valor) * faltam)} no total)`);
    });
    L.push("");
  }

  const porMes: Record<string, number> = {};
  (historico.data || []).forEach((g: any) => { porMes[g.mes] = (porMes[g.mes] || 0) + Number(g.valor || 0); });
  const meses5 = Object.keys(porMes).sort();
  if (meses5.length) {
    L.push("## Meses anteriores");
    meses5.forEach(m => L.push(`- ${nomeMes(m)}: ${brl(porMes[m])} em gastos`));
    L.push("");
  }

  return L.join("\n").trim();
}

// ------------------------------------------------------------
//  As instruções do agente. Este bloco é fixo: é o primeiro do
//  prompt e o que mais se repete, então é ele que o cache aproveita.
// ------------------------------------------------------------
const NIVEIS: Record<string, string> = {
  iniciante:
    "Esta pessoa está começando. Explique como explicaria para alguém que nunca investiu: sem jargão, " +
    "e quando um termo for inevitável (CDI, liquidez, Tesouro Selic), explique em uma linha, com um exemplo em reais. " +
    "Prefira um caminho simples e seguro a um ótimo caminho complicado.",
  intermediario:
    "Esta pessoa já entende o básico. Pode usar termos comuns do mercado sem explicar cada um, " +
    "mas continue mostrando a conta por trás das recomendações.",
  experiente:
    "Esta pessoa já investe. Seja direto e técnico, compare alternativas por risco, liquidez e tributação, " +
    "e não gaste linhas explicando o que ela já sabe.",
};

const INSTRUCOES = `
Você é o assistente financeiro do ControlMoney, um app de controle de gastos domésticos.
Você conversa com a pessoa dona destes dados, em português do Brasil, sobre o dinheiro dela.

O que você faz:
- Explica para onde o dinheiro está indo e o que mudou em relação aos meses anteriores.
- Aponta onde dá para cortar ou renegociar, sempre com valores concretos tirados dos dados.
- Ajuda a planejar objetivos (uma viagem, uma compra, uma reserva): calcula quanto precisa
  separar por mês, em quanto tempo chega, e de onde esse dinheiro pode sair sem apertar o mês.
- Explica, de forma educativa, os caminhos para fazer esse dinheiro render até o objetivo.

Regras que não se quebram:
- Use SÓ os números do retrato financeiro abaixo. Nunca invente lançamento, valor ou data.
  Se faltar informação para responder, diga o que falta e peça.
- Não recomende produto financeiro específico (nome de banco, corretora, fundo, ação ou cripto),
  não prometa rentabilidade e não diga "invista em X". Explique os TIPOS de aplicação, como cada
  um funciona, o que se ganha e o que se arrisca, e deixe a escolha com a pessoa.
- Não é consultoria de investimentos nem substitui um profissional. Diga isso quando o assunto
  for investir, uma vez, sem repetir a cada resposta.
- Dinheiro é assunto sensível. Nada de julgamento, sermão ou tom de cobrança: a pessoa já sabe
  onde errou, ela quer saber o que fazer agora.

Como responder:
- Vá direto ao ponto. Responda em poucos parágrafos curtos; listas só quando forem mesmo uma lista.
- Valores sempre em reais, no formato R$ 1.234,56.
- Quando fizer uma conta, mostre a conta. "Dá para juntar R$ 4.800 até dezembro guardando R$ 600
  por mês" vale mais que "dá para juntar se você se organizar".
- Termine com o próximo passo concreto quando houver um, não com uma pergunta genérica.
`.trim();

// ------------------------------------------------------------
//  Handler
// ------------------------------------------------------------
export default {
  fetch: withSupabase({ auth: "user" }, async (req: Request, ctx: any) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return json({ erro: "use POST" }, 405);

    const chave = Deno.env.get("ANTHROPIC_API_KEY");
    if (!chave) return json({ erro: "ANTHROPIC_API_KEY não está configurada nos segredos da função." }, 500);

    const { supabase, userClaims } = ctx;
    const userId = userClaims.sub ?? userClaims.id;

    let corpo: any;
    try { corpo = await req.json(); } catch { return json({ erro: "corpo inválido" }, 400); }
    const mensagem = String(corpo?.mensagem || "").trim();
    const mes = String(corpo?.mes || "").match(/^\d{4}-\d{2}$/) ? corpo.mes : null;
    if (!mensagem) return json({ erro: "mensagem vazia" }, 400);
    if (!mes) return json({ erro: "mês inválido" }, 400);
    if (mensagem.length > 4000) return json({ erro: "mensagem longa demais" }, 400);

    // Porta 1: o agente está aberto para todo mundo enquanto o grupo é pequeno.
    // `ia_acesso` virou lista de bloqueio: só barra quem tiver uma linha com
    // liberado = false. Quem não tem linha, passa. O consumo de cada um fica
    // registrado em `ia_uso`, que é como se vê quem gastou o quê.
    const { data: acesso } = await supabase.from("ia_acesso").select("liberado").maybeSingle();
    if (acesso && acesso.liberado === false) {
      return json({ erro: "acesso_negado", detalhe: "O agente está indisponível para esta conta." }, 403);
    }

    // Porta 2: a pessoa aceitou mandar os dados para fora?
    const { data: perfil } = await supabase.from("ia_perfil").select("consentiu_em, nivel").maybeSingle();
    if (!perfil?.consentiu_em) {
      return json({ erro: "sem_consentimento", detalhe: "Aceite o aviso de privacidade antes da primeira conversa." }, 428);
    }
    const nivel = NIVEIS[perfil.nivel] ? perfil.nivel : "iniciante";

    // Conversa: continua a que veio, ou abre uma nova.
    let conversaId: string | null = corpo?.conversaId || null;
    if (conversaId) {
      const { data } = await supabase.from("ia_conversas").select("id").eq("id", conversaId).maybeSingle();
      if (!data) conversaId = null;
    }
    if (!conversaId) {
      const { data, error } = await supabase.from("ia_conversas")
        .insert({ user_id: userId, titulo: mensagem.slice(0, 60), mes })
        .select("id").single();
      if (error) return json({ erro: "não consegui abrir a conversa: " + error.message }, 500);
      conversaId = data.id;
    }

    const [{ data: anteriores }, retrato] = await Promise.all([
      supabase.from("ia_mensagens").select("papel, texto")
        .eq("conversa_id", conversaId).order("created_at").limit(40),
      retratoFinanceiro(supabase, mes),
    ]);

    const mensagens = [
      ...(anteriores || []).map((m: any) => ({ role: m.papel, content: m.texto })),
      { role: "user" as const, content: mensagem },
    ];

    // Chave criada no nível da organização não diz sozinha em qual workspace
    // a chamada é cobrada, e a API recusa com "not scoped to a workspace".
    // Duas saídas: criar a chave dentro de um workspace, ou informar o id
    // aqui. O segredo é opcional — quem já tem chave de workspace não precisa.
    const workspace = Deno.env.get("ANTHROPIC_WORKSPACE_ID");
    const anthropic = new Anthropic({
      apiKey: chave,
      ...(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {}),
    });

    let resposta: any;
    try {
      resposta = await anthropic.beta.messages.create({
        model: MODELO,
        max_tokens: 8000,
        // Se a Claude recusar por política, a própria API refaz o pedido
        // num modelo de retaguarda em vez de devolver uma tela vazia.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: [
          // Dois blocos, ambos em cache: as instruções nunca mudam, e o
          // retrato só muda quando os dados do mês mudam. Do segundo turno
          // em diante essa parte custa um décimo.
          { type: "text", text: INSTRUCOES, cache_control: { type: "ephemeral" } },
          { type: "text", text: `${NIVEIS[nivel]}\n\n${retrato}`, cache_control: { type: "ephemeral" } },
        ],
        messages: mensagens,
      });
    } catch (e: any) {
      const status = e?.status ?? 500;
      const bruto = e?.message || "erro desconhecido";
      const detalhe = status === 429
        ? "A API está com limite de uso atingido. Tente de novo em alguns instantes."
        : status === 401
          ? "A chave da API foi recusada. Confira o segredo ANTHROPIC_API_KEY."
          : /not scoped to a workspace/i.test(bruto)
            ? "A chave é da organização, não de um workspace. Crie uma chave dentro de um workspace, " +
              "ou adicione o segredo ANTHROPIC_WORKSPACE_ID com o id do workspace."
            : /credit|balance|billing/i.test(bruto)
              ? "A conta da Anthropic está sem créditos. Adicione saldo em platform.claude.com → Billing."
              : bruto;
      return json({ erro: "falha_na_api", detalhe }, status >= 400 && status < 600 ? status : 500);
    }

    if (resposta.stop_reason === "refusal") {
      return json({ erro: "recusado", detalhe: "Não consegui responder a esta pergunta. Tente reformular." }, 422);
    }

    const texto = (resposta.content || [])
      .filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();
    if (!texto) return json({ erro: "resposta vazia" }, 502);

    // Medição: é isto que responde "quanto custa" na hora de precificar.
    const u = resposta.usage || {};
    const entrada = u.input_tokens || 0;
    const saida = u.output_tokens || 0;
    const cacheEscrita = u.cache_creation_input_tokens || 0;
    const cacheLeitura = u.cache_read_input_tokens || 0;
    const custo =
      (entrada * PRECO.entrada + saida * PRECO.saida +
       cacheEscrita * PRECO.cacheEscrita + cacheLeitura * PRECO.cacheLeitura) / 1_000_000;

    await supabase.from("ia_mensagens").insert([
      { user_id: userId, conversa_id: conversaId, papel: "user", texto: mensagem },
      { user_id: userId, conversa_id: conversaId, papel: "assistant", texto },
    ]);
    await supabase.from("ia_conversas").update({ atualizada_em: new Date().toISOString() }).eq("id", conversaId);
    await supabase.from("ia_uso").insert({
      user_id: userId, conversa_id: conversaId, modelo: MODELO,
      entrada, saida, cache_escrita: cacheEscrita, cache_leitura: cacheLeitura,
      custo_usd: Number(custo.toFixed(6)),
    });

    return json({
      conversaId,
      resposta: texto,
      uso: { entrada, saida, cacheEscrita, cacheLeitura, custoUsd: Number(custo.toFixed(6)) },
    });
  }),
};
