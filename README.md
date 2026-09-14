# Contas do mês

App de controle de gastos mensais com backend Supabase (Postgres + Auth),
sincronizado entre celular e computador. React + Vite.

No ar em **https://danielvduarte.github.io/ControlMoney/**

> Este README explica como montar o projeto do zero. Para o que já está
> configurado nesta instalação — endereços, decisões e solução de problemas —
> veja **[SETUP.md](SETUP.md)**.

## O que faz

- Login por e-mail/senha ou conta Google; cada usuário só vê os próprios dados (RLS no Postgres).
- Gastos por categoria e subcategoria (criáveis na hora, e apagáveis pelo
  botão de categorias no cabeçalho).
- Parcelamento: um gasto em N parcelas é lançado automaticamente nos próximos N meses (1/N, 2/N…).
- Marcar como pago (fica verde); resumo de pago / falta pagar.
- Renda por mês, com o saldo (sobra) calculado em cima dela.
- Navegação por mês — cada mês é independente, dá para voltar e ver o que ficou pendente.
- Sync em tempo real: alterar num aparelho reflete no outro.

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

### Instalar como app no celular
Abra o link no navegador do celular e use "Adicionar à tela de início" — ele
abre em tela cheia, como um app.

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
src/
  main.jsx                      ponto de entrada do React
  App.jsx                       app inteiro (login + painel + modais)
  lib/supabase.js               cliente Supabase
```

## Modelo de dados

- `categorias(id, user_id, nome, cor, subs[])` — subcategorias ficam no array `subs`.
- `meses(id, user_id, mes 'YYYY-MM', renda)` — uma linha por mês, guarda a renda.
- `gastos(id, user_id, mes, nome, valor, categoria_id, subcategoria, pago,
  grupo_parcela, parcela_atual, total_parcelas)` — parcelas compartilham `grupo_parcela`.

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
