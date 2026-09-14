import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Plus, Check, Trash2, ChevronLeft, ChevronRight, X, Pencil, AlertCircle, Wallet, LogOut, Tags, Sparkles, Copy, ExternalLink } from "lucide-react";
import { supabase } from "./lib/supabase";

// ---------- helpers ----------
const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const monthKey = (y, m) => `${y}-${String(m + 1).padStart(2, "0")}`;
const parseKey = (k) => { const [y, m] = k.split("-").map(Number); return { y, m: m - 1 }; };
const brl = (n) => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
// Uma casa decimal só abaixo de 10%, para não poluir a linha da categoria.
const pctTxt = (p) => `${p >= 10 ? Math.round(p) : p.toFixed(1).replace(".", ",")}%`;
const addMeses = (key, n) => { const { y, m } = parseKey(key); const idx = y * 12 + m + n; return monthKey(Math.floor(idx / 12), idx % 12); };
const CORES_CAT = ["#22c55e","#38bdf8","#f472b6","#fbbf24","#a78bfa","#fb7185","#34d399","#60a5fa","#facc15","#c084fc"];
const soma = (lista) => lista.reduce((s, g) => s + Number(g.valor || 0), 0);

// ------------------------------------------------------------
//  Monta o texto que a pessoa cola no Claude. É aqui que mora o
//  valor da funcionalidade: quanto melhor o resumo, melhor a análise.
// ------------------------------------------------------------
function montarResumo({ mesKey, renda, gastos, catPorId, historico }) {
  const { y, m } = parseKey(mesKey);
  const total = soma(gastos);
  const daRenda = (v) => (renda > 0 ? ` (${pctTxt((v / renda) * 100)} da renda)` : "");
  const L = [];

  L.push("Estes são os gastos da minha casa, exportados do meu app de controle financeiro. Valores em reais (R$).");
  L.push("");
  L.push("Analise e me responda de forma direta e prática:");
  L.push("1. Para onde meu dinheiro está indo — as categorias que mais pesam sobre a renda.");
  L.push("2. O que mudou em relação aos meses anteriores: o que subiu, o que caiu e por quanto.");
  L.push("3. Onde dá para cortar ou renegociar, com valores concretos.");
  L.push("4. Os compromissos que já assumi (parcelas em aberto) e quando eles terminam.");
  L.push("5. As três ações que fariam mais diferença no próximo mês.");
  L.push("");
  L.push("Não recomende investimentos nem produtos financeiros específicos — foque no que dá para fazer com os gastos abaixo.");
  L.push("");
  L.push(`## ${MESES[m]} de ${y} (mês atual)`);
  L.push(`Renda: ${brl(renda)}`);
  L.push(`Total de gastos: ${brl(total)}${daRenda(total)}`);
  L.push(`${renda - total >= 0 ? "Sobra" : "Falta"}: ${brl(Math.abs(renda - total))}`);
  L.push(`Já pago: ${brl(soma(gastos.filter(g => g.pago)))} · Em aberto: ${brl(soma(gastos.filter(g => !g.pago)))}`);
  L.push("");

  const grupos = {};
  gastos.forEach(g => {
    const nome = catPorId[g.categoria_id]?.nome || "Sem categoria";
    (grupos[nome] ||= []).push(g);
  });
  Object.entries(grupos).sort((a, b) => soma(b[1]) - soma(a[1])).forEach(([nome, itens]) => {
    const sub = soma(itens);
    L.push(`### ${nome} — ${brl(sub)}${daRenda(sub)}`);
    itens.forEach(g => {
      const partes = [g.nome];
      if (g.subcategoria) partes.push(`(${g.subcategoria})`);
      if (g.total_parcelas > 1) partes.push(`— parcela ${g.parcela_atual}/${g.total_parcelas}`);
      L.push(`- ${partes.join(" ")}: ${brl(g.valor)}${g.pago ? " [pago]" : " [em aberto]"}`);
    });
    L.push("");
  });

  const emAberto = gastos.filter(g => g.total_parcelas > 1 && g.parcela_atual < g.total_parcelas);
  if (emAberto.length) {
    L.push("## Parcelas que seguem nos próximos meses");
    emAberto.forEach(g => {
      const restantes = g.total_parcelas - g.parcela_atual;
      const fim = parseKey(addMeses(mesKey, restantes));
      L.push(`- ${g.nome}: ${brl(g.valor)}/mês, faltam ${restantes} (${brl(Number(g.valor) * restantes)} no total), última em ${MESES[fim.m]}/${fim.y}`);
    });
    L.push("");
  }

  if (historico.length) {
    L.push("## Meses anteriores");
    historico.forEach(h => {
      const p = parseKey(h.mes);
      L.push(`- ${MESES[p.m]}/${p.y}: renda ${brl(h.renda)}, gastos ${brl(h.total)}`);
    });
    L.push("");
  }

  return L.join("\n").trim();
}

