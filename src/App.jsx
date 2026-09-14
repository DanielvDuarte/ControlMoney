import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Plus, Check, Trash2, ChevronLeft, ChevronRight, X, Pencil, AlertCircle, Wallet, LogOut } from "lucide-react";
import { supabase } from "./lib/supabase";

// ---------- helpers ----------
const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const monthKey = (y, m) => `${y}-${String(m + 1).padStart(2, "0")}`;
const parseKey = (k) => { const [y, m] = k.split("-").map(Number); return { y, m: m - 1 }; };
const brl = (n) => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const addMeses = (key, n) => { const { y, m } = parseKey(key); const idx = y * 12 + m + n; return monthKey(Math.floor(idx / 12), idx % 12); };
const CORES_CAT = ["#22c55e","#38bdf8","#f472b6","#fbbf24","#a78bfa","#fb7185","#34d399","#60a5fa","#facc15","#c084fc"];

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
    const [g, r] = await Promise.all([
      supabase.from("gastos").select("*").eq("mes", mes).order("created_at"),
      supabase.from("meses").select("renda").eq("mes", mes).maybeSingle(),
    ]);
    setGastos(g.data || []);
    setRenda(Number(r.data?.renda || 0));
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
            <button style={{ ...S.btnNav, marginLeft: 6 }} onClick={() => supabase.auth.signOut()} aria-label="Sair"><LogOut size={16} /></button>
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
              return (
                <div key={cat} style={S.grupo}>
                  <div style={S.grupoHead}>
                    <span style={{ ...S.dot, background: cor }} />
                    <span style={S.grupoNome}>{cat}</span>
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
        onChange={e => setV(e.target.value)} onKeyDown={e => e.key === "Enter" && onSalvar(v)} placeholder="12000" />
      <div style={S.modalAcoes}>
        <button style={S.btnSec} onClick={onFechar}>Cancelar</button>
        <button style={S.btnPri} onClick={() => onSalvar(v)}>Salvar</button>
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
  grupoTotal: { fontSize: 13, color: "#94a3b8", fontWeight: 600, fontVariantNumeric: "tabular-nums" },

  item: { display: "flex", alignItems: "center", gap: 11, padding: "11px 13px", borderRadius: 12, border: "1px solid", transition: "background .15s" },
  check: { width: 24, height: 24, borderRadius: 7, border: "2px solid", cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0, transition: "all .15s" },
  itemNome: { fontWeight: 600, fontSize: 14.5, display: "flex", alignItems: "center", gap: 7, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  parcela: { fontSize: 11, fontWeight: 700, color: "#0a0e16", background: "#94a3b8", padding: "1px 6px", borderRadius: 6, flexShrink: 0 },
  itemSub: { fontSize: 12, color: "#64748b", marginTop: 1 },
  itemValor: { fontWeight: 700, fontSize: 14.5, fontVariantNumeric: "tabular-nums", flexShrink: 0 },
  iconBtn: { width: 28, height: 28, borderRadius: 7, border: "none", background: "transparent", color: "#475569", cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0 },

  fab: { position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", display: "inline-flex", alignItems: "center", gap: 7, background: "#22c55e", color: "#04120a", fontWeight: 700, fontSize: 15, border: "none", borderRadius: 99, padding: "13px 22px", cursor: "pointer", boxShadow: "0 8px 24px rgba(34,197,94,0.35)" },

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
