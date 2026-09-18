import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Plus, Check, Trash2, ChevronLeft, ChevronRight, X, Pencil, AlertCircle, LogOut, Tags, Sparkles, Copy, ExternalLink, Upload, Download, Share, Sun, Moon, CloudOff, RefreshCw, Repeat, Pause, Play, Printer, TrendingUp, Undo2, RotateCcw } from "lucide-react";
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

// Data de hoje montada a partir do relógio local. `toISOString()` devolveria
// UTC e, depois das 21h no Brasil, já estaria no dia seguinte.
const hojeISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const ultimoDia = (mesKey) => { const { y, m } = parseKey(mesKey); return new Date(y, m + 1, 0).getDate(); };
// Mesmo dia noutro mês, sem estourar: dia 31 vira 30 em novembro, 28 em fevereiro.
const diaEm = (mesKey, dia) => `${mesKey}-${String(Math.min(dia, ultimoDia(mesKey))).padStart(2, "0")}`;
const diaDe = (data) => Number(String(data).slice(8, 10)) || 1;
const ddmm = (data) => `${String(data).slice(8, 10)}/${String(data).slice(5, 7)}`;
const soma = (lista) => lista.reduce((s, g) => s + Number(g.valor || 0), 0);

// Chave para reconhecer uma descrição já classificada antes ("PAG*ASSAI 1234"
// e "PAG*ASSAI 9876" viram a mesma coisa): sem acento, sem número, sem símbolo.
const chaveDesc = (s = "") => s
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();