// ============================================================
//  Raiz: decide entre login e app conforme a sessão
// ============================================================
export default function App() {
  const [sessao, setSessao] = useState(undefined); // undefined = carregando

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSessao(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSessao(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (sessao === undefined) return <Tela><div style={S.centro}>Carregando…</div></Tela>;
  if (!sessao) return <Login />;
  return <Painel usuario={sessao.user} />;
}

// ============================================================
//  Login / cadastro
// ============================================================
function Login() {
  const [modo, setModo] = useState("entrar"); // entrar | cadastrar
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [msg, setMsg] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);

  const entrarComGoogle = async () => {
    setErro(""); setMsg(""); setCarregando(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      // Volta para a própria página depois do consentimento no Google.
      // BASE_URL importa no GitHub Pages, onde o app não fica na raiz do domínio.
      options: { redirectTo: window.location.origin + import.meta.env.BASE_URL },
    });
    // Em caso de sucesso o navegador já saiu daqui; só chegamos na linha
    // abaixo se o redirecionamento falhou.
    if (error) { setErro(traduzErro(error.message)); setCarregando(false); }
  };

  const enviar = async () => {
    setErro(""); setMsg(""); setCarregando(true);
    try {
      if (modo === "entrar") {
        const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({ email, password: senha });
        if (error) throw error;
        setMsg("Conta criada. Se a confirmação por e-mail estiver ativa, confirme pelo link enviado e depois entre.");
      }
    } catch (e) {
      setErro(traduzErro(e.message));
    } finally {
      setCarregando(false);
    }
  };

  return (
    <Tela>
      <div style={S.loginWrap}>
        <div style={S.marca}><Wallet size={22} strokeWidth={2.5} color="#22c55e" /><span>Contas do mês</span></div>
        <p style={S.loginSub}>Suas contas em qualquer aparelho, sincronizadas.</p>

        <button style={{ ...S.btnGoogle, opacity: carregando ? 0.6 : 1 }} onClick={entrarComGoogle} disabled={carregando}>
          <GoogleIcon /> Entrar com Google
        </button>

        <div style={S.divisor}><span style={S.divisorLinha} /> ou <span style={S.divisorLinha} /></div>

        <label style={S.label}>E-mail</label>
        <input style={S.input} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="voce@exemplo.com" autoComplete="email" />

        <label style={S.label}>Senha</label>
        <input style={S.input} type="password" value={senha} onChange={e => setSenha(e.target.value)}
          onKeyDown={e => e.key === "Enter" && enviar()} placeholder="••••••••" autoComplete={modo === "entrar" ? "current-password" : "new-password"} />

        {erro && <div style={S.erro}><AlertCircle size={14} /> {erro}</div>}
        {msg && <div style={{ ...S.erro, color: "#4ade80" }}><Check size={14} /> {msg}</div>}

        <button style={{ ...S.btnPri, width: "100%", marginTop: 18, opacity: carregando ? 0.6 : 1 }} onClick={enviar} disabled={carregando}>
          {carregando ? "…" : modo === "entrar" ? "Entrar" : "Criar conta"}
        </button>

        <button style={S.linkBtn} onClick={() => { setModo(m => m === "entrar" ? "cadastrar" : "entrar"); setErro(""); setMsg(""); }}>
          {modo === "entrar" ? "Não tem conta? Criar uma" : "Já tem conta? Entrar"}
        </button>
      </div>
    </Tela>
  );
}

// Logo do Google em SVG — evita depender de imagem externa.
function GoogleIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.2-.4-4.7H24v8.9h11.8c-.5 2.7-2 5.1-4.4 6.6v5.5h7.1c4.1-3.8 6.6-9.5 6.6-16.3z" />
      <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.6-3.8-12.3-9H4.3v5.7C7.9 41.2 15.4 46 24 46z" />
      <path fill="#FBBC05" d="M11.7 28.3c-.4-1.3-.7-2.7-.7-4.3s.3-3 .7-4.3v-5.7H4.3A22 22 0 0 0 2 24c0 3.6.9 6.9 2.3 9.9l7.4-5.6z" />
      <path fill="#EA4335" d="M24 10.6c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.1 29.9 2 24 2 15.4 2 7.9 6.8 4.3 13.9l7.4 5.7c1.7-5.2 6.6-9 12.3-9z" />
    </svg>
  );
}

function traduzErro(m = "") {
  if (/invalid login credentials/i.test(m)) return "E-mail ou senha incorretos.";
  if (/already registered/i.test(m)) return "Este e-mail já tem conta. Tente entrar.";
  if (/password should be at least/i.test(m)) return "A senha precisa ter pelo menos 6 caracteres.";
  if (/provider is not enabled/i.test(m)) return "O login com Google ainda não está ativado no Supabase.";
  return m;
}

