# ControlMoney

App de controle de gastos mensais com backend Supabase (Postgres + Auth),
sincronizado entre celular e computador. React + Vite.

No ar em **https://danielvduarte.github.io/ControlMoney/**

> Este README explica como montar o projeto do zero. Para o que já está
> configurado nesta instalação — endereços, decisões e solução de problemas —
> veja **[SETUP.md](SETUP.md)**.

## O que faz

- Login por e-mail/senha ou conta Google; cada usuário só vê os próprios dados (RLS no Postgres).
- Gastos por categoria e subcategoria — criáveis na hora ao lançar, e
  renomeáveis ou apagáveis pelo botão de categorias no cabeçalho.
- **Contas fixas** (água, luz, internet, aluguel): marque "Repetir todo mês" ao
  lançar e todo mês novo já nasce com ela — **zerada**, marcada como
  "a preencher", para você registrar o que a conta trouxe de fato em vez de
  herdar um valor antigo. Ao encerrar uma (comprou a casa, acabou o aluguel), o
  histórico fica intacto e o app se oferece para limpar os lançamentos futuros
  ainda não pagos.
- Parcelamento em N meses, com duas formas: **repetir** o valor todo mês
  (aluguel, assinatura) ou **dividir** um total em N parcelas (compra em 3x) —
  aí a última parcela absorve a sobra dos centavos.
- Data do gasto: vem preenchida com hoje e dá para recuar, para quando você
  lembra dias depois. A lista fica ordenada por data.
- Marcar como pago (fica verde); resumo de pago / falta pagar.
- Observação livre por gasto ("negociado até dezembro", "conferir reajuste"),
  que aparece na lista e vai junto no resumo levado ao Claude.
- Editar um gasto parcelado corrige a série inteira — dá para consertar
  "esqueci que eram 5x" ou "digitei o total" sem apagar e refazer.
- Renda por mês, com o saldo (sobra) calculado em cima dela — e **entradas
  avulsas** (freela, reembolso, venda) somadas à renda fixa, cada uma com
  valor, data e de onde veio.
- **Exportar em PDF**: botão que abre a impressão do navegador com uma folha
  limpa do mês, pronta para salvar em PDF ou imprimir.
- Quanto cada categoria consumiu da renda, em porcentagem (aparece quando há
  renda informada no mês).
- Navegação por mês — cada mês é independente, dá para voltar e ver o que ficou pendente.
- Tema claro ou escuro, num botão no cabeçalho; a escolha fica salva no aparelho.
- Instalável como app (PWA). Sem internet ele abre, mas avisa que não conseguiu
  carregar os dados em vez de mostrar o mês vazio — e recarrega sozinho quando
  a conexão volta.
- Sync em tempo real: alterar num aparelho reflete no outro.
- **Importar extrato (OFX)**: lê o arquivo do banco no próprio navegador, mostra
  as transações para você marcar categoria e confirmar, e ignora o que já foi
  importado antes. Nada sobe para o servidor sem a sua confirmação.
- **Analisar no Claude**: monta um resumo do mês (categorias, porcentagens,
  parcelas em aberto, comparativo com os meses anteriores) para você colar no
  Claude e trazer a resposta de volta, guardada naquele mês. Funciona na conta
  gratuita — o app não chama nenhuma API nem envia seus dados para lugar algum.

---

## 1. Criar o backend no Supabase

1. Em https://supabase.com crie um projeto (free tier serve). Anote a senha do banco.
2. No painel, vá em **SQL Editor** → cole todo o conteúdo de `schema.sql` → **Run**.
   Isso cria as tabelas, ativa RLS, as policies por usuário e o gatilho que
   cadastra a categoria inicial (Casa) em cada conta nova — o resto você cria
   conforme lança os gastos.
3. Em **Project Settings → API Keys**, copie:
   - **Project URL** (em *Data API*) → vai em `VITE_SUPABASE_URL`.
     É só o domínio, sem o `/rest/v1/` do fim.
   - **Publishable key** (`sb_publishable_…`) → vai em `VITE_SUPABASE_ANON_KEY`.
     Em projetos antigos ela aparece como *anon public* (um `eyJ…`); as duas
     funcionam. A **secret key** não: ela ignora o RLS e nunca vai para o front.
4. (Opcional, recomendado para uso pessoal) Em **Authentication → Providers → Email**,
   você pode desligar "Confirm email" para entrar direto sem confirmar por link.
   Se mantiver ligado, confirme pelo e-mail antes do primeiro login.

### 1.1 Ativar o login com Google

O botão "Entrar com Google" já existe na tela de login, mas só funciona depois
de ligar o provider. São duas partes: criar a credencial no Google e colar no
Supabase.

