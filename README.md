# Contas do mês

App de controle de gastos mensais com backend Supabase (Postgres + Auth),
sincronizado entre celular e computador. React + Vite.

## O que faz

- Login por e-mail/senha; cada usuário só vê os próprios dados (RLS no Postgres).
- Gastos por categoria e subcategoria (subcategoria opcional, criável na hora).
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
   já cadastra as categorias iniciais (Casa, Daniel, Brenda, Crianças, Empresa)
   para cada conta nova.
3. Em **Project Settings → API**, copie:
   - **Project URL** → vai em `VITE_SUPABASE_URL`
   - **anon public key** → vai em `VITE_SUPABASE_ANON_KEY`
4. (Opcional, recomendado para uso pessoal) Em **Authentication → Providers → Email**,
   você pode desligar "Confirm email" para entrar direto sem confirmar por link.
   Se mantiver ligado, confirme pelo e-mail antes do primeiro login.

> A `anon key` é pública por design — ela vai no bundle do front. A segurança
> vem do RLS: sem uma sessão válida, as policies não retornam nenhuma linha.

## 2. Rodar localmente

```bash
cp .env.example .env      # preencha URL e anon key
npm install
npm run dev               # abre em http://localhost:5173
```

## 3. Publicar

O front é estático (`npm run build` gera a pasta `dist/`). Qualquer host de
estáticos serve. Cloudflare Pages, por exemplo:

1. Suba o projeto num repositório Git.
2. No Cloudflare Pages, conecte o repo com:
   - **Build command:** `npm run build`
   - **Output directory:** `dist`
3. Em **Settings → Environment variables**, adicione
   `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
4. Deploy. Abra o link no celular e no PC — mesma conta, mesmos dados.

Netlify e Vercel seguem o mesmo padrão (build `npm run build`, publish `dist`,
e as duas variáveis de ambiente).

### Instalar como app no celular
Depois de publicado, abra o link no navegador do celular e use
"Adicionar à tela de início" — ele abre em tela cheia como um app.

---

## Estrutura

```
schema.sql            SQL do banco (rode uma vez no Supabase)
index.html
vite.config.js
.env.example
src/
  main.jsx
  App.jsx             app inteiro (login + painel + modais)
  lib/supabase.js     cliente Supabase
```

## Modelo de dados

- `categorias(id, user_id, nome, cor, subs[])` — subcategorias ficam no array `subs`.
- `meses(id, user_id, mes 'YYYY-MM', renda)` — uma linha por mês, guarda a renda.
- `gastos(id, user_id, mes, nome, valor, categoria_id, subcategoria, pago,
  grupo_parcela, parcela_atual, total_parcelas)` — parcelas compartilham `grupo_parcela`.

## Ideias para depois

- Repetir gastos fixos automaticamente todo mês (aluguel, internet…).
- Relatório anual / comparativo entre meses.
- Exportar CSV.
- Marcar parcelas futuras como "previstas" com um tom diferente.