// ============================================================
//  Painel principal
// ============================================================
function Painel({ usuario }) {
  const hoje = new Date();
  const [mesAtual, setMesAtual] = useState(monthKey(hoje.getFullYear(), hoje.getMonth()));
  const [categorias, setCategorias] = useState([]);      // [{id, nome, cor, subs}]
  const [renda, setRenda] = useState(0);
  const [gastos, setGastos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [modalGasto, setModalGasto] = useState(false);
  const [editando, setEditando] = useState(null);
  const [editRenda, setEditRenda] = useState(false);
  const [modalCategorias, setModalCategorias] = useState(false);
  const [modalAnalise, setModalAnalise] = useState(false);
  const [analise, setAnalise] = useState(null);   // texto colado de volta do Claude
  const [resumo, setResumo] = useState("");       // texto a levar para o Claude
  const { y, m } = parseKey(mesAtual);

  const catPorId = useMemo(() => Object.fromEntries(categorias.map(c => [c.id, c])), [categorias]);

  // ---------- carregar categorias (uma vez) ----------
  const carregarCategorias = useCallback(async () => {
    const { data } = await supabase.from("categorias").select("*").order("created_at");
    setCategorias(data || []);
  }, []);

  // ---------- carregar dados do mês ----------
  const carregarMes = useCallback(async (mes) => {
    setCarregando(true);
    const [g, r, a] = await Promise.all([
      supabase.from("gastos").select("*").eq("mes", mes).order("created_at"),
      supabase.from("meses").select("renda").eq("mes", mes).maybeSingle(),
      supabase.from("analises").select("texto").eq("mes", mes).maybeSingle(),
    ]);
    setGastos(g.data || []);
    setRenda(Number(r.data?.renda || 0));
    setAnalise(a.data?.texto || null);
    setCarregando(false);
  }, []);

  useEffect(() => { carregarCategorias(); }, [carregarCategorias]);
  useEffect(() => { carregarMes(mesAtual); }, [mesAtual, carregarMes]);

  // ---------- sync em tempo real (outros aparelhos) ----------
  useEffect(() => {
    const canal = supabase
      .channel("mudancas-gastos")
      .on("postgres_changes", { event: "*", schema: "public", table: "gastos", filter: `mes=eq.${mesAtual}` },
        () => carregarMes(mesAtual))
      .subscribe();
    return () => { supabase.removeChannel(canal); };
  }, [mesAtual, carregarMes]);

  // ---------- cálculos ----------
  const totais = useMemo(() => {
    const total = gastos.reduce((s, g) => s + Number(g.valor || 0), 0);
    const pago = gastos.filter(g => g.pago).reduce((s, g) => s + Number(g.valor || 0), 0);
    return { total, pago, pendente: total - pago, saldo: renda - total };
  }, [gastos, renda]);

  const porCategoria = useMemo(() => {
    const grupos = {};
    gastos.forEach(g => {
      const nome = catPorId[g.categoria_id]?.nome || "Sem categoria";
      (grupos[nome] ||= []).push(g);
    });
    return grupos;
  }, [gastos, catPorId]);

  // ---------- ações ----------
  const navegarMes = (dir) => setMesAtual(k => addMeses(k, dir));

  const definirRenda = async (valor) => {
    const v = Number(valor) || 0;
    setRenda(v);
    await supabase.from("meses").upsert({ user_id: usuario.id, mes: mesAtual, renda: v }, { onConflict: "user_id,mes" });
    setEditRenda(false);
  };

  const togglePago = async (g) => {
    setGastos(gs => gs.map(x => x.id === g.id ? { ...x, pago: !x.pago } : x)); // otimista
    await supabase.from("gastos").update({ pago: !g.pago }).eq("id", g.id);
  };

  const removerGasto = async (g) => {
    if (g.grupo_parcela && g.total_parcelas > 1) {
      const futuras = window.confirm(
        `"${g.nome}" é parcelado (${g.parcela_atual}/${g.total_parcelas}).\n\n` +
        `OK = remover esta e as próximas parcelas.\nCancelar = remover só esta.`
      );
      if (futuras) {
        await supabase.from("gastos").delete().eq("grupo_parcela", g.grupo_parcela).gte("mes", mesAtual);
        carregarMes(mesAtual);
        return;
      }
    }
    setGastos(gs => gs.filter(x => x.id !== g.id));
    await supabase.from("gastos").delete().eq("id", g.id);
  };

  const garantirCategoria = async (nome, corSugerida) => {
    const existente = categorias.find(c => c.nome.toLowerCase() === nome.toLowerCase());
    if (existente) return existente;
    const cor = corSugerida || CORES_CAT[categorias.length % CORES_CAT.length];
    const { data } = await supabase.from("categorias")
      .insert({ user_id: usuario.id, nome, cor }).select().single();
    await carregarCategorias();
    return data;
  };

  const registrarSub = async (cat, sub) => {
    if (!sub || cat.subs?.includes(sub)) return;
    const novas = [...(cat.subs || []), sub];
    await supabase.from("categorias").update({ subs: novas }).eq("id", cat.id);
    await carregarCategorias();
  };

  // Apagar categoria: os gastos que a usam não somem — a FK é `on delete set
  // null`, então eles caem no grupo "Sem categoria" com os valores intactos.
  const removerCategoria = async (cat) => {
    const { count } = await supabase.from("gastos")
      .select("id", { count: "exact", head: true }).eq("categoria_id", cat.id);
    const aviso = count
      ? `"${cat.nome}" está em ${count} gasto${count > 1 ? "s" : ""}.\n\n` +
        `Apagando a categoria, esses gastos continuam existindo, mas passam a ` +
        `aparecer como "Sem categoria".\n\nApagar mesmo assim?`
      : `Apagar a categoria "${cat.nome}"?`;
    if (!window.confirm(aviso)) return;
    await supabase.from("categorias").delete().eq("id", cat.id);
    await carregarCategorias();
    carregarMes(mesAtual);
  };

  const removerSub = async (cat, sub) => {
    if (!window.confirm(
      `Remover a subcategoria "${sub}" de ${cat.nome}?\n\n` +
      `Ela some da lista de opções. Gastos já lançados com esse nome não mudam.`
    )) return;
    const novas = (cat.subs || []).filter(s => s !== sub);
    await supabase.from("categorias").update({ subs: novas }).eq("id", cat.id);
    await carregarCategorias();
  };

  const salvarGasto = async (form) => {
    const { nome, valor, categoria, subcategoria, parcelas } = form;
    const cat = await garantirCategoria(categoria);
    if (subcategoria) await registrarSub(cat, subcategoria);

    if (editando) {
      await supabase.from("gastos").update({
        nome, valor: Number(valor), categoria_id: cat.id, subcategoria: subcategoria || "",
      }).eq("id", editando.id);
      fechar(); carregarMes(mesAtual); return;
    }

    const n = Math.max(1, Number(parcelas) || 1);
    const grupo = n > 1 ? crypto.randomUUID() : null;
    const linhas = Array.from({ length: n }, (_, i) => ({
      user_id: usuario.id,
      mes: addMeses(mesAtual, i),
      nome, valor: Number(valor), categoria_id: cat.id, subcategoria: subcategoria || "",
      pago: false, grupo_parcela: grupo,
      parcela_atual: n > 1 ? i + 1 : null,
      total_parcelas: n > 1 ? n : null,
    }));
    await supabase.from("gastos").insert(linhas);
    fechar(); carregarMes(mesAtual);
  };

  // Busca os 5 meses anteriores só para dar contexto de comparação ao Claude.
  const abrirAnalise = async () => {
    const inicio = addMeses(mesAtual, -5);
    const [gs, ms] = await Promise.all([
      supabase.from("gastos").select("mes, valor").gte("mes", inicio).lt("mes", mesAtual),
      supabase.from("meses").select("mes, renda").gte("mes", inicio).lt("mes", mesAtual),
    ]);
    const rendaPorMes = Object.fromEntries((ms.data || []).map(r => [r.mes, Number(r.renda || 0)]));
    const totalPorMes = {};
    (gs.data || []).forEach(g => { totalPorMes[g.mes] = (totalPorMes[g.mes] || 0) + Number(g.valor || 0); });
    const historico = [...new Set([...Object.keys(rendaPorMes), ...Object.keys(totalPorMes)])].sort()
      .map(mes => ({ mes, renda: rendaPorMes[mes] || 0, total: totalPorMes[mes] || 0 }));

    setResumo(montarResumo({ mesKey: mesAtual, renda, gastos, catPorId, historico }));
    setModalAnalise(true);
  };

  const salvarAnalise = async (texto) => {
    const t = texto.trim();
    if (!t) return;
    await supabase.from("analises").upsert({ user_id: usuario.id, mes: mesAtual, texto: t }, { onConflict: "user_id,mes" });
    setAnalise(t);
  };

  const apagarAnalise = async () => {
    if (!window.confirm("Apagar a análise guardada deste mês?")) return;
    await supabase.from("analises").delete().eq("mes", mesAtual);
    setAnalise(null);
  };

  const abrirNovo = () => { setEditando(null); setModalGasto(true); };
  const abrirEdicao = (g) => { setEditando({ ...g, categoriaNome: catPorId[g.categoria_id]?.nome }); setModalGasto(true); };
  const fechar = () => { setModalGasto(false); setEditando(null); };

  const saldoNeg = totais.saldo < 0;

  return (
    <Tela>
      <div style={S.wrap}>
        <header style={S.header}>
          <div style={S.marca}><Wallet size={20} strokeWidth={2.5} color="#22c55e" /><span>Contas do mês</span></div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button style={S.btnNav} onClick={() => navegarMes(-1)} aria-label="Mês anterior"><ChevronLeft size={18} /></button>
            <div style={S.mesLabel}>{MESES[m]} <span style={{ color: "#64748b" }}>{y}</span></div>
            <button style={S.btnNav} onClick={() => navegarMes(1)} aria-label="Próximo mês"><ChevronRight size={18} /></button>
            <button style={{ ...S.btnNav, marginLeft: 6 }} onClick={() => setModalCategorias(true)} aria-label="Categorias"><Tags size={16} /></button>
            <button style={S.btnNav} onClick={() => supabase.auth.signOut()} aria-label="Sair"><LogOut size={16} /></button>
          </div>
        </header>

        <section style={{ ...S.heroSaldo, borderColor: saldoNeg ? "#7f1d1d" : "#14532d" }}>
          <div style={S.heroTopo}>
            <span style={S.heroLabel}>{saldoNeg ? "Faltam" : "Sobra depois de tudo"}</span>
            <button style={S.rendaBtn} onClick={() => setEditRenda(true)}>Renda: {brl(renda)} <Pencil size={12} /></button>
          </div>
          <div style={{ ...S.heroValor, color: saldoNeg ? "#f87171" : "#4ade80" }}>{brl(Math.abs(totais.saldo))}</div>
          <div style={S.barraWrap}>
            <div style={S.barra}><div style={{ ...S.barraFill, width: `${Math.min(100, renda ? (totais.total / renda) * 100 : 0)}%` }} /></div>
            <span style={S.barraTxt}>{brl(totais.total)} de {brl(renda)} comprometidos</span>
          </div>
        </section>

        <section style={S.resumo}>
          <div style={S.resumoCard}><span style={S.resumoLabel}>Total do mês</span><span style={S.resumoVal}>{brl(totais.total)}</span></div>
          <div style={S.resumoCard}><span style={S.resumoLabel}>Já pago</span><span style={{ ...S.resumoVal, color: "#4ade80" }}>{brl(totais.pago)}</span></div>
          <div style={S.resumoCard}><span style={S.resumoLabel}>Falta pagar</span><span style={{ ...S.resumoVal, color: totais.pendente > 0 ? "#fbbf24" : "#4ade80" }}>{brl(totais.pendente)}</span></div>
        </section>

        <button style={S.btnAnalise} onClick={abrirAnalise} disabled={carregando}>
          <Sparkles size={15} strokeWidth={2.5} />
          {analise ? "Ver análise do mês" : "Analisar meus gastos no Claude"}
          {analise && <span style={S.selo}>salva</span>}
        </button>

        <main style={S.lista}>
          {carregando ? (
            <div style={S.vazio}>Carregando {MESES[m]}…</div>
          ) : gastos.length === 0 ? (
            <div style={S.vazio}>
              <p style={{ margin: 0, fontWeight: 600, color: "#e2e8f0" }}>Nenhum gasto em {MESES[m]}.</p>
              <p style={{ margin: "6px 0 0", fontSize: 14 }}>Toque em <b>+ Novo gasto</b> para começar.</p>
            </div>
          ) : (
            Object.entries(porCategoria).map(([cat, itens]) => {
              const cor = categorias.find(c => c.nome === cat)?.cor || "#64748b";
              const subtotal = itens.reduce((s, g) => s + Number(g.valor || 0), 0);
              // Sem renda informada não há do que tirar porcentagem.
              const pct = renda > 0 ? (subtotal / renda) * 100 : null;
              return (
                <div key={cat} style={S.grupo}>
                  <div style={S.grupoHead}>
                    <span style={{ ...S.dot, background: cor }} />
                    <span style={S.grupoNome}>{cat}</span>
                    {pct !== null && <span style={S.grupoPct} title={`${cat} consome ${pctTxt(pct)} da renda do mês`}>{pctTxt(pct)}</span>}
                    <span style={S.grupoTotal}>{brl(subtotal)}</span>
                  </div>
                  {itens.map(g => (
                    <div key={g.id} style={{ ...S.item, background: g.pago ? "rgba(34,197,94,0.14)" : "#161b26", borderColor: g.pago ? "rgba(34,197,94,0.4)" : "#232a38" }}>
                      <button style={{ ...S.check, background: g.pago ? "#22c55e" : "transparent", borderColor: g.pago ? "#22c55e" : "#3a4353" }}
                        onClick={() => togglePago(g)} aria-label={g.pago ? "Marcar como não pago" : "Marcar como pago"}>
                        {g.pago && <Check size={14} strokeWidth={3} color="#0a0e16" />}
                      </button>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={S.itemNome}>{g.nome}{g.total_parcelas > 1 && <span style={S.parcela}>{g.parcela_atual}/{g.total_parcelas}</span>}</div>
                        {g.subcategoria && <div style={S.itemSub}>{g.subcategoria}</div>}
                      </div>
                      <div style={{ ...S.itemValor, color: g.pago ? "#4ade80" : "#e2e8f0" }}>{brl(g.valor)}</div>
                      <button style={S.iconBtn} onClick={() => abrirEdicao(g)} aria-label="Editar"><Pencil size={14} /></button>
                      <button style={S.iconBtn} onClick={() => removerGasto(g)} aria-label="Remover"><Trash2 size={14} /></button>
                    </div>
                  ))}
                </div>
              );
            })
          )}
        </main>
      </div>

      <button style={S.fab} onClick={abrirNovo}><Plus size={20} strokeWidth={2.5} /> Novo gasto</button>

      {modalGasto && <ModalGasto categorias={categorias} editando={editando} onFechar={fechar} onSalvar={salvarGasto} />}
      {editRenda && <ModalRenda valor={renda} onFechar={() => setEditRenda(false)} onSalvar={definirRenda} />}
      {modalCategorias && <ModalCategorias categorias={categorias} onFechar={() => setModalCategorias(false)}
        onRemoverCat={removerCategoria} onRemoverSub={removerSub} />}
      {modalAnalise && <ModalAnalise resumo={resumo} analise={analise} onFechar={() => setModalAnalise(false)}
        onSalvar={salvarAnalise} onApagar={apagarAnalise} />}
    </Tela>
  );
}

// ============================================================
//  Modais
// ============================================================
function ModalRenda({ valor, onFechar, onSalvar }) {
  const [v, setV] = useState(valor || "");
  return (
    <Overlay onFechar={onFechar}>
      <h2 style={S.modalTitulo}>Renda do mês</h2>
      <p style={S.modalAjuda}>É sobre esse valor que o saldo é calculado.</p>
      <label style={S.label}>Valor disponível (R$)</label>
      <input autoFocus type="number" inputMode="decimal" style={S.input} value={v}
        onChange={e => setV(e.target.value)} onKeyDown={e => e.key === "Enter" && onSalvar(v)} placeholder="1000" />
      <div style={S.modalAcoes}>
        <button style={S.btnSec} onClick={onFechar}>Cancelar</button>
        <button style={S.btnPri} onClick={() => onSalvar(v)}>Salvar</button>
      </div>
    </Overlay>
  );
}

function ModalAnalise({ resumo, analise, onFechar, onSalvar, onApagar }) {
  const [copiado, setCopiado] = useState(false);
  const [colando, setColando] = useState(false);
  const [texto, setTexto] = useState("");
  const refResumo = useRef(null);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(resumo);
    } catch {
      // Navegador sem permissão de área de transferência: seleciona o texto
      // para a pessoa copiar na mão (Ctrl+C / toque longo).
      refResumo.current?.select();
      return;
    }
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2200);
  };

  return (
    <Overlay onFechar={onFechar}>
      <h2 style={S.modalTitulo}>Analisar no Claude</h2>
      <p style={S.modalAjuda}>
        Copie o resumo do mês, cole no Claude e traga a resposta de volta para cá.
        Funciona na conta gratuita — nada é enviado por este app.
      </p>

      {analise && !colando ? (
        <>
          <div style={S.analiseBox}>{analise}</div>
          <div style={S.modalAcoes}>
            <button style={S.btnSec} onClick={onApagar}>Apagar</button>
            <button style={S.btnPri} onClick={() => { setTexto(analise); setColando(true); }}>Refazer</button>
          </div>
        </>
      ) : (
        <>
          <div style={S.passo}><span style={S.passoNum}>1</span> Copie o resumo</div>
          <textarea ref={refResumo} style={S.resumoBox} value={resumo} readOnly rows={6} />
          <button style={{ ...S.btnCopiar, background: copiado ? "#166534" : "#1e2534" }} onClick={copiar}>
            {copiado ? <><Check size={15} strokeWidth={3} /> Copiado</> : <><Copy size={15} /> Copiar resumo</>}
          </button>

          <div style={S.passo}><span style={S.passoNum}>2</span> Cole no Claude e peça a análise</div>
          <a style={S.btnClaude} href="https://claude.ai/new" target="_blank" rel="noopener noreferrer">
            <Sparkles size={15} strokeWidth={2.5} /> Abrir o Claude <ExternalLink size={13} />
          </a>

          <div style={S.passo}><span style={S.passoNum}>3</span> Traga a resposta de volta</div>
          <textarea style={S.input} rows={4} value={texto} onChange={e => setTexto(e.target.value)}
            placeholder="Cole aqui a análise que o Claude escreveu…" />

          <div style={S.modalAcoes}>
            <button style={S.btnSec} onClick={onFechar}>Fechar</button>
            <button style={{ ...S.btnPri, opacity: texto.trim() ? 1 : 0.5 }} disabled={!texto.trim()}
              onClick={() => { onSalvar(texto); setColando(false); }}>Guardar no mês</button>
          </div>
        </>
      )}
    </Overlay>
  );
}