**No Google Cloud Console** (https://console.cloud.google.com):

1. Crie (ou escolha) um projeto.
2. **APIs & Services → OAuth consent screen**: tipo **External**, preencha nome do
   app, e-mail de suporte e e-mail do desenvolvedor. Enquanto o app estiver em
   "Testing", adicione seu Gmail em **Test users** — ou publique o app.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**,
   tipo **Web application**. Em **Authorized redirect URIs**, cole a callback do
   Supabase (ela aparece pronta no painel do Supabase, em
   Authentication → Providers → Google):

   ```
   https://SEU-PROJETO.supabase.co/auth/v1/callback
   ```

4. Copie o **Client ID** e o **Client secret**.

**No Supabase** (Authentication → Providers → **Google**):

5. Ative o provider, cole Client ID e Client secret, salve.
6. Em **Authentication → URL Configuration**, ajuste:
   - **Site URL**: `https://danielvduarte.github.io/ControlMoney/`
   - **Redirect URLs**: adicione `https://danielvduarte.github.io/ControlMoney/**`
     e, se for rodar local algum dia, `http://localhost:5173/**`.

Sem o passo 6 o Google devolve o usuário para a Site URL errada depois do login.

> Essa chave é pública por design — ela vai no bundle do front, legível por
> qualquer um. A segurança vem do RLS: sem uma sessão válida, as policies não
> retornam nenhuma linha.

## 2. Publicar no GitHub Pages

O build roda no GitHub Actions — você **não precisa de Node instalado**. O
workflow em `.github/workflows/deploy.yml` compila e publica a cada `push` na
branch `main`.

Configure uma vez, no repositório (github.com/DanielvDuarte/ControlMoney):

1. **Settings → Pages → Build and deployment → Source**: escolha
   **GitHub Actions** (não "Deploy from a branch").
2. **Settings → Secrets and variables → Actions → aba Variables →
   New repository variable**, duas vezes:
   - `VITE_SUPABASE_URL` = a Project URL do Supabase
   - `VITE_SUPABASE_ANON_KEY` = a anon public key
3. Dê `git push` (ou rode o workflow na mão em **Actions → Deploy no GitHub
   Pages → Run workflow**). Ao terminar, o app fica em:

   ```
   https://danielvduarte.github.io/ControlMoney/
   ```

> O GitHub Pages em conta gratuita exige **repositório público**. O código fica
> visível, o que aqui é inofensivo: a anon key é pública por design e os dados
> são protegidos pelo RLS. Se preferir manter o repo privado, o Cloudflare Pages
> publica repositório privado de graça — veja o apêndice no fim.

### Instalar como app
O projeto é um PWA: na primeira visita aparece um convite para instalar.
No Chrome/Edge (celular e computador) o botão **Instalar** resolve em um toque.
No iPhone, o convite ensina o caminho — **Compartilhar → Adicionar à Tela de
Início** —, porque o Safari não expõe instalação automática. Depois de
instalado, ou se a pessoa dispensar, o convite não volta a aparecer.

Os arquivos do PWA ficam em `public/` (manifest, service worker e ícones) e são
registrados em `src/main.jsx`, que monta os caminhos a partir do `BASE_URL`.

## 3. Rodar localmente (opcional)

Só faz sentido para mexer no código. Precisa de Node 18+:

```bash
cp .env.example .env      # preencha URL e anon key
npm install
npm run dev               # abre em http://localhost:5173
```

---

## Estrutura

```
README.md                       este arquivo (instalação do zero)
SETUP.md                        como esta instalação está configurada
schema.sql                      SQL do banco (rode uma vez no Supabase)
index.html
vite.config.js                  base do Pages fica aqui
.env.example
.github/workflows/deploy.yml    build + deploy automático
public/                         manifest, service worker e ícones do PWA
arte/                           logo original e o script que gera os ícones
src/
  main.jsx                      ponto de entrada do React
  App.jsx                       app inteiro (login + painel + modais)
  lib/supabase.js               cliente Supabase
```

## Modelo de dados

- `categorias(id, user_id, nome, cor, subs[])` — subcategorias ficam no array `subs`.
- `meses(id, user_id, mes 'YYYY-MM', renda, fixos_gerados)` — uma linha por mês,
  guarda a renda fixa e se as contas fixas já foram lançadas ali.
- `entradas(id, user_id, mes, data, valor, descricao)` — os ganhos avulsos do
  mês; a renda do saldo é `meses.renda` mais a soma destes.
- `gastos(id, user_id, mes, nome, valor, categoria_id, subcategoria, pago,
  grupo_parcela, parcela_atual, total_parcelas, fitid, observacao, data)` —
  parcelas compartilham `grupo_parcela`; `fitid` é o id da transação no OFX,
  usado para não importar duas vezes; `data` é o dia do gasto (`mes` continua
  sendo o mês a que ele pertence).
- `analises(id, user_id, mes, texto)` — a análise que você colou de volta do
  Claude, uma por mês.
- `fixos(id, user_id, nome, categoria_id, subcategoria, dia, ativo)` — o molde
  das contas fixas, sem valor: cada mês nasce zerado. Os lançamentos ficam em
  `gastos`, amarrados por `gastos.fixo_id`.

## Apêndice: publicar no Cloudflare Pages (repo privado)

1. Em https://pages.cloudflare.com, conecte o repositório.
2. **Build command:** `npm run build` — **Output directory:** `dist`
3. Em **Settings → Environment variables**, adicione `VITE_SUPABASE_URL`,
   `VITE_SUPABASE_ANON_KEY` e `VITE_BASE` = `/`
   (o app passa a ser servido na raiz do domínio, não em `/ControlMoney/`).
4. Atualize a **Site URL** e as **Redirect URLs** no Supabase para o novo
   endereço, e nada mais muda.

Netlify e Vercel seguem o mesmo padrão.

## Deu problema?

A tabela de sintomas e causas está em [SETUP.md](SETUP.md#problemas-conhecidos-e-como-reconhecê-los)
— tela preta, `redirect_uri_mismatch`, Actions falhando, card vermelho no topo.

## Ideias para depois

- Repetir gastos fixos automaticamente todo mês (aluguel, internet…).
- Relatório anual / comparativo entre meses.
- Exportar CSV.
- Marcar parcelas futuras como "previstas" com um tom diferente.