// ------------------------------------------------------------
//  Lixeira
//  Apagar aqui é em dois tempos: a linha inteira é copiada para `lixeira` e
//  só então sai da tabela de origem. Voltar é o caminho inverso — e o id
//  volta junto, então parcelas, extratos já importados e contas fixas
//  continuam amarrados no mesmo lugar.
// ------------------------------------------------------------
const DIAS_LIXEIRA = 30;
const NOME_TABELA = { gastos: "Gasto", entradas: "Entrada", analises: "Análise" };
const dataHora = (iso) => new Date(iso).toLocaleString("pt-BR",
  { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

async function restaurarDaLixeira(item) {
  const dados = { ...item.dados };
  let { error } = await supabase.from(item.tabela).insert(dados);

  // A categoria (ou a conta fixa) pode ter sido apagada nesse meio-tempo, e
  // aí a chave estrangeira recusa a volta. Melhor o lançamento voltar sem a
  // etiqueta do que não voltar — quem restaurou é avisado.
  let semVinculo = false;
  if (error && item.tabela === "gastos") {
    const r = await supabase.from("gastos").insert({ ...dados, categoria_id: null, fixo_id: null });
    if (!r.error) semVinculo = true;
    error = r.error;
  }
  if (error) throw new Error(error.message);

  // Era um lançamento de conta fixa: a dispensa daquele mês some junto, senão
  // o app continuaria achando que essa conta foi descartada ali.
  if (dados.fixo_id && dados.mes) {
    await supabase.from("fixos_pulados").delete().eq("fixo_id", dados.fixo_id).eq("mes", dados.mes);
  }
  await supabase.from("lixeira").delete().eq("id", item.id);
  return semVinculo;
}

// ------------------------------------------------------------
//  Leitor de OFX
//  O formato é SGML: as tags de valor não fecham (<TRNAMT>-750.00),
//  então não dá para usar um parser de XML — daí a leitura por regex.
// ------------------------------------------------------------
const tagOFX = (bloco, nome) => {
  const m = bloco.match(new RegExp(`<${nome}>([^<\\r\\n]*)`, "i"));
  return m ? m[1].trim() : "";
};

function lerOFX(texto) {
  const blocos = texto.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) || [];
  return blocos.map((b, i) => {
    const bruto = tagOFX(b, "DTPOSTED").replace(/[^0-9]/g, "").slice(0, 8);
    const valor = Number(tagOFX(b, "TRNAMT").replace(",", "."));
    const desc = tagOFX(b, "MEMO") || tagOFX(b, "NAME") || "Sem descrição";
    if (!bruto || !Number.isFinite(valor)) return null;
    return {
      chave: tagOFX(b, "FITID") || `${bruto}-${valor}-${i}`,
      mes: `${bruto.slice(0, 4)}-${bruto.slice(4, 6)}`,
      dia: bruto.slice(6, 8),
      desc,
      valor,                       // negativo = saída
      credito: valor > 0,
    };
  }).filter(Boolean);
}

// Bancos brasileiros costumam gerar OFX em windows-1252; lido como UTF-8 vira
// "MERCADO CENTRAL LTDA" com losangos no lugar dos acentos.
async function lerArquivoTexto(file) {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder("utf-8").decode(buf);
  return utf8.includes("�") ? new TextDecoder("windows-1252").decode(buf) : utf8;
}

// ------------------------------------------------------------
//  Monta o texto que a pessoa cola no Claude. É aqui que mora o
//  valor da funcionalidade: quanto melhor o resumo, melhor a análise.
// ------------------------------------------------------------
function montarResumo({ mesKey, renda, entradas = [], gastos, catPorId, historico }) {
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
  if (entradas.length) {
    L.push("");
    L.push("Entradas avulsas incluídas na renda acima:");
    entradas.forEach(e => L.push(`- ${e.data ? `${ddmm(e.data)} — ` : ""}${e.descricao || "sem descrição"}: ${brl(e.valor)}`));
  }
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
      const partes = [g.data ? `${ddmm(g.data)} —` : "", g.nome].filter(Boolean);
      if (g.subcategoria) partes.push(`(${g.subcategoria})`);
      if (g.total_parcelas > 1) partes.push(`— parcela ${g.parcela_atual}/${g.total_parcelas}`);
      L.push(`- ${partes.join(" ")}: ${brl(g.valor)}${g.pago ? " [pago]" : " [em aberto]"}`);
      if (g.observacao) L.push(`  obs: ${g.observacao}`);
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
        <div style={{ ...S.marca, justifyContent: "space-between" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <Marca tamanho={28} /> ControlMoney
          </span>
          <BotaoTema />
        </div>
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
        {msg && <div style={{ ...S.erro, color: "var(--verde-claro)" }}><Check size={14} /> {msg}</div>}

        <button style={{ ...S.btnPri, width: "100%", marginTop: 18, opacity: carregando ? 0.6 : 1 }} onClick={enviar} disabled={carregando}>
          {carregando ? "…" : modo === "entrar" ? "Entrar" : "Criar conta"}
        </button>

        <button style={S.linkBtn} onClick={() => { setModo(m => m === "entrar" ? "cadastrar" : "entrar"); setErro(""); setMsg(""); }}>
          {modo === "entrar" ? "Não tem conta? Criar uma" : "Já tem conta? Entrar"}
        </button>

        <div style={{ marginTop: 26 }}><ConviteInstalar /></div>
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
  const [entradas, setEntradas] = useState([]);   // ganhos avulsos do mês
  const [ordem, setOrdem] = useState(() => {
    try { return localStorage.getItem("ordem-lista") || "pendentes"; } catch { return "pendentes"; }
  });
  const [gastos, setGastos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [modalGasto, setModalGasto] = useState(false);
  const [editando, setEditando] = useState(null);
  const [editRenda, setEditRenda] = useState(false);
  const [modalCategorias, setModalCategorias] = useState(false);
  const [modalAnalise, setModalAnalise] = useState(false);
  const [modalImportar, setModalImportar] = useState(false);
  const [modalFixos, setModalFixos] = useState(false);
  const [modalLixeira, setModalLixeira] = useState(false);
  const [pergunta, setPergunta] = useState(null);   // confirmação em aberto
  const respostaRef = useRef(null);                 // resolve() da confirmação
  const [aviso, setAviso] = useState(null);         // tarja de "desfazer"
  const [fixos, setFixos] = useState([]);
  const [erroGlobal, setErroGlobal] = useState("");
  const [falhaRede, setFalhaRede] = useState(false);
  const [offline, setOffline] = useState(() => !navigator.onLine);
  const [analise, setAnalise] = useState(null);   // texto colado de volta do Claude
  const [resumo, setResumo] = useState("");       // texto a levar para o Claude
  const { y, m } = parseKey(mesAtual);

  useEffect(() => {
    try { localStorage.setItem("ordem-lista", ordem); } catch { /* navegação privativa */ }
  }, [ordem]);

  const catPorId = useMemo(() => Object.fromEntries(categorias.map(c => [c.id, c])), [categorias]);

  // ---------- carregar categorias (uma vez) ----------
  const carregarCategorias = useCallback(async () => {
    const { data } = await supabase.from("categorias").select("*").order("created_at");
    setCategorias(data || []);
  }, []);

  const carregarFixos = useCallback(async () => {
    const { data } = await supabase.from("fixos").select("*").order("created_at");
    setFixos(data || []);
  }, []);

  // Lança as contas fixas que ainda faltam neste mês. O controle é por conta,
  // não pelo mês inteiro: assim uma conta fixa criada hoje já aparece nos meses
  // que você abriu antes de cadastrá-la.
  const gerarFixos = useCallback(async (mes, jaNoMes = []) => {
    const [{ data: ativos }, { data: pulados }] = await Promise.all([
      supabase.from("fixos").select("*").eq("ativo", true),
      supabase.from("fixos_pulados").select("fixo_id").eq("mes", mes),
    ]);
    const existentes = new Set(jaNoMes.map(g => g.fixo_id).filter(Boolean));
    const dispensados = new Set((pulados || []).map(p => p.fixo_id));
    // Nunca retroage: uma conta criada em outubro não é lançada em agosto.
    const faltando = (ativos || []).filter(f =>
      !existentes.has(f.id) && !dispensados.has(f.id) && String(f.created_at).slice(0, 7) <= mes
    );

    let criou = false;
    if (faltando.length) {
      // Nasce com valor zero de propósito: água e luz mudam todo mês, e um
      // valor herdado passaria batido justamente quando veio diferente —
      // atraso com juros, reajuste, consumo fora do padrão.
      const linhas = faltando.map(f => ({
        user_id: usuario.id, mes, fixo_id: f.id,
        nome: f.nome, valor: 0,
        categoria_id: f.categoria_id, subcategoria: f.subcategoria || "",
        data: diaEm(mes, f.dia), pago: false,
      }));
      // `ignoreDuplicates` + índice único (user_id, mes, fixo_id): se outro
      // aparelho abriu o mesmo mês ao mesmo tempo, nada é duplicado.
      const { error } = await supabase.from("gastos")
        .upsert(linhas, { onConflict: "user_id,mes,fixo_id", ignoreDuplicates: true });
      criou = !error;
    }
    return criou;
  }, [usuario.id]);

  // ---------- carregar dados do mês ----------
  const carregarMes = useCallback(async (mes) => {
    setCarregando(true);
    try {
      const [g, r, a, e] = await Promise.all([
        supabase.from("gastos").select("*").eq("mes", mes)
          .order("data", { ascending: true, nullsFirst: false }).order("created_at"),
        supabase.from("meses").select("renda").eq("mes", mes).maybeSingle(),
        supabase.from("analises").select("texto").eq("mes", mes).maybeSingle(),
        supabase.from("entradas").select("*").eq("mes", mes).order("data", { ascending: true, nullsFirst: false }),
      ]);
      if (g.error || r.error || a.error || e.error) throw (g.error || r.error || a.error || e.error);

      // Completa o que falta de conta fixa neste mês. Passamos o que já veio
      // para não perguntar duas vezes a mesma coisa ao banco.
      let linhas = g.data || [];
      const criou = await gerarFixos(mes, linhas);
      if (criou) {
        const novo = await supabase.from("gastos").select("*").eq("mes", mes)
          .order("data", { ascending: true, nullsFirst: false }).order("created_at");
        if (!novo.error) linhas = novo.data || [];
      }
      setGastos(linhas);
      setRenda(Number(r.data?.renda || 0));
      setAnalise(a.data?.texto || null);
      setEntradas(e.data || []);
      setFalhaRede(false);
    } catch {
      // Sem isto, a falha cairia num `setGastos([])` e a tela diria
      // "nenhum gasto neste mês" — como se os lançamentos tivessem sumido.
      setFalhaRede(true);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregarCategorias(); carregarFixos(); }, [carregarCategorias, carregarFixos]);
  useEffect(() => { carregarMes(mesAtual); }, [mesAtual, carregarMes]);

  // Quando a conexão volta, recarrega sozinho — sem exigir toque nenhum.
  useEffect(() => {
    const voltou = () => { setOffline(false); carregarMes(mesAtual); };
    const caiu = () => setOffline(true);
    window.addEventListener("online", voltou);
    window.addEventListener("offline", caiu);
    return () => {
      window.removeEventListener("online", voltou);
      window.removeEventListener("offline", caiu);
    };
  }, [mesAtual, carregarMes]);

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
  // Renda do mês = a fixa mais os avulsos (bico, reembolso, venda).
  const rendaTotal = useMemo(
    () => Number(renda || 0) + entradas.reduce((s, e) => s + Number(e.valor || 0), 0),
    [renda, entradas]
  );

  const totais = useMemo(() => {
    const total = gastos.reduce((s, g) => s + Number(g.valor || 0), 0);
    const pago = gastos.filter(g => g.pago).reduce((s, g) => s + Number(g.valor || 0), 0);
    return { total, pago, pendente: total - pago, saldo: rendaTotal - total };
  }, [gastos, rendaTotal]);

  // Ordenação da lista. Vale nos dois níveis: dentro de cada categoria e entre
  // as categorias — senão, em "pendentes primeiro", um grupo todo pago ficaria
  // no meio da tela e a rolagem continuaria necessária.
  const porCategoria = useMemo(() => {
    const grupos = {};
    gastos.forEach(g => {
      const nome = catPorId[g.categoria_id]?.nome || "Sem categoria";
      (grupos[nome] ||= []).push(g);
    });

    const porData = (a, b) => String(a.data || "9999").localeCompare(String(b.data || "9999"));
    const dentro = {
      pendentes: (a, b) => (a.pago === b.pago ? porData(a, b) : a.pago ? 1 : -1),
      data: porData,
      nome: (a, b) => a.nome.localeCompare(b.nome, "pt-BR"),
      valor: (a, b) => Number(b.valor || 0) - Number(a.valor || 0),
    }[ordem] || porData;

    const lista = Object.entries(grupos).map(([nome, itens]) => {
      const ordenados = [...itens].sort(dentro);
      return {
        nome,
        itens: ordenados,
        subtotal: soma(ordenados),
        pendente: ordenados.some(g => !g.pago),
      };
    });

    const entre = {
      // Grupos com algo em aberto primeiro; entre eles, o maior pendente no topo.
      pendentes: (a, b) => (a.pendente === b.pendente
        ? soma(b.itens.filter(g => !g.pago)) - soma(a.itens.filter(g => !g.pago))
        : a.pendente ? -1 : 1),
      data: () => 0,
      nome: (a, b) => a.nome.localeCompare(b.nome, "pt-BR"),
      valor: (a, b) => b.subtotal - a.subtotal,
    }[ordem] || (() => 0);

    return lista.sort(entre);
  }, [gastos, catPorId, ordem]);

  // ---------- confirmação e lixeira ----------
  // Pergunta antes de apagar. Dá para usar com `await`, como o window.confirm,
  // mas sem a caixa cinza do navegador e com mais de duas saídas — é o que
  // permite separar "só esta parcela" de "esta e as próximas".
  // Devolve o id da ação escolhida, ou null se a pessoa desistiu.
  const perguntar = useCallback((cfg) => new Promise(resolver => {
    respostaRef.current = resolver;
    setPergunta(cfg);
  }), []);

  const responder = useCallback((id) => {
    setPergunta(null);
    const resolver = respostaRef.current;
    respostaRef.current = null;
    resolver?.(id);
  }, []);

  // Guarda as linhas na lixeira antes de apagá-las. Devolve os ids guardados,
  // que são o que a tarja de "desfazer" usa para trazer tudo de volta.
  const paraLixeira = useCallback(async (tabela, linhas, rotulo) => {
    const lista = (Array.isArray(linhas) ? linhas : [linhas]).filter(Boolean);
    if (!lista.length) return [];
    const { data, error } = await supabase.from("lixeira").insert(
      lista.map(l => ({
        user_id: usuario.id, tabela, registro_id: l.id, mes: l.mes || null,
        rotulo: rotulo || l.nome || l.descricao || NOME_TABELA[tabela] || "",
        valor: Number(l.valor || 0), dados: l,
      }))
    ).select("id");
    // Sem lixeira não se apaga nada: perder o lançamento em silêncio é
    // exatamente o que esta tela existe para impedir.
    if (error) throw new Error(
      `não consegui guardar na lixeira (${error.message}). ` +
      `Se o banco é antigo, rode o trecho da LIXEIRA do schema.sql no Supabase.`
    );
    return data.map(r => r.id);
  }, [usuario.id]);

  const avisarDesfazer = (texto, ids) => setAviso({ texto, ids });

  const desfazerRemocao = async () => {
    const ids = aviso?.ids || [];
    setAviso(null);
    if (!ids.length) return;
    const { data } = await supabase.from("lixeira").select("*").in("id", ids);
    try {
      for (const item of data || []) await restaurarDaLixeira(item);
    } catch (e) {
      setAviso({ texto: "Não consegui restaurar: " + (e?.message || e), ids: [] });
    }
    await carregarCategorias();
    carregarMes(mesAtual);
  };

  // A tarja some sozinha; quem perdeu a janela ainda acha tudo na lixeira.
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 9000);
    return () => clearTimeout(t);
  }, [aviso]);

  // ---------- ações ----------
  const navegarMes = (dir) => setMesAtual(k => addMeses(k, dir));

  const definirRenda = async (valor) => {
    const v = Number(valor) || 0;
    setRenda(v);
    await supabase.from("meses").upsert({ user_id: usuario.id, mes: mesAtual, renda: v }, { onConflict: "user_id,mes" });
  };

  const adicionarEntrada = async ({ valor, descricao, data }) => {
    const { error } = await supabase.from("entradas").insert({
      user_id: usuario.id, mes: mesAtual,
      valor: Number(valor) || 0, descricao: descricao || "", data: data || null,
    });
    if (error) throw error;
    await carregarMes(mesAtual);
  };

  const removerEntrada = async (e) => {
    const escolha = await perguntar({
      titulo: "Remover esta entrada?",
      texto: `${e.descricao || "Entrada avulsa"} — ${brl(e.valor)}${e.data ? ` · ${ddmm(e.data)}` : ""}.`,
      nota: `Vai para a lixeira e pode voltar de lá por ${DIAS_LIXEIRA} dias.`,
      acoes: [{ id: "remover", rotulo: "Remover", tom: "perigo" }],
    });
    if (escolha !== "remover") return;
    let ids = [];
    try {
      ids = await paraLixeira("entradas", e);
      const { error } = await supabase.from("entradas").delete().eq("id", e.id);
      if (error) throw error;
      avisarDesfazer(`Entrada "${e.descricao || brl(e.valor)}" removida`, ids);
    } catch (err) {
      // A cópia entrou na lixeira mas o original não saiu: desfazemos a cópia,
      // senão sobraria um registro duplicado, impossível de restaurar.
      if (ids.length) await supabase.from("lixeira").delete().in("id", ids);
      setAviso({ texto: "Não consegui remover: " + (err?.message || err), ids: [] });
    }
    await carregarMes(mesAtual);
  };

  const togglePago = async (g) => {
    setGastos(gs => gs.map(x => x.id === g.id ? { ...x, pago: !x.pago } : x)); // otimista
    await supabase.from("gastos").update({ pago: !g.pago }).eq("id", g.id);
  };

  const removerGasto = async (g) => {
    const parcelado = g.grupo_parcela && g.total_parcelas > 1;
    const detalhe = [
      brl(g.valor),
      g.data ? ddmm(g.data) : "",
      catPorId[g.categoria_id]?.nome || "",
      g.fixo_id ? "conta fixa" : "",
    ].filter(Boolean).join(" · ");

    const escolha = await perguntar({
      titulo: `Remover "${g.nome}"?`,
      texto: parcelado
        ? `Parcela ${g.parcela_atual} de ${g.total_parcelas} — ${detalhe}.`
        : detalhe,
      nota: `Vai para a lixeira e pode voltar de lá por ${DIAS_LIXEIRA} dias.`,
      acoes: parcelado
        ? [{ id: "esta", rotulo: "Só esta parcela", tom: "perigo" },
           { id: "futuras", rotulo: "Esta e as próximas", tom: "perigo" }]
        : [{ id: "esta", rotulo: "Remover", tom: "perigo" }],
    });
    if (!escolha) return;

    let alvos = [g];
    if (escolha === "futuras") {
      const { data } = await supabase.from("gastos").select("*")
        .eq("grupo_parcela", g.grupo_parcela).gte("mes", mesAtual);
      if (data?.length) alvos = data;
    }

    let ids = [];
    try {
      ids = await paraLixeira("gastos", alvos);
      // Apagar um lançamento de conta fixa vale para aquele mês: registramos a
      // dispensa para ele não voltar na próxima abertura.
      const deFixa = alvos.filter(a => a.fixo_id);
      if (deFixa.length) {
        await supabase.from("fixos_pulados").upsert(
          deFixa.map(a => ({ user_id: usuario.id, fixo_id: a.fixo_id, mes: a.mes })),
          { onConflict: "user_id,fixo_id,mes", ignoreDuplicates: true });
      }
      setGastos(gs => gs.filter(x => !alvos.some(a => a.id === x.id))); // otimista
      const { error } = await supabase.from("gastos").delete().in("id", alvos.map(a => a.id));
      if (error) throw error;
      avisarDesfazer(
        alvos.length > 1 ? `${alvos.length} parcelas de "${g.nome}" removidas` : `"${g.nome}" removido`,
        ids);
    } catch (err) {
      // A cópia entrou na lixeira mas o original não saiu: desfazemos a cópia,
      // senão sobraria um registro duplicado, impossível de restaurar.
      if (ids.length) await supabase.from("lixeira").delete().in("id", ids);
      setAviso({ texto: "Não consegui remover: " + (err?.message || err), ids: [] });
    }
    carregarMes(mesAtual);
  };

  const garantirCategoria = async (nome, corSugerida) => {
    const existente = categorias.find(c => c.nome.toLowerCase() === nome.toLowerCase());
    if (existente) return existente;
    const cor = corSugerida || CORES_CAT[categorias.length % CORES_CAT.length];
    const { data, error } = await supabase.from("categorias")
      .insert({ user_id: usuario.id, nome, cor }).select().single();
    if (error) throw new Error(`não consegui criar a categoria "${nome}" (${error.message})`);
    await carregarCategorias();
    return data;
  };

  const registrarSub = async (cat, sub) => {
    if (!sub || cat.subs?.includes(sub)) return;
    const novas = [...(cat.subs || []), sub];
    const { error } = await supabase.from("categorias").update({ subs: novas }).eq("id", cat.id);
    if (error) throw new Error(`não consegui criar a subcategoria "${sub}" (${error.message})`);
    await carregarCategorias();
  };

  // Mesma ideia do botão de criar categoria: a subcategoria nasce na hora,
  // em vez de ficar pendurada até o Salvar.
  const criarSubcategoria = async (nomeCat, sub) => {
    const cat = categorias.find(c => c.nome === nomeCat);
    if (!cat) throw new Error("escolha uma categoria antes de criar a subcategoria");
    await registrarSub(cat, sub);
    return sub;
  };

  // Apagar categoria: os gastos que a usam não somem — a FK é `on delete set
  // null`, então eles caem no grupo "Sem categoria" com os valores intactos.
  // Renomear categoria é barato: os gastos apontam para o id, não para o nome.
  const renomearCategoria = async (cat, novo) => {
    const n = novo.trim();
    if (!n || n === cat.nome) return;
    const { error } = await supabase.from("categorias").update({ nome: n }).eq("id", cat.id);
    if (error) {
      window.alert(/duplicate|unique/i.test(error.message)
        ? `Já existe uma categoria chamada "${n}".`
        : `Não consegui renomear: ${error.message}`);
      return;
    }
    await carregarCategorias();
    carregarMes(mesAtual);
  };

  // Subcategoria é diferente: o nome fica copiado dentro de cada gasto, então
  // renomear no molde exige atualizar os lançamentos, senão eles ficam com o
  // nome antigo e somem dos filtros.
  const renomearSub = async (cat, antigo, novo) => {
    const n = novo.trim();
    if (!n || n === antigo) return;
    if ((cat.subs || []).some(s => s.toLowerCase() === n.toLowerCase())) {
      window.alert(`"${cat.nome}" já tem uma subcategoria chamada "${n}".`);
      return;
    }
    const novas = (cat.subs || []).map(s => (s === antigo ? n : s));
    const { error } = await supabase.from("categorias").update({ subs: novas }).eq("id", cat.id);
    if (error) { window.alert(`Não consegui renomear: ${error.message}`); return; }
    await supabase.from("gastos").update({ subcategoria: n })
      .eq("categoria_id", cat.id).eq("subcategoria", antigo);
    await carregarCategorias();
    carregarMes(mesAtual);
  };

  const removerCategoria = async (cat) => {
    const { count } = await supabase.from("gastos")
      .select("id", { count: "exact", head: true }).eq("categoria_id", cat.id);
    const escolha = await perguntar({
      titulo: `Apagar a categoria "${cat.nome}"?`,
      texto: count
        ? `Ela está em ${count} gasto${count > 1 ? "s" : ""}. Esses gastos continuam ` +
          `existindo, com os mesmos valores — passam a aparecer como "Sem categoria".`
        : "Ela não está em nenhum gasto.",
      acoes: [{ id: "apagar", rotulo: "Apagar", tom: "perigo" }],
    });
    if (escolha !== "apagar") return;
    await supabase.from("categorias").delete().eq("id", cat.id);
    await carregarCategorias();
    carregarMes(mesAtual);
  };

  const removerSub = async (cat, sub) => {
    const escolha = await perguntar({
      titulo: `Remover a subcategoria "${sub}"?`,
      texto: `Ela some da lista de opções de ${cat.nome}. Gastos já lançados com esse nome não mudam.`,
      acoes: [{ id: "remover", rotulo: "Remover", tom: "perigo" }],
    });
    if (escolha !== "remover") return;
    const novas = (cat.subs || []).filter(s => s !== sub);
    await supabase.from("categorias").update({ subs: novas }).eq("id", cat.id);
    await carregarCategorias();
  };

  const salvarGasto = async (form) => {
    setErroGlobal("");
    try {
      await salvarGastoInterno(form);
    } catch (e) {
      // Antes, uma falha aqui quebrava a promessa em silêncio e o modal só
      // ficava parado — parecia que o botão não funcionava.
      setErroGlobal("Não consegui salvar: " + (e?.message || e));
    }
  };

  const salvarGastoInterno = async (form) => {
    const { nome, valor, valorUltima, categoria, subcategoria, observacao, data, parcelas, fixo } = form;
    const dia = diaDe(data);
    const cat = await garantirCategoria(categoria);
    if (subcategoria) await registrarSub(cat, subcategoria);

    const n = Math.max(1, Number(parcelas) || 1);

    // Editar um gasto parcelado reescreve a série inteira, a partir do mês da
    // primeira parcela. É o que permite corrigir "esqueci que eram 5x" ou
    // "digitei o total em vez do valor mensal" sem apagar e refazer.
    if (editando) {
      let existentes = [editando];
      if (editando.grupo_parcela) {
        const { data } = await supabase.from("gastos").select("*").eq("grupo_parcela", editando.grupo_parcela);
        if (data?.length) existentes = data;
      }
      const mesInicial = existentes.reduce((min, g) => (g.mes < min ? g.mes : min), existentes[0].mes);
      const pagoPorIndice = {};
      existentes.forEach(g => { pagoPorIndice[(g.parcela_atual || 1) - 1] = g.pago; });
      const fitid = existentes.find(g => g.fitid)?.fitid || null;
      const grupoId = n > 1 ? (editando.grupo_parcela || crypto.randomUUID()) : null;

      // O vínculo com a conta fixa precisa sobreviver à reescrita da série —
      // é ele que segura o selo e a trava contra lançar duas vezes no mês.
      let fixoId = existentes.find(g => g.fixo_id)?.fixo_id || null;
      // Marcou "repetir" num gasto que ainda não era fixo: cria o molde agora.
      if (fixo && !fixoId && n === 1) {
        const novo = await criarFixo({ nome, categoria_id: cat.id, subcategoria, dia });
        fixoId = novo?.id || null;
      }

      const novas = Array.from({ length: n }, (_, i) => ({
        user_id: usuario.id,
        mes: addMeses(mesInicial, i),
        nome,
        valor: i === n - 1 ? Number(valorUltima ?? valor) : Number(valor),
        data: diaEm(addMeses(mesInicial, i), dia),
        categoria_id: cat.id, subcategoria: subcategoria || "", observacao: observacao || "",
        pago: pagoPorIndice[i] ?? false,
        grupo_parcela: grupoId,
        parcela_atual: n > 1 ? i + 1 : null,
        total_parcelas: n > 1 ? n : null,
        fitid: i === 0 ? fitid : null,
        fixo_id: i === 0 ? fixoId : null,
      }));

      // Insere antes de apagar: se algo falhar, nada é perdido.
      const { error } = await supabase.from("gastos").insert(novas);
      if (error) { setErroGlobal("Não consegui salvar: " + error.message); return; }
      await supabase.from("gastos").delete().in("id", existentes.map(g => g.id));
      fechar(); carregarMes(mesAtual); return;
    }

    // "Repetir todo mês" cria o modelo; o lançamento deste mês vem logo abaixo,
    // como qualquer outro, já amarrado a ele.
    let fixoId = null;
    if (fixo && n === 1) {
      const novo = await criarFixo({ nome, categoria_id: cat.id, subcategoria, dia });
      fixoId = novo?.id || null;
    }

    const grupo = n > 1 ? crypto.randomUUID() : null;
    const linhas = Array.from({ length: n }, (_, i) => ({
      user_id: usuario.id,
      mes: addMeses(mesAtual, i),
      nome,
      // Na divisão, a última parcela absorve a sobra dos centavos.
      valor: i === n - 1 ? Number(valorUltima ?? valor) : Number(valor),
      data: diaEm(addMeses(mesAtual, i), dia),
      categoria_id: cat.id, subcategoria: subcategoria || "", observacao: observacao || "",
      fixo_id: i === 0 ? fixoId : null,
      pago: false, grupo_parcela: grupo,
      parcela_atual: n > 1 ? i + 1 : null,
      total_parcelas: n > 1 ? n : null,
    }));
    const { error } = await supabase.from("gastos").insert(linhas);
    if (error) throw error;
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

    setResumo(montarResumo({ mesKey: mesAtual, renda: rendaTotal, entradas, gastos, catPorId, historico }));
    setModalAnalise(true);
  };

  const salvarAnalise = async (texto) => {
    const t = texto.trim();
    if (!t) return;
    await supabase.from("analises").upsert({ user_id: usuario.id, mes: mesAtual, texto: t }, { onConflict: "user_id,mes" });
    setAnalise(t);
  };

  const apagarAnalise = async () => {
    const escolha = await perguntar({
      titulo: "Apagar a análise guardada deste mês?",
      texto: `O texto vai para a lixeira e pode voltar de lá por ${DIAS_LIXEIRA} dias.`,
      acoes: [{ id: "apagar", rotulo: "Apagar", tom: "perigo" }],
    });
    if (escolha !== "apagar") return;
    try {
      const { data: guardada } = await supabase.from("analises").select("*").eq("mes", mesAtual).maybeSingle();
      const ids = guardada
        ? await paraLixeira("analises", guardada, `Análise de ${MESES[m]}/${y}`)
        : [];
      await supabase.from("analises").delete().eq("mes", mesAtual);
      setAnalise(null);
      if (ids.length) avisarDesfazer(`Análise de ${MESES[m]}/${y} apagada`, ids);
    } catch (err) {
      setAviso({ texto: "Não consegui apagar: " + (err?.message || err), ids: [] });
    }
  };

  // Enriquece as transações lidas do arquivo: marca as que já foram importadas
  // antes (pelo FITID) e sugere categoria a partir do que já foi classificado.
  const prepararImportacao = async (transacoes) => {
    const chaves = transacoes.map(t => t.chave);
    const [jaVistos, hist] = await Promise.all([
      supabase.from("gastos").select("fitid").in("fitid", chaves.length ? chaves : ["-"]),
      supabase.from("gastos").select("nome, categoria_id, subcategoria").not("categoria_id", "is", null).order("created_at", { ascending: false }).limit(500),
    ]);
    const importados = new Set((jaVistos.data || []).map(g => g.fitid));
    const sugestao = {};
    (hist.data || []).forEach(g => {
      const k = chaveDesc(g.nome);
      if (k && !(k in sugestao)) sugestao[k] = { categoria_id: g.categoria_id, subcategoria: g.subcategoria || "" };
    });
    return transacoes.map(t => ({
      ...t,
      jaImportada: importados.has(t.chave),
      ...(sugestao[chaveDesc(t.desc)] || { categoria_id: "", subcategoria: "" }),
    }));
  };

  const importarGastos = async (linhas) => {
    const novos = linhas.map(l => ({
      user_id: usuario.id,
      mes: l.mes,
      data: `${l.mes}-${l.dia}`,
      nome: l.desc,
      valor: Math.abs(Number(l.valor)),
      categoria_id: l.categoria_id || null,
      subcategoria: l.subcategoria || "",
      pago: true,                 // saiu do extrato, então já saiu da conta
      fitid: l.chave,
    }));
    const { error } = await supabase.from("gastos").insert(novos);
    if (error) throw error;
    setModalImportar(false);
    await carregarMes(mesAtual);
  };

  const criarFixo = async ({ nome, categoria_id, subcategoria, dia }) => {
    const { data } = await supabase.from("fixos").insert({
      user_id: usuario.id, nome,
      categoria_id: categoria_id || null, subcategoria: subcategoria || "", dia,
    }).select().single();
    await carregarFixos();
    return data;
  };

  const alterarFixo = async (id, campos) => {
    await supabase.from("fixos").update(campos).eq("id", id);
    await carregarFixos();
  };

  const removerFixo = async (f) => {
    const escolha = await perguntar({
      titulo: `Parar a conta fixa "${f.nome}"?`,
      texto: "Ela deixa de ser lançada daqui em diante. Os lançamentos já feitos " +
             "continuam onde estão — nada some do histórico.",
      acoes: [{ id: "parar", rotulo: "Parar", tom: "perigo" }],
    });
    if (escolha !== "parar") return;

    // Meses futuros que já foram abertos alguma vez já têm o lançamento
    // criado; parar o modelo não os alcança. Oferecemos limpar só os que
    // ainda não foram pagos, e só depois do mês aberto.
    const { data: futuros } = await supabase.from("gastos")
      .select("*").eq("fixo_id", f.id).eq("pago", false).gt("mes", mesAtual);

    if (futuros?.length) {
      const meses = [...new Set(futuros.map(g => g.mes))].sort();
      const lista = meses.map(m => { const p = parseKey(m); return `${MESES[p.m]}/${p.y}`; }).join(", ");
      const comFuturos = await perguntar({
        titulo: "E os lançamentos que já estão à frente?",
        texto: `"${f.nome}" já está lançado em ${meses.length} mês${meses.length > 1 ? "es" : ""} ` +
               `ainda não pago${meses.length > 1 ? "s" : ""}: ${lista}.`,
        acoes: [{ id: "manter", rotulo: "Deixar como estão" },
                { id: "apagar", rotulo: "Apagar também", tom: "perigo" }],
      });
      if (comFuturos === "apagar") {
        const plural = futuros.length > 1;
        let ids = [];
        try {
          ids = await paraLixeira("gastos", futuros);
          const { error } = await supabase.from("gastos").delete().in("id", futuros.map(g => g.id));
          if (error) throw error;
          avisarDesfazer(
            `${futuros.length} lançamento${plural ? "s" : ""} futuro${plural ? "s" : ""} de "${f.nome}" removido${plural ? "s" : ""}`,
            ids);
        } catch (err) {
          if (ids.length) await supabase.from("lixeira").delete().in("id", ids);
          setAviso({ texto: "Não consegui remover os futuros: " + (err?.message || err), ids: [] });
        }
      }
    }

    await supabase.from("fixos").delete().eq("id", f.id);
    await carregarFixos();
    carregarMes(mesAtual);
  };

  const abrirNovo = () => { setErroGlobal(""); setEditando(null); setModalGasto(true); };
  const abrirEdicao = (g) => { setErroGlobal(""); setEditando({ ...g, categoriaNome: catPorId[g.categoria_id]?.nome }); setModalGasto(true); };
  const fechar = () => { setModalGasto(false); setEditando(null); };

  const saldoNeg = totais.saldo < 0;

  return (
    <Tela>
      <div style={S.wrap} className="nao-imprimir">
        <header style={S.header}>
          <div style={S.marca}><Marca tamanho={24} /><span>ControlMoney</span></div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button style={S.btnNav} onClick={() => navegarMes(-1)} aria-label="Mês anterior"><ChevronLeft size={18} /></button>
            <div style={S.mesLabel}>{MESES[m]} <span style={{ color: "var(--texto-4)" }}>{y}</span></div>
            <button style={S.btnNav} onClick={() => navegarMes(1)} aria-label="Próximo mês"><ChevronRight size={18} /></button>
            <BotaoTema />
            <button style={S.btnNav} onClick={() => setModalCategorias(true)} aria-label="Categorias"><Tags size={16} /></button>
            <button style={S.btnNav} onClick={() => setModalLixeira(true)}
              aria-label="Lixeira" title="Lixeira — ver e restaurar o que foi apagado"><Trash2 size={16} /></button>
            <button style={S.btnNav} onClick={() => supabase.auth.signOut()} aria-label="Sair"><LogOut size={16} /></button>
          </div>
        </header>

        <ConviteInstalar />

        {falhaRede ? (
          <SemDados offline={offline} onTentar={() => carregarMes(mesAtual)} />
        ) : (
        <>
        <section style={{ ...S.heroSaldo, borderColor: saldoNeg ? "var(--vermelho-borda)" : "var(--verde-borda)" }}>
          <div style={S.heroTopo}>
            <span style={S.heroLabel}>{saldoNeg ? "Faltam" : "Sobra depois de tudo"}</span>
            <button style={S.rendaBtn} onClick={() => setEditRenda(true)}>
              Renda: {brl(rendaTotal)}{entradas.length > 0 && <TrendingUp size={11} />} <Pencil size={12} />
            </button>
          </div>
          <div style={{ ...S.heroValor, color: saldoNeg ? "var(--vermelho)" : "var(--verde-claro)" }}>{brl(Math.abs(totais.saldo))}</div>
          <div style={S.barraWrap}>
            <div style={S.barra}><div style={{ ...S.barraFill, width: `${Math.min(100, rendaTotal ? (totais.total / rendaTotal) * 100 : 0)}%` }} /></div>
            <span style={S.barraTxt}>{brl(totais.total)} de {brl(rendaTotal)} comprometidos</span>
          </div>
        </section>

        <section style={S.resumo}>
          <div style={S.resumoCard}><span style={S.resumoLabel}>Total do mês</span><span style={S.resumoVal}>{brl(totais.total)}</span></div>
          <div style={S.resumoCard}><span style={S.resumoLabel}>Já pago</span><span style={{ ...S.resumoVal, color: "var(--verde-claro)" }}>{brl(totais.pago)}</span></div>
          <div style={S.resumoCard}><span style={S.resumoLabel}>Falta pagar</span><span style={{ ...S.resumoVal, color: totais.pendente > 0 ? "var(--ambar)" : "var(--verde-claro)" }}>{brl(totais.pendente)}</span></div>
        </section>

        <button style={S.btnAnalise} onClick={abrirAnalise} disabled={carregando}>
          <Sparkles size={15} strokeWidth={2.5} />
          {analise ? "Ver análise do mês" : "Analisar meus gastos no Claude"}
          {analise && <span style={S.selo}>salva</span>}
        </button>


        <div style={S.linhaSecundaria}>
          <button style={S.btnSecundario} onClick={() => setModalFixos(true)}>
            <Repeat size={14} /> Contas fixas{fixos.length ? ` (${fixos.length})` : ""}
          </button>
          <button style={S.btnSecundario} onClick={() => setModalImportar(true)}>
            <Upload size={14} /> Importar OFX
          </button>
          <button style={S.btnSecundario} onClick={() => window.print()}>
            <Printer size={14} /> PDF
          </button>
        </div>

        {!carregando && gastos.length > 0 && (
          <div style={S.barraOrdem}>
            <span style={S.barraOrdemRotulo}>Ordenar por</span>
            <select style={S.selectOrdem} value={ordem} onChange={e => setOrdem(e.target.value)} aria-label="Ordenar a lista">
              <option value="pendentes">a pagar primeiro</option>
              <option value="data">data</option>
              <option value="nome">nome</option>
              <option value="valor">maior valor</option>
            </select>
          </div>
        )}

        <main style={S.lista}>
          {carregando ? (
            <div style={S.vazio}>Carregando {MESES[m]}…</div>
          ) : gastos.length === 0 ? (
            <div style={S.vazio}>
              <p style={{ margin: 0, fontWeight: 600, color: "var(--texto)" }}>Nenhum gasto em {MESES[m]}.</p>
              <p style={{ margin: "6px 0 0", fontSize: 14 }}>Toque em <b>+ Novo gasto</b> para começar.</p>
            </div>
          ) : (
            porCategoria.map(({ nome: cat, itens, subtotal }) => {
              const cor = categorias.find(c => c.nome === cat)?.cor || "var(--texto-4)";
              // Sem renda informada não há do que tirar porcentagem.
              const pct = rendaTotal > 0 ? (subtotal / rendaTotal) * 100 : null;
              return (
                <div key={cat} style={S.grupo}>
                  <div style={S.grupoHead}>
                    <span style={{ ...S.dot, background: cor }} />
                    <span style={S.grupoNome}>{cat}</span>
                    {pct !== null && <span style={S.grupoPct} title={`${cat} consome ${pctTxt(pct)} da renda do mês`}>{pctTxt(pct)}</span>}
                    <span style={S.grupoTotal}>{brl(subtotal)}</span>
                  </div>
                  {itens.map(g => (
                    <div key={g.id} style={{ ...S.item, background: g.pago ? "rgba(34,197,94,0.14)" : "var(--superficie)", borderColor: g.pago ? "rgba(34,197,94,0.4)" : "var(--borda)" }}>
                      <button style={{ ...S.check, background: g.pago ? "var(--verde)" : "transparent", borderColor: g.pago ? "var(--verde)" : "var(--borda-3)" }}
                        onClick={() => togglePago(g)} aria-label={g.pago ? "Marcar como não pago" : "Marcar como pago"}>
                        {g.pago && <Check size={14} strokeWidth={3} color="var(--fundo)" />}
                      </button>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={S.itemNome}>
                          {/* Só o nome trunca; os selos nunca são comidos por ele. */}
                          <span style={S.itemNomeTexto}>{g.nome}</span>
                          {g.total_parcelas > 1 && <span style={S.parcela}>{g.parcela_atual}/{g.total_parcelas}</span>}
                          {g.fixo_id && <span style={S.seloFixa} title="Conta fixa, lançada automaticamente">fixa</span>}
                        </div>
                        {(g.data || g.subcategoria) && (
                          <div style={S.itemSub}>
                            {g.data && <span style={S.itemData}>{ddmm(g.data)}</span>}
                            {g.data && g.subcategoria && " · "}
                            {g.subcategoria}
                          </div>
                        )}
                        {g.observacao && <div style={S.itemObs}>{g.observacao}</div>}
                      </div>
                      {Number(g.valor) === 0 ? (
                        <button style={S.aPreencher} onClick={() => abrirEdicao(g)}>a preencher</button>
                      ) : (
                        <div style={{ ...S.itemValor, color: g.pago ? "var(--verde-claro)" : "var(--texto)" }}>{brl(g.valor)}</div>
                      )}
                      <button style={S.iconBtn} onClick={() => abrirEdicao(g)} aria-label="Editar"><Pencil size={14} /></button>
                      <button style={S.iconBtn} onClick={() => removerGasto(g)} aria-label="Remover"><Trash2 size={14} /></button>
                    </div>
                  ))}
                </div>
              );
            })
          )}
        </main>
        </>
        )}
      </div>

      {!falhaRede && <button style={S.fab} className="nao-imprimir" onClick={abrirNovo}><Plus size={20} strokeWidth={2.5} /> Novo gasto</button>}

      <FolhaImpressao mes={mesAtual} renda={rendaTotal} entradas={entradas}
        gastos={gastos} catPorId={catPorId} totais={totais} />

      {modalGasto && <ModalGasto categorias={categorias} mes={mesAtual} editando={editando} erroExterno={erroGlobal}
        onCriarCategoria={garantirCategoria} onCriarSub={criarSubcategoria}
        onFechar={fechar} onSalvar={salvarGasto} />}
      {editRenda && <ModalEntradas renda={renda} entradas={entradas} mes={mesAtual}
        onFechar={() => setEditRenda(false)} onSalvarRenda={definirRenda}
        onAdicionar={adicionarEntrada} onRemover={removerEntrada} />}
      {modalCategorias && <ModalCategorias categorias={categorias} onFechar={() => setModalCategorias(false)}
        onRemoverCat={removerCategoria} onRemoverSub={removerSub}
        onRenomearCat={renomearCategoria} onRenomearSub={renomearSub} />}
      {modalAnalise && <ModalAnalise resumo={resumo} analise={analise} onFechar={() => setModalAnalise(false)}
        onSalvar={salvarAnalise} onApagar={apagarAnalise} />}
      {modalImportar && <ModalImportar categorias={categorias} onFechar={() => setModalImportar(false)}
        onPreparar={prepararImportacao} onImportar={importarGastos} />}
      {modalFixos && <ModalFixos fixos={fixos} categorias={categorias} onFechar={() => setModalFixos(false)}
        onAlterar={alterarFixo} onRemover={removerFixo} />}
      {modalLixeira && <ModalLixeira onFechar={() => setModalLixeira(false)}
        onPerguntar={perguntar}
        onMudou={() => { carregarCategorias(); carregarMes(mesAtual); }} />}

      {/* A tarja de desfazer fica acima do botão de novo gasto, e some sozinha. */}
      {aviso && (
        <div style={S.tarja} className="nao-imprimir" role="status">
          <span style={S.tarjaTexto}>{aviso.texto}</span>
          {aviso.ids.length > 0 && (
            <button style={S.tarjaBtn} onClick={desfazerRemocao}><Undo2 size={14} /> Desfazer</button>
          )}
          <button style={S.tarjaX} onClick={() => setAviso(null)} aria-label="Dispensar"><X size={15} /></button>
        </div>
      )}

      {pergunta && <ModalConfirmar {...pergunta} onResponder={responder} />}
    </Tela>
  );
}

// ============================================================
//  Modais
// ============================================================
function ModalEntradas({ renda, entradas, mes, onFechar, onSalvarRenda, onAdicionar, onRemover }) {
  const [v, setV] = useState(renda || "");
  const [valor, setValor] = useState("");
  const [descricao, setDescricao] = useState("");
  const [data, setData] = useState(() => {
    const hoje = hojeISO();
    return hoje.slice(0, 7) === mes ? hoje : `${mes}-01`;
  });
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const extra = entradas.reduce((s, e) => s + Number(e.valor || 0), 0);
  const total = (Number(v) || 0) + extra;

  const incluir = async () => {
    if (!valor || Number(valor) <= 0) return setErro("Informe um valor maior que zero.");
    setErro(""); setOcupado(true);
    try {
      await onAdicionar({ valor, descricao: descricao.trim(), data });
      setValor(""); setDescricao("");
    } catch (e) {
      setErro("Não consegui adicionar: " + (e?.message || e));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Overlay onFechar={onFechar}>
      <h2 style={S.modalTitulo}>Entradas do mês</h2>
      <p style={S.modalAjuda}>É sobre a soma delas que o saldo é calculado.</p>

      <label style={S.label}>Renda fixa (salário)</label>
      <input type="number" inputMode="decimal" style={S.input} value={v}
        onChange={e => setV(e.target.value)} onBlur={() => onSalvarRenda(v)}
        onKeyDown={e => e.key === "Enter" && e.target.blur()} placeholder="0,00" />

      <div style={S.passo}><span style={S.passoNum}>+</span> Outras entradas</div>

      {entradas.length > 0 && (
        <div style={S.catLista}>
          {entradas.map(e => (
            <div key={e.id} style={S.entradaLinha}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={S.entradaDesc}>{e.descricao || "Entrada avulsa"}</div>
                {e.data && <div style={S.fixoMeta}>{ddmm(e.data)}</div>}
              </div>
              <b style={S.entradaValor}>+ {brl(e.valor)}</b>
              <button style={S.iconBtn} onClick={() => onRemover(e)} aria-label="Remover entrada">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={S.entradaForm}>
        <input type="number" inputMode="decimal" style={{ ...S.input, flex: "0 0 110px" }} value={valor}
          onChange={ev => setValor(ev.target.value)} placeholder="0,00" aria-label="Valor da entrada" />
        <input style={{ ...S.input, flex: 1, minWidth: 0 }} value={descricao}
          onChange={ev => setDescricao(ev.target.value)}
          onKeyDown={ev => ev.key === "Enter" && incluir()}
          placeholder="De onde veio? Ex: freela, reembolso" aria-label="Descrição da entrada" />
      </div>
      <input type="date" style={{ ...S.input, marginTop: 8 }} value={data}
        onChange={ev => setData(ev.target.value)}
        min={`${mes}-01`} max={`${mes}-${String(ultimoDia(mes)).padStart(2, "0")}`} />
      <button style={{ ...S.btnCriarCat, opacity: ocupado ? 0.5 : 1 }} disabled={ocupado} onClick={incluir}>
        {ocupado ? "Adicionando…" : "Adicionar entrada"}
      </button>

      {erro && <div style={S.erro}><AlertCircle size={14} /> {erro}</div>}

      <div style={S.entradaTotal}>
        Total do mês <b style={{ color: "var(--verde-claro)" }}>{brl(total)}</b>
      </div>

      <div style={S.modalAcoes}>
        <button style={S.btnPri} onClick={() => { onSalvarRenda(v); onFechar(); }}>Pronto</button>
      </div>
    </Overlay>
  );
}

function ModalFixos({ fixos, categorias, onFechar, onAlterar, onRemover }) {
  const nomeCat = (id) => categorias.find(c => c.id === id)?.nome || "Sem categoria";

  return (
    <Overlay onFechar={onFechar}>
      <h2 style={S.modalTitulo}>Contas fixas</h2>
      <p style={S.modalAjuda}>
        Lançadas sozinhas a cada mês novo, com valor zerado — você preenche o
        que a conta trouxe, para nenhum valor antigo passar batido.
      </p>

      {fixos.length === 0 ? (
        <div style={S.catVazio}>
          Nenhuma ainda. Ao lançar um gasto, marque <b>Repetir todo mês</b> para
          criar uma.
        </div>
      ) : (
        <div style={S.catLista}>
          {fixos.map(f => (
            <div key={f.id} style={{ ...S.fixoLinha, opacity: f.ativo ? 1 : 0.5 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={S.fixoNome}>{f.nome}</div>
                <div style={S.fixoMeta}>
                  {nomeCat(f.categoria_id)}{f.subcategoria ? ` · ${f.subcategoria}` : ""}
                  {!f.ativo && " · pausada"}
                </div>
              </div>
              <span style={S.fixoDiaRotulo}>dia</span>
              <input type="number" min={1} max={31} style={S.fixoDia} defaultValue={f.dia}
                aria-label={`Dia de ${f.nome}`}
                onBlur={e => { const d = Math.min(31, Math.max(1, Number(e.target.value) || 1)); if (d !== f.dia) onAlterar(f.id, { dia: d }); }} />
              <button style={S.iconBtn} onClick={() => onAlterar(f.id, { ativo: !f.ativo })}
                aria-label={f.ativo ? `Pausar ${f.nome}` : `Retomar ${f.nome}`}
                title={f.ativo ? "Pausar" : "Retomar"}>
                {f.ativo ? <Pause size={14} /> : <Play size={14} />}
              </button>
              <button style={S.iconBtn} onClick={() => onRemover(f)} aria-label={`Parar ${f.nome}`}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <p style={S.dicaCampo}>
            <b>Pausar</b> serve para uma interrupção temporária; a <b>lixeira</b>
            encerra de vez — e, se houver lançamentos em meses à frente ainda não
            pagos, ela pergunta se quer apagá-los também. O histórico nunca é tocado.
          </p>
        </div>
      )}

      <div style={S.modalAcoes}>
        <button style={S.btnSec} onClick={onFechar}>Fechar</button>
      </div>
    </Overlay>
  );
}

function ModalImportar({ categorias, onFechar, onPreparar, onImportar }) {
  const [linhas, setLinhas] = useState(null);   // null = ainda sem arquivo
  const [mostrarCreditos, setMostrarCreditos] = useState(false);
  const [catLote, setCatLote] = useState("");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const carregarArquivo = async (file) => {
    if (!file) return;
    setErro(""); setOcupado(true);
    try {
      const texto = await lerArquivoTexto(file);
      const transacoes = lerOFX(texto);
      if (!transacoes.length) {
        setErro("Não encontrei transações neste arquivo. Ele é mesmo um OFX do extrato?");
        setLinhas(null);
        return;
      }
      const preparadas = await onPreparar(transacoes);
      // Já vem marcado o que é saída, é novo e não parece transferência.
      setLinhas(preparadas.map(l => ({ ...l, marcada: !l.credito && !l.jaImportada })));
    } catch (e) {
      setErro("Não consegui ler o arquivo: " + e.message);
    } finally {
      setOcupado(false);
    }
  };

  const visiveis = (linhas || []).filter(l => mostrarCreditos || !l.credito);
  const escolhidas = (linhas || []).filter(l => l.marcada && !l.jaImportada);
  const totalEscolhido = escolhidas.reduce((s, l) => s + Math.abs(Number(l.valor)), 0);
  const repetidas = (linhas || []).filter(l => l.jaImportada).length;

  const mudar = (chave, campo, valor) =>
    setLinhas(ls => ls.map(l => (l.chave === chave ? { ...l, [campo]: valor } : l)));

  const aplicarLote = (catId) => {
    setCatLote(catId);
    if (!catId) return;
    setLinhas(ls => ls.map(l => (l.marcada && !l.jaImportada ? { ...l, categoria_id: catId } : l)));
  };

  const confirmar = async () => {
    setErro(""); setOcupado(true);
    try {
      await onImportar(escolhidas);
    } catch (e) {
      setErro("Falha ao importar: " + e.message);
      setOcupado(false);
    }
  };

  return (
    <Overlay onFechar={onFechar}>
      <h2 style={S.modalTitulo}>Importar extrato</h2>
      <p style={S.modalAjuda}>
        Baixe o extrato em OFX pelo app do banco. O arquivo é lido aqui no seu
        aparelho — nada é enviado antes de você confirmar.
      </p>

      {!linhas ? (
        <>
          <label style={S.dropZone}>
            <Upload size={22} color="var(--texto-5)" />
            <span style={{ fontWeight: 600, color: "var(--texto-2)" }}>Escolher arquivo .ofx</span>
            <span style={{ fontSize: 12, color: "var(--texto-4)" }}>no banco, procure por "OFX" ou "gerenciador financeiro"</span>
            <input type="file" accept=".ofx,.OFX,text/plain" style={{ display: "none" }}
              onChange={e => carregarArquivo(e.target.files?.[0])} />
          </label>
          {ocupado && <div style={S.impInfo}>Lendo o arquivo…</div>}
          {erro && <div style={S.erro}><AlertCircle size={14} /> {erro}</div>}
        </>
      ) : (
        <>
          <div style={S.impBarra}>
            <label style={S.impCheckLabel}>
              <input type="checkbox" checked={mostrarCreditos} onChange={e => setMostrarCreditos(e.target.checked)} />
              mostrar entradas
            </label>
            <select style={{ ...S.select, flex: 1, minWidth: 0 }} value={catLote} onChange={e => aplicarLote(e.target.value)}>
              <option value="">categoria para as marcadas…</option>
              {categorias.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>

          {repetidas > 0 && (
            <div style={S.impInfo}>
              {repetidas} transaç{repetidas > 1 ? "ões já foram importadas" : "ão já foi importada"} antes e {repetidas > 1 ? "estão" : "está"} bloqueada{repetidas > 1 ? "s" : ""}.
            </div>
          )}

          <div style={S.impLista}>
            {visiveis.map(l => (
              <div key={l.chave} style={{ ...S.impLinha, opacity: l.jaImportada ? 0.45 : 1 }}>
                <input type="checkbox" checked={l.marcada && !l.jaImportada} disabled={l.jaImportada}
                  onChange={e => mudar(l.chave, "marcada", e.target.checked)} style={{ marginTop: 3 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={S.impDesc}>{l.desc}</div>
                  <div style={S.impMeta}>
                    dia {l.dia} · {l.mes}
                    {l.jaImportada && " · já importada"}
                  </div>
                  {!l.jaImportada && l.marcada && (
                    <select style={{ ...S.select, marginTop: 6, fontSize: 13, padding: "6px 8px" }}
                      value={l.categoria_id || ""} onChange={e => mudar(l.chave, "categoria_id", e.target.value)}>
                      <option value="">— sem categoria —</option>
                      {categorias.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                    </select>
                  )}
                </div>
                <div style={{ ...S.impValor, color: l.credito ? "var(--verde-claro)" : "var(--texto)" }}>
                  {l.credito ? "+" : ""}{brl(Math.abs(l.valor))}
                </div>
              </div>
            ))}
          </div>

          {erro && <div style={S.erro}><AlertCircle size={14} /> {erro}</div>}

          <div style={S.impResumo}>
            {escolhidas.length} selecionada{escolhidas.length === 1 ? "" : "s"} · {brl(totalEscolhido)}
          </div>
          <div style={S.modalAcoes}>
            <button style={S.btnSec} onClick={() => setLinhas(null)}>Outro arquivo</button>
            <button style={{ ...S.btnPri, opacity: escolhidas.length && !ocupado ? 1 : 0.5 }}
              disabled={!escolhidas.length || ocupado} onClick={confirmar}>
              {ocupado ? "Importando…" : `Importar ${escolhidas.length}`}
            </button>
          </div>
        </>
      )}
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
          <button style={{ ...S.btnCopiar, background: copiado ? "var(--verde-escuro)" : "var(--botao-neutro)" }} onClick={copiar}>
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

function ModalCategorias({ categorias, onFechar, onRemoverCat, onRemoverSub, onRenomearCat, onRenomearSub }) {
  return (
    <Overlay onFechar={onFechar}>
      <h2 style={S.modalTitulo}>Categorias</h2>
      <p style={S.modalAjuda}>
        Toque no nome para corrigir. Renomear é seguro: os gastos acompanham.
      </p>

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
                <input style={S.catNomeCampo} defaultValue={c.nome} aria-label={`Nome de ${c.nome}`}
                  onBlur={e => onRenomearCat(c, e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }} />
                <button style={S.iconBtn} onClick={() => onRemoverCat(c)} aria-label={`Apagar categoria ${c.nome}`}>
                  <Trash2 size={14} />
                </button>
              </div>
              {c.subs?.length > 0 && (
                <div style={S.catChips}>
                  {c.subs.map(s => (
                    <span key={s} style={S.catChip}>
                      <button style={S.catChipNome} title="Renomear"
                        onClick={() => {
                          const novo = window.prompt(`Novo nome para a subcategoria "${s}":`, s);
                          if (novo !== null) onRenomearSub(c, s, novo);
                        }}>{s}</button>
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

function ModalGasto({ categorias, mes, editando, erroExterno, onCriarCategoria, onCriarSub, onFechar, onSalvar }) {
  const nomes = categorias.map(c => c.nome);
  const [nome, setNome] = useState(editando?.nome || "");
  const [valor, setValor] = useState(editando?.valor ?? "");
  const [categoria, setCategoria] = useState(editando?.categoriaNome || nomes[0] || "");
  const [criandoCat, setCriandoCat] = useState(false);
  const [novaCat, setNovaCat] = useState("");
  const [subcategoria, setSubcategoria] = useState(editando?.subcategoria || "");
  const [criandoSub, setCriandoSub] = useState(false);
  const [novaSub, setNovaSub] = useState("");
  const [observacao, setObservacao] = useState(editando?.observacao || "");
  const [data, setData] = useState(() => {
    if (editando?.data) return editando.data;
    const hoje = hojeISO();
    return hoje.slice(0, 7) === mes ? hoje : `${mes}-01`;
  });
  const [parcelas, setParcelas] = useState(editando?.total_parcelas || 1);
  const [modo, setModo] = useState("repetir");   // repetir | dividir
  const [criandoOcupado, setCriandoOcupado] = useState(false);
  const [criandoSubOcupado, setCriandoSubOcupado] = useState(false);
  const [fixo, setFixo] = useState(false);      // repete todo mês, sem fim
  const [erro, setErro] = useState("");

  const catFinal = criandoCat ? novaCat.trim() : categoria;
  const subs = categorias.find(c => c.nome === categoria)?.subs || [];

  // "repetir" = o valor digitado cai em cada mês (assinatura, aluguel).
  // "dividir" = o valor digitado é o total, rateado entre as parcelas (compra em Nx).
  const n = Math.max(1, Number(parcelas) || 1);
  const bruto = Number(valor) || 0;
  const serie = editando?.total_parcelas > 1;
  const mesInicial = serie ? addMeses(editando.mes, -((editando.parcela_atual || 1) - 1)) : null;
  const porMes = modo === "dividir" && n > 1 ? Math.floor((bruto / n) * 100) / 100 : bruto;
  // A sobra de centavos do arredondamento vai toda na última parcela.
  const ultima = modo === "dividir" && n > 1 ? Number((bruto - porMes * (n - 1)).toFixed(2)) : porMes;

  // Cria a categoria na hora, em vez de deixá-la pendurada até o Salvar.
  // Assim ela já aparece na lista e a subcategoria destrava.
  const confirmarCategoria = async () => {
    const n = novaCat.trim();
    if (!n) return;
    setErro(""); setCriandoOcupado(true);
    try {
      const cat = await onCriarCategoria(n);
      setCategoria(cat.nome);
      setSubcategoria("");
      setCriandoCat(false);
      setNovaCat("");
    } catch (e) {
      setErro(e?.message || String(e));
    } finally {
      setCriandoOcupado(false);
    }
  };

  const confirmarSubcategoria = async () => {
    const s = novaSub.trim();
    if (!s) return;
    setErro(""); setCriandoSubOcupado(true);
    try {
      await onCriarSub(categoria, s);
      setSubcategoria(s);
      setCriandoSub(false);
      setNovaSub("");
    } catch (e) {
      setErro(e?.message || String(e));
    } finally {
      setCriandoSubOcupado(false);
    }
  };

  const submeter = () => {
    if (!nome.trim()) return setErro("Dê um nome ao gasto.");
    if (!valor || Number(valor) <= 0) return setErro("Informe um valor maior que zero.");
    if (!catFinal) return setErro("Escolha ou crie uma categoria.");
    if (!data) return setErro("Informe a data do gasto.");
    onSalvar({
      nome: nome.trim(), categoria: catFinal,
      subcategoria: criandoSub ? novaSub.trim() : subcategoria,
      observacao: observacao.trim(), data, fixo,
      valor: porMes, valorUltima: ultima, parcelas,
    });
  };

  return (
    <Overlay onFechar={onFechar}>
      <h2 style={S.modalTitulo}>{editando ? "Editar gasto" : "Novo gasto"}</h2>

      <label style={S.label}>Nome</label>
      <input autoFocus style={S.input} value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex: Aluguel, Internet, Switch…" />

      <label style={S.label}>
        Valor {parcelas > 1 ? (modo === "dividir" ? "(total da compra)" : "(de cada mês)") : ""}
      </label>
      <input type="number" inputMode="decimal" style={S.input} value={valor} onChange={e => setValor(e.target.value)} placeholder="0,00" />

      <label style={S.label}>Data {parcelas > 1 ? "(da primeira parcela)" : ""}</label>
      <input type="date" style={S.input} value={data} onChange={e => setData(e.target.value)}
        min={`${mes}-01`} max={`${mes}-${String(ultimoDia(mes)).padStart(2, "0")}`} />
      <p style={S.dicaCampo}>
        Vem preenchida com hoje. Mude se o gasto foi noutro dia — só dentro de {MESES[parseKey(mes).m]}.
      </p>

      <label style={S.label}>Categoria</label>
      {!criandoCat ? (
        <div style={S.linhaSelect}>
          <select style={S.select} value={categoria} onChange={e => { setCategoria(e.target.value); setSubcategoria(""); }}>
            {nomes.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button style={S.btnMini} onClick={() => setCriandoCat(true)}>+ Nova</button>
        </div>
      ) : (
        <>
          <div style={S.linhaSelect}>
            <input style={S.input} value={novaCat} onChange={e => setNovaCat(e.target.value)}
              onKeyDown={e => e.key === "Enter" && confirmarCategoria()}
              placeholder="Nome da categoria" autoFocus />
            <button style={S.btnMini} onClick={() => { setCriandoCat(false); setNovaCat(""); }}>Cancelar</button>
          </div>
          <button style={{ ...S.btnCriarCat, opacity: novaCat.trim() && !criandoOcupado ? 1 : 0.5 }}
            disabled={!novaCat.trim() || criandoOcupado} onClick={confirmarCategoria}>
            {criandoOcupado ? "Criando…" : `Criar categoria${novaCat.trim() ? ` "${novaCat.trim()}"` : ""}`}
          </button>
        </>
      )}

      <label style={S.label}>Subcategoria <span style={{ color: "var(--texto-4)", fontWeight: 400 }}>(opcional)</span></label>
      {!criandoSub ? (
        <div style={S.linhaSelect}>
          <select style={S.select} value={subcategoria} onChange={e => setSubcategoria(e.target.value)} disabled={criandoCat}>
            <option value="">— nenhuma —</option>
            {subs.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button style={S.btnMini} onClick={() => setCriandoSub(true)} disabled={criandoCat}>+ Nova</button>
        </div>
      ) : (
        <>
          <div style={S.linhaSelect}>
            <input style={S.input} value={novaSub} onChange={e => setNovaSub(e.target.value)}
              onKeyDown={e => e.key === "Enter" && confirmarSubcategoria()}
              placeholder="Nome da subcategoria" autoFocus />
            <button style={S.btnMini} onClick={() => { setCriandoSub(false); setNovaSub(""); }}>Cancelar</button>
          </div>
          <button style={{ ...S.btnCriarCat, opacity: novaSub.trim() && !criandoSubOcupado ? 1 : 0.5 }}
            disabled={!novaSub.trim() || criandoSubOcupado} onClick={confirmarSubcategoria}>
            {criandoSubOcupado ? "Criando…" : `Criar subcategoria${novaSub.trim() ? ` "${novaSub.trim()}"` : ""}`}
          </button>
        </>
      )}

      <label style={S.label}>Observação <span style={{ color: "var(--texto-4)", fontWeight: 400 }}>(opcional)</span></label>
      <textarea style={{ ...S.input, minHeight: 62, resize: "vertical" }} value={observacao}
        onChange={e => setObservacao(e.target.value)} placeholder="Ex: negociado até dezembro, conferir reajuste…" />

      {editando?.fixo_id ? (
        <div style={S.avisoFixo}>
          <Repeat size={14} /> Este lançamento vem de uma conta fixa. Para encerrá-la,
          use <b>Contas fixas</b> no painel.
        </div>
      ) : parcelas === 1 && (
        <label style={S.caixaFixo}>
          <input type="checkbox" checked={fixo} onChange={e => setFixo(e.target.checked)} />
          <b>Repetir todo mês</b>
        </label>
      )}

      {!fixo && (
        <>
          <label style={S.label}>Parcelas</label>
          <div style={S.parcelasRow}>
            <button style={S.stepBtn} onClick={() => setParcelas(p => Math.max(1, p - 1))}>−</button>
            <div style={S.parcelasNum}>{parcelas}x</div>
            <button style={S.stepBtn} onClick={() => setParcelas(p => Math.min(60, p + 1))}>+</button>
          </div>

          {parcelas > 1 && (
            <>
              <div style={S.segmento}>
                <button style={{ ...S.segBtn, ...(modo === "repetir" ? S.segAtivo : {}) }} onClick={() => setModo("repetir")}>
                  Repetir o valor
                </button>
                <button style={{ ...S.segBtn, ...(modo === "dividir" ? S.segAtivo : {}) }} onClick={() => setModo("dividir")}>
                  Dividir o total
                </button>
              </div>
              <div style={S.parcelasInfo}>
                {modo === "repetir"
                  ? `${brl(bruto)} por mês durante ${parcelas} meses — total de ${brl(bruto * n)}.`
                  : `${brl(bruto)} em ${parcelas}x de ${brl(porMes)}${ultima !== porMes ? ` (a última de ${brl(ultima)})` : ""}.`}
              </div>
            </>
          )}
        </>
      )}

      {serie && (
        <div style={S.avisoSerie}>
          Este gasto faz parte de uma série ({editando.parcela_atual}/{editando.total_parcelas}).
          O que você salvar vale para <b>todas as parcelas</b>, recontadas a partir de{" "}
          {MESES[parseKey(mesInicial).m]}/{parseKey(mesInicial).y}. As já marcadas como pagas continuam pagas.
        </div>
      )}

      {(erro || erroExterno) && <div style={S.erro}><AlertCircle size={14} /> {erro || erroExterno}</div>}
      <div style={S.modalAcoes}>
        <button style={S.btnSec} onClick={onFechar}>Cancelar</button>
        <button style={S.btnPri} onClick={submeter}>{editando ? "Salvar" : "Adicionar"}</button>
      </div>
    </Overlay>
  );
}

// ------------------------------------------------------------
//  Caixa de confirmação
//  Fica por cima de qualquer outro modal (a remoção de entrada acontece
//  dentro do modal de renda) e aceita mais de duas saídas — é o que separa
//  "só esta parcela" de "esta e as próximas" sem transformar a pergunta
//  num quebra-cabeça de OK e Cancelar.
// ------------------------------------------------------------
function ModalConfirmar({ titulo, texto, nota, acoes = [], onResponder }) {
  useEffect(() => {
    // Na fase de captura e cortando a propagação: o Esc fecha só esta caixa,
    // não o modal que ficou aberto atrás dela.
    const onEsc = (e) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      onResponder(null);
    };
    window.addEventListener("keydown", onEsc, true);
    return () => window.removeEventListener("keydown", onEsc, true);
  }, [onResponder]);

  const empilhado = acoes.length > 1;

  return (
    <div style={S.overlayConfirma} onClick={() => onResponder(null)}>
      <div style={S.modalConfirma} onClick={e => e.stopPropagation()} role="alertdialog" aria-modal="true">
        <div style={S.confirmaIcone}><AlertCircle size={19} /></div>
        <h2 style={S.confirmaTitulo}>{titulo}</h2>
        {texto && <p style={S.confirmaTexto}>{texto}</p>}
        {nota && <p style={S.confirmaNota}>{nota}</p>}
        <div style={{ ...S.confirmaAcoes, flexDirection: empilhado ? "column" : "row" }}>
          {acoes.map(a => (
            <button key={a.id} style={a.tom === "perigo" ? S.btnPerigo : S.btnPri}
              onClick={() => onResponder(a.id)}>{a.rotulo}</button>
          ))}
          {/* O foco começa em Cancelar: Enter sem querer não apaga nada. */}
          <button style={S.btnSec} onClick={() => onResponder(null)} autoFocus>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------
//  Lixeira
// ------------------------------------------------------------
function ModalLixeira({ onFechar, onPerguntar, onMudou }) {
  const [itens, setItens] = useState(null);   // null = ainda carregando
  const [erro, setErro] = useState("");
  const [nota, setNota] = useState("");
  const [ocupado, setOcupado] = useState("");

  const carregar = useCallback(async () => {
    // Faxina na abertura: o que passou do prazo sai de vez, para a lixeira
    // não virar um segundo banco de dados.
    const limite = new Date(Date.now() - DIAS_LIXEIRA * 864e5).toISOString();
    await supabase.from("lixeira").delete().lt("removido_em", limite);

    const { data, error } = await supabase.from("lixeira").select("*").order("removido_em", { ascending: false });
    if (error) {
      setErro(/relation|does not exist|schema cache/i.test(error.message)
        ? "A tabela da lixeira ainda não existe no banco. Rode o trecho LIXEIRA do schema.sql no SQL Editor do Supabase."
        : "Não consegui abrir a lixeira: " + error.message);
      setItens([]);
      return;
    }
    setItens(data || []);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const rotuloMes = (mes) => { if (!mes) return ""; const p = parseKey(mes); return `${MESES[p.m]}/${p.y}`; };

  const restaurar = async (item) => {
    setOcupado(item.id); setErro(""); setNota("");
    try {
      const semVinculo = await restaurarDaLixeira(item);
      setItens(l => l.filter(i => i.id !== item.id));
      setNota(semVinculo
        ? `"${item.rotulo}" voltou, mas sem os vínculos de categoria e conta fixa — ` +
          `eles não existem mais. Vale conferir o lançamento.`
        : `"${item.rotulo}" voltou para ${rotuloMes(item.mes) || "onde estava"}.`);
      onMudou();
    } catch (e) {
      setErro("Não consegui restaurar: " + (e?.message || e));
    } finally {
      setOcupado("");
    }
  };

  const apagarDeVez = async (item) => {
    const escolha = await onPerguntar({
      titulo: `Apagar "${item.rotulo}" de vez?`,
      texto: "Isto não tem volta: o registro sai da lixeira e não dá mais para restaurar.",
      acoes: [{ id: "apagar", rotulo: "Apagar de vez", tom: "perigo" }],
    });
    if (escolha !== "apagar") return;
    await supabase.from("lixeira").delete().eq("id", item.id);
    setItens(l => l.filter(i => i.id !== item.id));
    setNota(""); setErro("");
  };

  const esvaziar = async () => {
    const escolha = await onPerguntar({
      titulo: "Esvaziar a lixeira?",
      texto: `Os ${itens.length} registros guardados somem de vez, sem volta.`,
      acoes: [{ id: "esvaziar", rotulo: "Esvaziar", tom: "perigo" }],
    });
    if (escolha !== "esvaziar") return;
    await supabase.from("lixeira").delete().gte("removido_em", "1970-01-01T00:00:00Z");
    setItens([]); setNota(""); setErro("");
  };

  return (
    <Overlay onFechar={onFechar}>
      <h2 style={S.modalTitulo}>Lixeira</h2>
      <p style={S.modalAjuda}>
        Tudo que você apaga passa por aqui e fica {DIAS_LIXEIRA} dias antes de
        sumir de vez. Restaurar devolve o registro ao mês de onde ele saiu.
      </p>

      {erro && <div style={S.erro}><AlertCircle size={15} /><span>{erro}</span></div>}
      {nota && <div style={S.lixNota}>{nota}</div>}

      {itens === null ? (
        <div style={S.catVazio}>Carregando…</div>
      ) : itens.length === 0 ? (
        <div style={S.catVazio}>A lixeira está vazia.</div>
      ) : (
        <>
          <div style={S.catLista}>
            {itens.map(item => (
              <div key={item.id} style={S.lixLinha}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={S.lixNome}>{item.rotulo || NOME_TABELA[item.tabela] || "Registro"}</div>
                  <div style={S.lixMeta}>
                    {NOME_TABELA[item.tabela] || item.tabela}
                    {item.mes ? ` · ${rotuloMes(item.mes)}` : ""}
                    {` · apagado em ${dataHora(item.removido_em)}`}
                  </div>
                </div>
                {Number(item.valor) > 0 && <div style={S.lixValor}>{brl(item.valor)}</div>}
                <button style={S.lixRestaurar} disabled={ocupado === item.id} onClick={() => restaurar(item)}>
                  <RotateCcw size={13} /> {ocupado === item.id ? "…" : "Restaurar"}
                </button>
                <button style={S.iconBtn} onClick={() => apagarDeVez(item)}
                  aria-label={`Apagar "${item.rotulo}" de vez`} title="Apagar de vez">
                  <X size={15} />
                </button>
              </div>
            ))}
          </div>
          <button style={S.lixEsvaziar} onClick={esvaziar}>
            <Trash2 size={13} /> Esvaziar a lixeira
          </button>
        </>
      )}

      <div style={S.modalAcoes}>
        <button style={S.btnSec} onClick={onFechar}>Fechar</button>
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

// ============================================================
//  Convite para instalar (PWA)
//  No Chrome/Edge/Android o próprio navegador avisa que dá para instalar, e a
//  gente guarda esse aviso para disparar no nosso botão. No iPhone não existe
//  esse evento — lá só resta ensinar o caminho do menu Compartilhar.
// ============================================================
const CHAVE_DISPENSA = "convite-instalar-dispensado";

// ============================================================
//  Tema claro / escuro
//  As cores vivem em variáveis CSS (index.html); aqui só trocamos o
//  atributo data-tema na raiz, e o navegador repinta tudo sozinho.
// ============================================================
const lerTema = () => {
  try { return localStorage.getItem("tema") === "claro" ? "claro" : "escuro"; }
  catch { return "escuro"; }
};

function BotaoTema() {
  const [tema, setTema] = useState(lerTema);

  useEffect(() => {
    document.documentElement.dataset.tema = tema;
    // A barra do navegador no celular acompanha o fundo do app.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", tema === "claro" ? "#f5f6f9" : "#0a0e16");
    try { localStorage.setItem("tema", tema); } catch { /* navegação privativa */ }
  }, [tema]);

  return (
    <button style={S.btnNav} onClick={() => setTema(t => (t === "claro" ? "escuro" : "claro"))}
      aria-label={tema === "claro" ? "Usar tema escuro" : "Usar tema claro"}
      title={tema === "claro" ? "Tema escuro" : "Tema claro"}>
      {tema === "claro" ? <Moon size={16} /> : <Sun size={16} />}
    </button>
  );
}

// Instrução manual por navegador, para quando o `beforeinstallprompt` não
// existe ou ainda não disparou — o Chrome só o emite depois de algum
// engajamento, e o Firefox nunca o emite.
function dicaInstalacao() {
  const ua = navigator.userAgent;
  const ios = /iphone|ipad|ipod/i.test(ua);
  const android = /android/i.test(ua);
  const firefox = /firefox|fxios/i.test(ua);

  if (ios) return <>Toque em <Share size={12} style={{ verticalAlign: "-2px" }} /> na barra do navegador e depois em <b>Adicionar à Tela de Início</b>.</>;
  if (android) return <>Abra o menu <b>⋮</b> do navegador e toque em <b>Instalar app</b> (ou "Adicionar à tela inicial").</>;
  if (firefox) return <>No Firefox para computador não há instalação. Use o Chrome ou o Edge, ou salve esta página nos favoritos.</>;
  return <>Clique no ícone de instalar na barra de endereço, ou no menu <b>⋮</b> → <b>Instalar</b>.</>;
}

function ConviteInstalar() {
  const [evento, setEvento] = useState(null);
  const [visivel, setVisivel] = useState(false);

  useEffect(() => {
    // Aberto pelo atalho, ou já dispensado: não insiste.
    const instalado = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
    let dispensado = false;
    try { dispensado = localStorage.getItem(CHAVE_DISPENSA) === "1"; } catch { /* navegação privativa */ }
    if (instalado || dispensado) return;

    setVisivel(true);

    // O evento pode ter chegado antes deste componente existir — main.jsx o
    // guarda em window.__promptInstalar justamente para este caso.
    if (window.__promptInstalar) setEvento(window.__promptInstalar);

    const aoPoderInstalar = (e) => { e.preventDefault(); setEvento(e); };
    const aoGuardado = () => setEvento(window.__promptInstalar);
    const aoInstalar = () => { window.__promptInstalar = null; setEvento(null); setVisivel(false); };
    window.addEventListener("beforeinstallprompt", aoPoderInstalar);
    window.addEventListener("prompt-instalar-pronto", aoGuardado);
    window.addEventListener("appinstalled", aoInstalar);
    return () => {
      window.removeEventListener("beforeinstallprompt", aoPoderInstalar);
      window.removeEventListener("prompt-instalar-pronto", aoGuardado);
      window.removeEventListener("appinstalled", aoInstalar);
    };
  }, []);

  const dispensar = () => {
    try { localStorage.setItem(CHAVE_DISPENSA, "1"); } catch { /* ignora */ }
    setVisivel(false);
  };

  const instalar = async () => {
    if (!evento) return;
    evento.prompt();
    await evento.userChoice;   // aceitando ou não, não insistimos de novo
    window.__promptInstalar = null;   // o evento só pode ser usado uma vez
    dispensar();
  };

  if (!visivel) return null;

  return (
    <div style={S.convite}>
      <div style={S.conviteIcone}><Download size={17} color="var(--verde)" /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={S.conviteTitulo}>Instalar no aparelho</div>
        <div style={S.conviteTexto}>
          {evento ? "Cria um atalho e abre em tela cheia, como um aplicativo." : dicaInstalacao()}
        </div>
      </div>
      {evento && <button style={S.conviteBtn} onClick={instalar}>Instalar</button>}
      <button style={S.iconBtn} onClick={dispensar} aria-label="Dispensar"><X size={16} /></button>
    </div>
  );
}

// Mostrado no lugar do painel quando os dados não puderam ser carregados.
// Nunca mostramos os cards zerados nessa situação: R$ 0,00 em toda parte
// é indistinguível de um mês realmente vazio.
function SemDados({ offline, onTentar }) {
  return (
    <div style={S.semDados}>
      <div style={S.semDadosIcone}><CloudOff size={26} color="var(--texto-4)" /></div>
      <p style={S.semDadosTitulo}>
        {offline ? "Você está sem conexão" : "Não consegui falar com o servidor"}
      </p>
      <p style={S.semDadosTexto}>
        Seus gastos estão salvos e intactos — só não dá para carregá-los agora.
        {offline
          ? " Assim que a internet voltar, o app se atualiza sozinho."
          : " Pode ser instabilidade momentânea; tente de novo em alguns instantes."}
      </p>
      <button style={S.semDadosBtn} onClick={onTentar}>
        <RefreshCw size={14} /> Tentar de novo
      </button>
    </div>
  );
}

// A folha impressa. Fica escondida na tela e só aparece no @media print, com
// cores fixas (preto no branco) — o tema da interface não vale aqui.
function FolhaImpressao({ mes, renda, entradas, gastos, catPorId, totais }) {
  const { y, m } = parseKey(mes);
  const grupos = {};
  gastos.forEach(g => {
    const nome = catPorId[g.categoria_id]?.nome || "Sem categoria";
    (grupos[nome] ||= []).push(g);
  });

  return (
    <div id="folha">
      <h1 style={{ fontSize: "17pt", marginBottom: 2 }}>Contas de {MESES[m]} de {y}</h1>
      <p style={{ fontSize: "9pt", color: "#666", marginBottom: 16 }}>
        ControlMoney · gerado em {ddmm(hojeISO())}/{new Date().getFullYear()}
      </p>

      <table style={{ marginBottom: 18 }}>
        <tbody>
          <tr><td>Entradas do mês</td><td className="n">{brl(renda)}</td></tr>
          <tr><td>Total de gastos</td><td className="n">{brl(totais.total)}</td></tr>
          <tr><td>Já pago</td><td className="n">{brl(totais.pago)}</td></tr>
          <tr><td>Falta pagar</td><td className="n">{brl(totais.pendente)}</td></tr>
          <tr><td><b>{totais.saldo >= 0 ? "Sobra" : "Falta"}</b></td>
              <td className="n"><b>{brl(Math.abs(totais.saldo))}</b></td></tr>
        </tbody>
      </table>

      {entradas.length > 0 && (
        <div className="grupo" style={{ marginBottom: 18 }}>
          <h2 style={{ fontSize: "11pt", marginBottom: 4 }}>Entradas</h2>
          <table>
            <tbody>
              {entradas.map(e => (
                <tr key={e.id}>
                  <td style={{ width: "14%" }}>{e.data ? ddmm(e.data) : ""}</td>
                  <td>{e.descricao || "Entrada avulsa"}</td>
                  <td className="n">{brl(e.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {Object.entries(grupos).map(([nome, itens]) => {
        const sub = itens.reduce((s, g) => s + Number(g.valor || 0), 0);
        const pct = renda > 0 ? ` · ${pctTxt((sub / renda) * 100)} da renda` : "";
        return (
          <div key={nome} className="grupo" style={{ marginBottom: 16 }}>
            <h2 style={{ fontSize: "11pt", marginBottom: 4 }}>
              {nome} — {brl(sub)}<span style={{ fontWeight: 400, color: "#666" }}>{pct}</span>
            </h2>
            <table>
              <thead>
                <tr><th style={{ width: "13%" }}>Dia</th><th>Gasto</th>
                    <th style={{ width: "14%" }}>Pago</th><th className="n" style={{ width: "20%" }}>Valor</th></tr>
              </thead>
              <tbody>
                {itens.map(g => (
                  <tr key={g.id}>
                    <td>{g.data ? ddmm(g.data) : "—"}</td>
                    <td>
                      {g.nome}
                      {g.total_parcelas > 1 && ` (${g.parcela_atual}/${g.total_parcelas})`}
                      {g.subcategoria && <span style={{ color: "#666" }}> · {g.subcategoria}</span>}
                      {g.observacao && <div style={{ fontSize: "9pt", color: "#666" }}>{g.observacao}</div>}
                    </td>
                    <td>{g.pago ? "sim" : "não"}</td>
                    <td className="n">{brl(g.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

// O símbolo do ControlMoney, servido de public/. Sem o texto do logo: ele
// apareceria ilegível a 24px e repetiria o nome que já vem escrito ao lado.
function Marca({ tamanho = 24 }) {
  return (
    <img src={`${import.meta.env.BASE_URL}marca.png`} width={tamanho} height={tamanho}
      alt="" style={{ borderRadius: tamanho * 0.28, display: "block", flexShrink: 0 }} />
  );
}

function Tela({ children }) { return <div style={S.tela}>{children}</div>; }

// ---------- estilos ----------
const S = {
  tela: { minHeight: "100vh", background: "var(--fundo)", color: "var(--texto)", fontFamily: "'Inter', system-ui, -apple-system, sans-serif", paddingBottom: 96 },
  centro: { textAlign: "center", paddingTop: 140, color: "var(--texto-4)" },
  wrap: { maxWidth: 720, margin: "0 auto", padding: "20px 16px 0" },

  loginWrap: { maxWidth: 380, margin: "0 auto", padding: "80px 20px 0" },
  loginSub: { color: "var(--texto-4)", fontSize: 14, margin: "8px 0 28px" },
  btnGoogle: { display: "flex", alignItems: "center", justifyContent: "center", gap: 10, width: "100%", background: "#ffffff", border: "1px solid var(--borda-2)", borderRadius: 10, padding: "12px", color: "#1f2937", fontSize: 15, fontWeight: 600, cursor: "pointer" },
  divisor: { display: "flex", alignItems: "center", gap: 12, margin: "20px 0 4px", color: "var(--texto-5)", fontSize: 12 },
  divisorLinha: { flex: 1, height: 1, background: "var(--borda)" },
  linkBtn: { display: "block", width: "100%", textAlign: "center", background: "transparent", border: "none", color: "var(--azul)", fontSize: 14, marginTop: 16, cursor: "pointer" },

  header: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 18 },
  marca: { display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 17, letterSpacing: "-0.01em" },
  btnNav: { width: 34, height: 34, borderRadius: 9, border: "1px solid var(--borda)", background: "var(--superficie)", color: "var(--texto-2)", display: "grid", placeItems: "center", cursor: "pointer" },
  mesLabel: { minWidth: 118, textAlign: "center", fontWeight: 600, fontSize: 15 },

  heroSaldo: { border: "1px solid", borderRadius: 18, padding: "20px 22px", background: "linear-gradient(160deg,var(--modal),var(--modal2))", marginBottom: 14 },
  heroTopo: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  heroLabel: { fontSize: 13, color: "var(--texto-3)", fontWeight: 500 },
  rendaBtn: { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--texto-3)", background: "transparent", border: "1px solid var(--borda)", padding: "4px 9px", borderRadius: 8, cursor: "pointer" },
  heroValor: { fontSize: 42, fontWeight: 800, letterSpacing: "-0.03em", margin: "6px 0 14px", fontVariantNumeric: "tabular-nums" },
  barraWrap: { display: "flex", flexDirection: "column", gap: 6 },
  barra: { height: 6, background: "var(--campo-borda)", borderRadius: 99, overflow: "hidden" },
  barraFill: { height: "100%", background: "linear-gradient(90deg,var(--verde),var(--verde-claro))", borderRadius: 99, transition: "width .3s ease" },
  barraTxt: { fontSize: 11.5, color: "var(--texto-4)" },

  resumo: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 22 },
  resumoCard: { background: "var(--modal)", border: "1px solid var(--campo-borda)", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 3 },
  resumoLabel: { fontSize: 11.5, color: "var(--texto-4)" },
  resumoVal: { fontSize: 16, fontWeight: 700, fontVariantNumeric: "tabular-nums" },

  barraOrdem: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 7, marginBottom: 10 },
  barraOrdemRotulo: { fontSize: 12, color: "var(--texto-5)" },
  selectOrdem: { background: "var(--superficie)", border: "1px solid var(--borda)", borderRadius: 8, padding: "5px 8px", color: "var(--texto-3)", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" },

  lista: { display: "flex", flexDirection: "column", gap: 20 },
  vazio: { textAlign: "center", padding: "48px 20px", color: "var(--texto-4)", border: "1px dashed var(--borda)", borderRadius: 14 },
  grupo: { display: "flex", flexDirection: "column", gap: 7 },
  grupoHead: { display: "flex", alignItems: "center", gap: 8, padding: "0 4px 2px" },
  dot: { width: 9, height: 9, borderRadius: 99, flexShrink: 0 },
  grupoNome: { fontWeight: 700, fontSize: 14, flex: 1, letterSpacing: "-0.01em" },
  grupoPct: { fontSize: 11, fontWeight: 600, color: "var(--texto-4)", background: "var(--superficie-2)", border: "1px solid var(--borda)", borderRadius: 99, padding: "1px 7px", fontVariantNumeric: "tabular-nums" },
  grupoTotal: { fontSize: 13, color: "var(--texto-3)", fontWeight: 600, fontVariantNumeric: "tabular-nums" },

  item: { display: "flex", alignItems: "center", gap: 11, padding: "11px 13px", borderRadius: 12, border: "1px solid", transition: "background .15s" },
  check: { width: 24, height: 24, borderRadius: 7, border: "2px solid", cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0, transition: "all .15s" },
  itemNome: { fontWeight: 600, fontSize: 14.5, display: "flex", alignItems: "center", gap: 7, minWidth: 0 },
  itemNomeTexto: { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 },
  parcela: { fontSize: 11, fontWeight: 700, color: "var(--fundo)", background: "var(--texto-3)", padding: "1px 6px", borderRadius: 6, flexShrink: 0 },
  itemSub: { fontSize: 12, color: "var(--texto-4)", marginTop: 1 },
  itemData: { fontVariantNumeric: "tabular-nums", color: "var(--texto-3)" },
  dicaCampo: { fontSize: 11.5, color: "var(--texto-4)", marginTop: 5, lineHeight: 1.45 },
  itemObs: { fontSize: 12, color: "var(--ambar-texto)", marginTop: 3, lineHeight: 1.45, overflowWrap: "anywhere" },
  itemValor: { fontWeight: 700, fontSize: 14.5, fontVariantNumeric: "tabular-nums", flexShrink: 0 },
  iconBtn: { width: 28, height: 28, borderRadius: 7, border: "none", background: "transparent", color: "var(--texto-5)", cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0 },

  fab: { position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", display: "inline-flex", alignItems: "center", gap: 7, background: "var(--verde)", color: "var(--sobre-verde)", fontWeight: 700, fontSize: 15, border: "none", borderRadius: 99, padding: "13px 22px", cursor: "pointer", boxShadow: "0 8px 24px rgba(34,197,94,0.35)" },

  semDados: { textAlign: "center", padding: "40px 22px", border: "1px dashed var(--borda)", borderRadius: 16, background: "var(--superficie-2)" },
  semDadosIcone: { display: "grid", placeItems: "center", width: 54, height: 54, borderRadius: 99, background: "var(--recuo)", margin: "0 auto 14px" },
  semDadosTitulo: { fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em", marginBottom: 7 },
  semDadosTexto: { fontSize: 13.5, color: "var(--texto-4)", lineHeight: 1.55, maxWidth: 340, margin: "0 auto" },
  semDadosBtn: { display: "inline-flex", alignItems: "center", gap: 7, marginTop: 18, background: "var(--botao-neutro)", border: "1px solid var(--borda)", borderRadius: 10, padding: "10px 16px", color: "var(--texto-2)", fontSize: 14, fontWeight: 600, cursor: "pointer" },

  convite: { display: "flex", alignItems: "center", gap: 11, background: "var(--superficie-2)", border: "1px solid var(--borda)", borderRadius: 12, padding: "11px 10px 11px 13px", marginBottom: 14 },
  conviteIcone: { display: "grid", placeItems: "center", width: 34, height: 34, borderRadius: 9, background: "rgba(34,197,94,0.12)", flexShrink: 0 },
  conviteTitulo: { fontSize: 14, fontWeight: 700, letterSpacing: "-0.01em" },
  conviteTexto: { fontSize: 12, color: "var(--texto-4)", marginTop: 2, lineHeight: 1.45 },
  conviteBtn: { background: "var(--verde)", border: "none", borderRadius: 9, padding: "8px 13px", color: "var(--sobre-verde)", fontSize: 13, fontWeight: 700, cursor: "pointer", flexShrink: 0 },

  linhaSecundaria: { display: "flex", gap: 8, marginTop: -8, marginBottom: 18 },
  btnSecundario: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "transparent", border: "1px dashed var(--borda)", borderRadius: 12, padding: "10px 6px", color: "var(--texto-4)", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  seloFixa: { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--azul)", background: "color-mix(in srgb, var(--azul) 14%, transparent)", borderRadius: 99, padding: "1px 6px", flexShrink: 0 },
  avisoFixo: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 18, fontSize: 12.5, lineHeight: 1.5, color: "var(--azul)", background: "color-mix(in srgb, var(--azul) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--azul) 28%, transparent)", borderRadius: 11, padding: "10px 12px" },
  caixaFixo: { display: "flex", alignItems: "center", gap: 10, marginTop: 18, background: "var(--recuo)", border: "1px solid var(--borda)", borderRadius: 11, padding: "12px 13px", fontSize: 14, cursor: "pointer" },
  fixoLinha: { display: "flex", alignItems: "center", gap: 9, border: "1px solid var(--borda)", background: "var(--superficie)", borderRadius: 11, padding: "10px 8px 10px 12px" },
  fixoNome: { fontSize: 14, fontWeight: 600, overflowWrap: "anywhere" },
  fixoMeta: { fontSize: 11.5, color: "var(--texto-4)", marginTop: 2 },
  aPreencher: { fontSize: 11.5, fontWeight: 700, color: "var(--ambar)", background: "color-mix(in srgb, var(--ambar) 13%, transparent)", border: "1px solid color-mix(in srgb, var(--ambar) 30%, transparent)", borderRadius: 99, padding: "3px 9px", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 },
  fixoDiaRotulo: { fontSize: 11.5, color: "var(--texto-5)" },
  fixoCampo: { width: 78, background: "var(--campo)", border: "1px solid var(--campo-borda)", borderRadius: 8, padding: "6px 8px", color: "var(--texto)", fontSize: 13, fontVariantNumeric: "tabular-nums" },
  fixoDia: { width: 52, background: "var(--campo)", border: "1px solid var(--campo-borda)", borderRadius: 8, padding: "6px 8px", color: "var(--texto)", fontSize: 13, textAlign: "center" },

  btnImportar: { display: "flex", alignItems: "center", justifyContent: "center", gap: 7, width: "100%", marginTop: -8, marginBottom: 18, background: "transparent", border: "1px dashed var(--borda)", borderRadius: 12, padding: "10px", color: "var(--texto-4)", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  dropZone: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, textAlign: "center", border: "1px dashed var(--borda-2)", borderRadius: 12, padding: "30px 18px", cursor: "pointer", background: "var(--recuo)" },
  impBarra: { display: "flex", alignItems: "center", gap: 10, marginBottom: 10 },
  impCheckLabel: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--texto-3)", whiteSpace: "nowrap", cursor: "pointer" },
  impInfo: { fontSize: 12, color: "var(--texto-3)", background: "var(--superficie-2)", border: "1px solid var(--borda)", borderRadius: 9, padding: "8px 11px", marginBottom: 10 },
  impLista: { display: "flex", flexDirection: "column", gap: 7, maxHeight: "44vh", overflowY: "auto", margin: "0 -4px", padding: "0 4px" },
  impLinha: { display: "flex", alignItems: "flex-start", gap: 10, border: "1px solid var(--borda)", background: "var(--superficie)", borderRadius: 10, padding: "9px 11px" },
  impDesc: { fontSize: 13.5, fontWeight: 600, overflowWrap: "anywhere" },
  impMeta: { fontSize: 11, color: "var(--texto-4)", marginTop: 2 },
  impValor: { fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
  impResumo: { fontSize: 13, color: "var(--texto-3)", textAlign: "right", marginTop: 12 },

  btnAnalise: { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", marginBottom: 18, background: "var(--superficie-2)", border: "1px solid var(--borda)", borderRadius: 12, padding: "11px", color: "var(--texto-2)", fontSize: 14, fontWeight: 600, cursor: "pointer" },
  selo: { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--verde-claro)", background: "rgba(34,197,94,0.14)", border: "1px solid rgba(34,197,94,0.35)", borderRadius: 99, padding: "1px 7px" },
  entradaLinha: { display: "flex", alignItems: "center", gap: 9, border: "1px solid var(--borda)", background: "var(--superficie)", borderRadius: 11, padding: "9px 8px 9px 12px" },
  entradaDesc: { fontSize: 14, fontWeight: 600, overflowWrap: "anywhere" },
  entradaValor: { fontSize: 13.5, fontWeight: 700, color: "var(--verde-claro)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
  entradaForm: { display: "flex", gap: 8, marginTop: 10 },
  entradaTotal: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--borda)", fontSize: 14, color: "var(--texto-3)" },

  passo: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "var(--texto-3)", margin: "18px 0 8px" },
  passoNum: { display: "grid", placeItems: "center", width: 19, height: 19, borderRadius: 99, background: "var(--borda)", color: "var(--texto-2)", fontSize: 11, fontWeight: 700, flexShrink: 0 },
  resumoBox: { width: "100%", background: "var(--recuo)", border: "1px solid var(--borda)", borderRadius: 10, padding: "10px 12px", color: "var(--texto-3)", fontSize: 12, lineHeight: 1.5, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", resize: "vertical" },
  btnCopiar: { display: "flex", alignItems: "center", justifyContent: "center", gap: 7, width: "100%", marginTop: 8, border: "1px solid var(--borda)", borderRadius: 10, padding: "11px", color: "var(--texto)", fontSize: 14, fontWeight: 600, cursor: "pointer", transition: "background 0.15s" },
  btnClaude: { display: "flex", alignItems: "center", justifyContent: "center", gap: 7, width: "100%", background: "#c96442", border: "none", borderRadius: 10, padding: "11px", color: "#fff", fontSize: 14, fontWeight: 600, textDecoration: "none", cursor: "pointer" },
  analiseBox: { background: "var(--recuo)", border: "1px solid var(--borda)", borderRadius: 10, padding: "12px 14px", color: "var(--texto-2)", fontSize: 13.5, lineHeight: 1.6, whiteSpace: "pre-wrap", maxHeight: "50vh", overflowY: "auto" },

  catLista: { display: "flex", flexDirection: "column", gap: 8, maxHeight: "50vh", overflowY: "auto", margin: "0 -4px", padding: "0 4px" },
  catLinha: { border: "1px solid var(--borda)", borderRadius: 11, padding: "10px 8px 10px 12px", background: "var(--superficie)" },
  catTopo: { display: "flex", alignItems: "center", gap: 9 },
  catNomeCampo: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: 600, color: "var(--texto)", background: "transparent", border: "1px solid transparent", borderRadius: 7, padding: "3px 6px", marginLeft: -6, outline: "none", fontFamily: "inherit" },
  catChipNome: { background: "transparent", border: "none", color: "inherit", font: "inherit", cursor: "pointer", padding: 0 },
  catChips: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 9, paddingLeft: 18 },
  catChip: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--texto-3)", background: "var(--recuo)", border: "1px solid var(--borda)", borderRadius: 99, padding: "3px 4px 3px 10px" },
  catChipX: { display: "grid", placeItems: "center", width: 17, height: 17, borderRadius: 99, border: "none", background: "transparent", color: "var(--texto-4)", cursor: "pointer" },
  catVazio: { fontSize: 13, color: "var(--texto-4)", border: "1px dashed var(--borda)", borderRadius: 11, padding: "18px 14px", textAlign: "center" },

  // Tarja de desfazer: acima do botão de novo gasto, para não tapar nem ser tapada.
  tarja: { position: "fixed", bottom: 78, left: "50%", transform: "translateX(-50%)", zIndex: 40, display: "flex", alignItems: "center", gap: 10, width: "calc(100% - 32px)", maxWidth: 420, boxSizing: "border-box", background: "var(--modal)", border: "1px solid var(--borda-2)", borderRadius: 12, padding: "10px 8px 10px 14px", boxShadow: "0 10px 30px var(--sombra)" },
  tarjaTexto: { flex: 1, minWidth: 0, fontSize: 13, color: "var(--texto-2)", lineHeight: 1.4, overflowWrap: "anywhere" },
  tarjaBtn: { display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0, background: "var(--botao-neutro)", border: "1px solid var(--borda)", borderRadius: 9, padding: "7px 11px", color: "var(--texto)", fontSize: 13, fontWeight: 700, cursor: "pointer" },
  tarjaX: { width: 26, height: 26, borderRadius: 7, border: "none", background: "transparent", color: "var(--texto-5)", cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0 },

  overlayConfirma: { position: "fixed", inset: 0, background: "var(--sombra)", backdropFilter: "blur(4px)", display: "grid", placeItems: "center", padding: 16, zIndex: 60 },
  modalConfirma: { width: "100%", maxWidth: 380, background: "var(--recuo)", border: "1px solid var(--borda-2)", borderRadius: 18, padding: "22px 22px 20px", boxShadow: "0 20px 50px var(--sombra)" },
  confirmaIcone: { display: "grid", placeItems: "center", width: 38, height: 38, borderRadius: 11, background: "color-mix(in srgb, var(--vermelho) 14%, transparent)", color: "var(--vermelho)", marginBottom: 13 },
  confirmaTitulo: { margin: "0 0 6px", fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.3, overflowWrap: "anywhere" },
  confirmaTexto: { margin: 0, fontSize: 13.5, color: "var(--texto-3)", lineHeight: 1.5, overflowWrap: "anywhere" },
  confirmaNota: { margin: "10px 0 0", fontSize: 12, color: "var(--texto-4)", lineHeight: 1.45 },
  confirmaAcoes: { display: "flex", gap: 9, marginTop: 20 },
  btnPerigo: { flex: 1, background: "var(--vermelho)", border: "none", borderRadius: 10, padding: "12px", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer" },

  lixLinha: { display: "flex", alignItems: "center", gap: 8, border: "1px solid var(--borda)", background: "var(--superficie)", borderRadius: 11, padding: "9px 8px 9px 12px" },
  lixNome: { fontSize: 14, fontWeight: 600, overflowWrap: "anywhere" },
  lixMeta: { fontSize: 11, color: "var(--texto-4)", marginTop: 2 },
  lixValor: { fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", flexShrink: 0 },
  lixRestaurar: { display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0, background: "var(--botao-neutro)", border: "1px solid var(--borda)", borderRadius: 9, padding: "6px 10px", color: "var(--texto)", fontSize: 12.5, fontWeight: 700, cursor: "pointer" },
  lixNota: { fontSize: 12.5, lineHeight: 1.5, color: "var(--verde-claro)", background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: 10, padding: "9px 11px", marginBottom: 12 },
  lixEsvaziar: { display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%", marginTop: 12, background: "transparent", border: "1px dashed var(--borda)", borderRadius: 10, padding: "9px", color: "var(--texto-5)", fontSize: 12.5, fontWeight: 600, cursor: "pointer" },

  overlay: { position: "fixed", inset: 0, background: "var(--sombra)", backdropFilter: "blur(4px)", display: "grid", placeItems: "center", padding: 16, zIndex: 50 },
  modal: { position: "relative", width: "100%", maxWidth: 420, maxHeight: "90vh", overflowY: "auto", background: "var(--recuo)", border: "1px solid var(--borda)", borderRadius: 18, padding: "24px 22px" },
  fechar: { position: "absolute", top: 14, right: 14, width: 32, height: 32, borderRadius: 8, border: "none", background: "var(--campo)", color: "var(--texto-3)", cursor: "pointer", display: "grid", placeItems: "center" },
  modalTitulo: { margin: "0 0 4px", fontSize: 19, fontWeight: 700, letterSpacing: "-0.02em" },
  modalAjuda: { margin: "0 0 16px", fontSize: 13, color: "var(--texto-4)" },

  label: { display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--texto-3)", margin: "14px 0 6px" },
  input: { width: "100%", boxSizing: "border-box", background: "var(--superficie)", border: "1px solid var(--borda)", borderRadius: 10, padding: "11px 13px", color: "var(--texto)", fontSize: 15, outline: "none" },
  select: { flex: 1, background: "var(--superficie)", border: "1px solid var(--borda)", borderRadius: 10, padding: "11px 13px", color: "var(--texto)", fontSize: 15, outline: "none", cursor: "pointer" },
  linhaSelect: { display: "flex", gap: 8 },
  btnMini: { flexShrink: 0, background: "var(--campo)", border: "1px solid var(--borda)", borderRadius: 10, padding: "0 14px", color: "var(--texto-2)", fontSize: 13, fontWeight: 600, cursor: "pointer" },

  parcelasRow: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  stepBtn: { width: 40, height: 40, borderRadius: 10, border: "1px solid var(--borda)", background: "var(--superficie)", color: "var(--texto)", fontSize: 22, cursor: "pointer", lineHeight: 1 },
  parcelasNum: { minWidth: 48, textAlign: "center", fontSize: 18, fontWeight: 700, fontVariantNumeric: "tabular-nums" },
  parcelasInfo: { fontSize: 12, color: "var(--texto-4)", flexBasis: "100%", marginTop: 8, lineHeight: 1.5 },
  avisoSerie: { fontSize: 12, lineHeight: 1.55, color: "var(--ambar)", background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)", borderRadius: 10, padding: "9px 11px", marginTop: 18 },
  btnCriarCat: { width: "100%", marginTop: 8, background: "var(--botao-neutro)", border: "1px solid var(--borda)", borderRadius: 10, padding: "10px", color: "var(--texto)", fontSize: 14, fontWeight: 600, cursor: "pointer" },
  segmento: { display: "flex", gap: 6, marginTop: 10, background: "var(--recuo)", border: "1px solid var(--borda)", borderRadius: 10, padding: 3 },
  segBtn: { flex: 1, background: "transparent", border: "none", borderRadius: 8, padding: "8px 6px", color: "var(--texto-4)", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  segAtivo: { background: "var(--borda)", color: "var(--texto)" },

  erro: { display: "flex", alignItems: "center", gap: 6, color: "var(--vermelho)", fontSize: 13, marginTop: 14 },
  // Grudados no rodapé: o formulário de gasto ficou longo e, no celular, os
  // botões sumiam abaixo da dobra — parecia que não havia como confirmar.
  modalAcoes: { display: "flex", gap: 10, position: "sticky", bottom: -24, zIndex: 2, background: "var(--recuo)", borderTop: "1px solid var(--borda)", margin: "22px -22px -24px", padding: "12px 22px 24px" },
  btnSec: { flex: 1, background: "transparent", border: "1px solid var(--borda)", borderRadius: 10, padding: "12px", color: "var(--texto-2)", fontSize: 15, fontWeight: 600, cursor: "pointer" },
  btnPri: { flex: 1, background: "var(--verde)", border: "none", borderRadius: 10, padding: "12px", color: "var(--sobre-verde)", fontSize: 15, fontWeight: 700, cursor: "pointer" },
};