function ModalCategorias({ categorias, onFechar, onRemoverCat, onRemoverSub }) {
  return (
    <Overlay onFechar={onFechar}>
      <h2 style={S.modalTitulo}>Categorias</h2>
      <p style={S.modalAjuda}>Apague o que criou por engano ou não usa mais.</p>

      {categorias.length === 0 ? (
        <div style={S.catVazio}>
          Nenhuma categoria ainda. Elas nascem junto com o primeiro gasto que você lançar.
        </div>
      ) : (
        <div style={S.catLista}>
          {categorias.map(c => (
            <div key={c.id} style={S.catLinha}>
              <div style={S.catTopo}>
                <span style={{ ...S.dot, background: c.cor }} />
                <span style={S.catNome}>{c.nome}</span>
                <button style={S.iconBtn} onClick={() => onRemoverCat(c)} aria-label={`Apagar categoria ${c.nome}`}>
                  <Trash2 size={14} />
                </button>
              </div>
              {c.subs?.length > 0 && (
                <div style={S.catChips}>
                  {c.subs.map(s => (
                    <span key={s} style={S.catChip}>
                      {s}
                      <button style={S.catChipX} onClick={() => onRemoverSub(c, s)} aria-label={`Remover subcategoria ${s}`}>
                        <X size={11} strokeWidth={2.5} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={S.modalAcoes}>
        <button style={S.btnSec} onClick={onFechar}>Fechar</button>
      </div>
    </Overlay>
  );
}

function ModalGasto({ categorias, editando, onFechar, onSalvar }) {
  const nomes = categorias.map(c => c.nome);
  const [nome, setNome] = useState(editando?.nome || "");
  const [valor, setValor] = useState(editando?.valor ?? "");
  const [categoria, setCategoria] = useState(editando?.categoriaNome || nomes[0] || "");
  const [criandoCat, setCriandoCat] = useState(false);
  const [novaCat, setNovaCat] = useState("");
  const [subcategoria, setSubcategoria] = useState(editando?.subcategoria || "");
  const [criandoSub, setCriandoSub] = useState(false);
  const [novaSub, setNovaSub] = useState("");
  const [parcelas, setParcelas] = useState(1);
  const [erro, setErro] = useState("");

  const catFinal = criandoCat ? novaCat.trim() : categoria;
  const subs = categorias.find(c => c.nome === categoria)?.subs || [];

  const submeter = () => {
    if (!nome.trim()) return setErro("Dê um nome ao gasto.");
    if (!valor || Number(valor) <= 0) return setErro("Informe um valor maior que zero.");
    if (!catFinal) return setErro("Escolha ou crie uma categoria.");
    onSalvar({ nome: nome.trim(), valor, categoria: catFinal, subcategoria: criandoSub ? novaSub.trim() : subcategoria, parcelas });
  };

  return (
    <Overlay onFechar={onFechar}>
      <h2 style={S.modalTitulo}>{editando ? "Editar gasto" : "Novo gasto"}</h2>

      <label style={S.label}>Nome</label>
      <input autoFocus style={S.input} value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex: Aluguel, Internet, Switch…" />

      <label style={S.label}>Valor {parcelas > 1 && !editando ? "(por parcela)" : ""}</label>
      <input type="number" inputMode="decimal" style={S.input} value={valor} onChange={e => setValor(e.target.value)} placeholder="0,00" />

      <label style={S.label}>Categoria</label>
      {!criandoCat ? (
        <div style={S.linhaSelect}>
          <select style={S.select} value={categoria} onChange={e => { setCategoria(e.target.value); setSubcategoria(""); }}>
            {nomes.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button style={S.btnMini} onClick={() => setCriandoCat(true)}>+ Nova</button>
        </div>
      ) : (
        <div style={S.linhaSelect}>
          <input style={S.input} value={novaCat} onChange={e => setNovaCat(e.target.value)} placeholder="Nome da categoria" autoFocus />
          <button style={S.btnMini} onClick={() => { setCriandoCat(false); setNovaCat(""); }}>Cancelar</button>
        </div>
      )}

      <label style={S.label}>Subcategoria <span style={{ color: "#64748b", fontWeight: 400 }}>(opcional)</span></label>
      {!criandoSub ? (
        <div style={S.linhaSelect}>
          <select style={S.select} value={subcategoria} onChange={e => setSubcategoria(e.target.value)} disabled={criandoCat}>
            <option value="">— nenhuma —</option>
            {subs.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button style={S.btnMini} onClick={() => setCriandoSub(true)} disabled={criandoCat}>+ Nova</button>
        </div>
      ) : (
        <div style={S.linhaSelect}>
          <input style={S.input} value={novaSub} onChange={e => setNovaSub(e.target.value)} placeholder="Nome da subcategoria" autoFocus />
          <button style={S.btnMini} onClick={() => { setCriandoSub(false); setNovaSub(""); }}>Cancelar</button>
        </div>
      )}

      {!editando && (
        <>
          <label style={S.label}>Parcelas</label>
          <div style={S.parcelasRow}>
            <button style={S.stepBtn} onClick={() => setParcelas(p => Math.max(1, p - 1))}>−</button>
            <div style={S.parcelasNum}>{parcelas}x</div>
            <button style={S.stepBtn} onClick={() => setParcelas(p => Math.min(60, p + 1))}>+</button>
            {parcelas > 1 && <span style={S.parcelasInfo}>{brl(Number(valor) || 0)}/mês · lança nos próximos {parcelas} meses</span>}
          </div>
        </>
      )}

      {erro && <div style={S.erro}><AlertCircle size={14} /> {erro}</div>}
      <div style={S.modalAcoes}>
        <button style={S.btnSec} onClick={onFechar}>Cancelar</button>
        <button style={S.btnPri} onClick={submeter}>{editando ? "Salvar" : "Adicionar"}</button>
      </div>
    </Overlay>
  );
}

function Overlay({ children, onFechar }) {
  useEffect(() => {
    const onEsc = (e) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onFechar]);
  return (
    <div style={S.overlay} onClick={onFechar}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        <button style={S.fechar} onClick={onFechar} aria-label="Fechar"><X size={18} /></button>
        {children}
      </div>
    </div>
  );
}

function Tela({ children }) { return <div style={S.tela}>{children}</div>; }

// ---------- estilos ----------
const S = {
  tela: { minHeight: "100vh", background: "#0a0e16", color: "#e2e8f0", fontFamily: "'Inter', system-ui, -apple-system, sans-serif", paddingBottom: 96 },
  centro: { textAlign: "center", paddingTop: 140, color: "#64748b" },
  wrap: { maxWidth: 720, margin: "0 auto", padding: "20px 16px 0" },

  loginWrap: { maxWidth: 380, margin: "0 auto", padding: "80px 20px 0" },
  loginSub: { color: "#64748b", fontSize: 14, margin: "8px 0 28px" },
  btnGoogle: { display: "flex", alignItems: "center", justifyContent: "center", gap: 10, width: "100%", background: "#ffffff", border: "none", borderRadius: 10, padding: "12px", color: "#1f2937", fontSize: 15, fontWeight: 600, cursor: "pointer" },
  divisor: { display: "flex", alignItems: "center", gap: 12, margin: "20px 0 4px", color: "#475569", fontSize: 12 },
  divisorLinha: { flex: 1, height: 1, background: "#232a38" },
  linkBtn: { display: "block", width: "100%", textAlign: "center", background: "transparent", border: "none", color: "#38bdf8", fontSize: 14, marginTop: 16, cursor: "pointer" },

  header: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 },
  marca: { display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 17, letterSpacing: "-0.01em" },
  btnNav: { width: 34, height: 34, borderRadius: 9, border: "1px solid #232a38", background: "#161b26", color: "#cbd5e1", display: "grid", placeItems: "center", cursor: "pointer" },
  mesLabel: { minWidth: 118, textAlign: "center", fontWeight: 600, fontSize: 15 },

  heroSaldo: { border: "1px solid", borderRadius: 18, padding: "20px 22px", background: "linear-gradient(160deg,#111722,#0d1119)", marginBottom: 14 },
  heroTopo: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  heroLabel: { fontSize: 13, color: "#94a3b8", fontWeight: 500 },
  rendaBtn: { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "#94a3b8", background: "transparent", border: "1px solid #232a38", padding: "4px 9px", borderRadius: 8, cursor: "pointer" },
  heroValor: { fontSize: 42, fontWeight: 800, letterSpacing: "-0.03em", margin: "6px 0 14px", fontVariantNumeric: "tabular-nums" },
  barraWrap: { display: "flex", flexDirection: "column", gap: 6 },
  barra: { height: 6, background: "#1c2434", borderRadius: 99, overflow: "hidden" },
  barraFill: { height: "100%", background: "linear-gradient(90deg,#22c55e,#4ade80)", borderRadius: 99, transition: "width .3s ease" },
  barraTxt: { fontSize: 11.5, color: "#64748b" },

  resumo: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 22 },
  resumoCard: { background: "#111722", border: "1px solid #1c2434", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 3 },
  resumoLabel: { fontSize: 11.5, color: "#64748b" },
  resumoVal: { fontSize: 16, fontWeight: 700, fontVariantNumeric: "tabular-nums" },

  lista: { display: "flex", flexDirection: "column", gap: 20 },
  vazio: { textAlign: "center", padding: "48px 20px", color: "#64748b", border: "1px dashed #232a38", borderRadius: 14 },
  grupo: { display: "flex", flexDirection: "column", gap: 7 },
  grupoHead: { display: "flex", alignItems: "center", gap: 8, padding: "0 4px 2px" },
  dot: { width: 9, height: 9, borderRadius: 99, flexShrink: 0 },
  grupoNome: { fontWeight: 700, fontSize: 14, flex: 1, letterSpacing: "-0.01em" },
  grupoPct: { fontSize: 11, fontWeight: 600, color: "#64748b", background: "#141a26", border: "1px solid #232a38", borderRadius: 99, padding: "1px 7px", fontVariantNumeric: "tabular-nums" },
  grupoTotal: { fontSize: 13, color: "#94a3b8", fontWeight: 600, fontVariantNumeric: "tabular-nums" },

  item: { display: "flex", alignItems: "center", gap: 11, padding: "11px 13px", borderRadius: 12, border: "1px solid", transition: "background .15s" },
  check: { width: 24, height: 24, borderRadius: 7, border: "2px solid", cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0, transition: "all .15s" },
  itemNome: { fontWeight: 600, fontSize: 14.5, display: "flex", alignItems: "center", gap: 7, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  parcela: { fontSize: 11, fontWeight: 700, color: "#0a0e16", background: "#94a3b8", padding: "1px 6px", borderRadius: 6, flexShrink: 0 },
  itemSub: { fontSize: 12, color: "#64748b", marginTop: 1 },
  itemValor: { fontWeight: 700, fontSize: 14.5, fontVariantNumeric: "tabular-nums", flexShrink: 0 },
  iconBtn: { width: 28, height: 28, borderRadius: 7, border: "none", background: "transparent", color: "#475569", cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0 },

  fab: { position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", display: "inline-flex", alignItems: "center", gap: 7, background: "#22c55e", color: "#04120a", fontWeight: 700, fontSize: 15, border: "none", borderRadius: 99, padding: "13px 22px", cursor: "pointer", boxShadow: "0 8px 24px rgba(34,197,94,0.35)" },

  btnAnalise: { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", marginBottom: 18, background: "#141a26", border: "1px solid #232a38", borderRadius: 12, padding: "11px", color: "#cbd5e1", fontSize: 14, fontWeight: 600, cursor: "pointer" },
  selo: { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "#4ade80", background: "rgba(34,197,94,0.14)", border: "1px solid rgba(34,197,94,0.35)", borderRadius: 99, padding: "1px 7px" },
  passo: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "#94a3b8", margin: "18px 0 8px" },
  passoNum: { display: "grid", placeItems: "center", width: 19, height: 19, borderRadius: 99, background: "#232a38", color: "#cbd5e1", fontSize: 11, fontWeight: 700, flexShrink: 0 },
  resumoBox: { width: "100%", background: "#0f1420", border: "1px solid #232a38", borderRadius: 10, padding: "10px 12px", color: "#94a3b8", fontSize: 12, lineHeight: 1.5, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", resize: "vertical" },
  btnCopiar: { display: "flex", alignItems: "center", justifyContent: "center", gap: 7, width: "100%", marginTop: 8, border: "1px solid #232a38", borderRadius: 10, padding: "11px", color: "#e2e8f0", fontSize: 14, fontWeight: 600, cursor: "pointer", transition: "background 0.15s" },
  btnClaude: { display: "flex", alignItems: "center", justifyContent: "center", gap: 7, width: "100%", background: "#c96442", border: "none", borderRadius: 10, padding: "11px", color: "#fff", fontSize: 14, fontWeight: 600, textDecoration: "none", cursor: "pointer" },
  analiseBox: { background: "#0f1420", border: "1px solid #232a38", borderRadius: 10, padding: "12px 14px", color: "#cbd5e1", fontSize: 13.5, lineHeight: 1.6, whiteSpace: "pre-wrap", maxHeight: "50vh", overflowY: "auto" },

  catLista: { display: "flex", flexDirection: "column", gap: 8, maxHeight: "50vh", overflowY: "auto", margin: "0 -4px", padding: "0 4px" },
  catLinha: { border: "1px solid #232a38", borderRadius: 11, padding: "10px 8px 10px 12px", background: "#161b26" },
  catTopo: { display: "flex", alignItems: "center", gap: 9 },
  catNome: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: 600 },
  catChips: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 9, paddingLeft: 18 },
  catChip: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "#94a3b8", background: "#0f1420", border: "1px solid #232a38", borderRadius: 99, padding: "3px 4px 3px 10px" },
  catChipX: { display: "grid", placeItems: "center", width: 17, height: 17, borderRadius: 99, border: "none", background: "transparent", color: "#64748b", cursor: "pointer" },
  catVazio: { fontSize: 13, color: "#64748b", border: "1px dashed #232a38", borderRadius: 11, padding: "18px 14px", textAlign: "center" },

  overlay: { position: "fixed", inset: 0, background: "rgba(4,7,12,0.7)", backdropFilter: "blur(4px)", display: "grid", placeItems: "center", padding: 16, zIndex: 50 },
  modal: { position: "relative", width: "100%", maxWidth: 420, maxHeight: "90vh", overflowY: "auto", background: "#0f1420", border: "1px solid #232a38", borderRadius: 18, padding: "24px 22px" },
  fechar: { position: "absolute", top: 14, right: 14, width: 32, height: 32, borderRadius: 8, border: "none", background: "#1a2130", color: "#94a3b8", cursor: "pointer", display: "grid", placeItems: "center" },
  modalTitulo: { margin: "0 0 4px", fontSize: 19, fontWeight: 700, letterSpacing: "-0.02em" },
  modalAjuda: { margin: "0 0 16px", fontSize: 13, color: "#64748b" },

  label: { display: "block", fontSize: 12.5, fontWeight: 600, color: "#94a3b8", margin: "14px 0 6px" },
  input: { width: "100%", boxSizing: "border-box", background: "#161b26", border: "1px solid #232a38", borderRadius: 10, padding: "11px 13px", color: "#e2e8f0", fontSize: 15, outline: "none" },
  select: { flex: 1, background: "#161b26", border: "1px solid #232a38", borderRadius: 10, padding: "11px 13px", color: "#e2e8f0", fontSize: 15, outline: "none", cursor: "pointer" },
  linhaSelect: { display: "flex", gap: 8 },
  btnMini: { flexShrink: 0, background: "#1a2130", border: "1px solid #232a38", borderRadius: 10, padding: "0 14px", color: "#cbd5e1", fontSize: 13, fontWeight: 600, cursor: "pointer" },

  parcelasRow: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  stepBtn: { width: 40, height: 40, borderRadius: 10, border: "1px solid #232a38", background: "#161b26", color: "#e2e8f0", fontSize: 22, cursor: "pointer", lineHeight: 1 },
  parcelasNum: { minWidth: 48, textAlign: "center", fontSize: 18, fontWeight: 700, fontVariantNumeric: "tabular-nums" },
  parcelasInfo: { fontSize: 12, color: "#64748b", flexBasis: "100%" },

  erro: { display: "flex", alignItems: "center", gap: 6, color: "#f87171", fontSize: 13, marginTop: 14 },
  modalAcoes: { display: "flex", gap: 10, marginTop: 22 },
  btnSec: { flex: 1, background: "transparent", border: "1px solid #232a38", borderRadius: 10, padding: "12px", color: "#cbd5e1", fontSize: 15, fontWeight: 600, cursor: "pointer" },
  btnPri: { flex: 1, background: "#22c55e", border: "none", borderRadius: 10, padding: "12px", color: "#04120a", fontSize: 15, fontWeight: 700, cursor: "pointer" },
};
