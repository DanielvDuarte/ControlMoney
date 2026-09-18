-- ============================================================
--  Controle de Gastos — schema Supabase (Postgres)
--  Rode isto no SQL Editor do seu projeto Supabase.
--  Cria as tabelas, ativa RLS e isola os dados por usuário.
-- ============================================================

-- Extensão para gen_random_uuid() (já vem habilitada no Supabase,
-- mas garante em ambientes self-hosted).
create extension if not exists "pgcrypto";

-- ---------- CATEGORIAS ----------
create table if not exists public.categorias (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome       text not null,
  cor        text not null default '#64748b',
  subs       text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (user_id, nome)
);

-- ---------- MESES (renda por mês) ----------
create table if not exists public.meses (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  mes        text not null,               -- formato 'YYYY-MM'
  renda      numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, mes)
);

-- ---------- CONTAS FIXAS DISPENSADAS
create policy "pul_select" on public.fixos_pulados for select using (auth.uid() = user_id);
create policy "pul_insert" on public.fixos_pulados for insert with check (auth.uid() = user_id);
create policy "pul_delete" on public.fixos_pulados for delete using (auth.uid() = user_id);

-- ENTRADAS EXTRAS
create policy "ent_select" on public.entradas for select using (auth.uid() = user_id);
create policy "ent_insert" on public.entradas for insert with check (auth.uid() = user_id);
create policy "ent_update" on public.entradas for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "ent_delete" on public.entradas for delete using (auth.uid() = user_id);

-- CONTAS FIXAS (modelo que se repete todo mês) ----------
-- Guarda o molde, não os lançamentos: ao abrir um mês pela primeira vez, o
-- app cria um gasto para cada conta fixa ativa. Assim não é preciso gerar
-- parcelas até o infinito, e parar uma conta fixa não mexe no passado.
-- O molde não guarda valor: cada mês nasce zerado e é preenchido com o que a
-- conta trouxe de fato.
create table if not exists public.fixos (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome         text not null,
  categoria_id uuid references public.categorias(id) on delete set null,
  subcategoria text not null default '',
  dia          int not null default 1,
  ativo        boolean not null default true,
  created_at   timestamptz not null default now()
);

-- ---------- CONTAS FIXAS DISPENSADAS NUM MÊS ----------
-- Quando um lançamento gerado por conta fixa é apagado, registramos aqui.
-- É o que impede a conta de ressuscitar na próxima vez que o mês for aberto,
-- sem precisar bloquear o mês inteiro para novas contas fixas.
create table if not exists public.fixos_pulados (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  fixo_id    uuid not null references public.fixos(id) on delete cascade,
  mes        text not null,
  created_at timestamptz not null default now(),
  unique (user_id, fixo_id, mes)
);

-- ---------- ENTRADAS EXTRAS ----------
-- A renda fixa do mês fica em `meses.renda`. Aqui entram os avulsos: um bico,
-- um reembolso, a venda de alguma coisa. O saldo soma os dois.
create table if not exists public.entradas (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  mes        text not null,               -- 'YYYY-MM'
  data       date,
  valor      numeric(12,2) not null default 0,
  descricao  text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists entradas_user_mes_idx on public.entradas (user_id, mes);

-- ---------- ANÁLISES (texto colado de volta do Claude) ----------
create table if not exists public.analises (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  mes        text not null,               -- 'YYYY-MM'
  texto      text not null,
  created_at timestamptz not null default now(),
  unique (user_id, mes)
);

-- ---------- GASTOS ----------
create table if not exists public.gastos (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  mes            text not null,           -- 'YYYY-MM'
  nome           text not null,
  valor          numeric(12,2) not null default 0,
  categoria_id   uuid references public.categorias(id) on delete set null,
  subcategoria   text not null default '',
  pago           boolean not null default false,
  grupo_parcela  uuid,                     -- mesmo id em todas as parcelas
  parcela_atual  int,
  total_parcelas int,
  fitid          text,                     -- id da transação no OFX (evita importar 2x)
  observacao     text not null default '',
  data           date,                     -- dia em que o gasto aconteceu
  fixo_id        uuid references public.fixos(id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists gastos_user_mes_idx on public.gastos (user_id, mes);
create index if not exists gastos_grupo_idx     on public.gastos (grupo_parcela);
create index if not exists gastos_fitid_idx     on public.gastos (user_id, fitid);
-- Trava contra duplicata quando dois aparelhos abrem o mesmo mês ao mesmo
-- tempo. Gastos comuns têm fixo_id nulo, e nulos não colidem entre si.
create unique index if not exists gastos_fixo_mes_idx on public.gastos (user_id, mes, fixo_id);

-- ============================================================
--  Row Level Security — cada usuário só enxerga o que é seu
-- ============================================================
alter table public.categorias enable row level security;
alter table public.meses      enable row level security;
alter table public.gastos     enable row level security;
alter table public.analises   enable row level security;
alter table public.fixos      enable row level security;
alter table public.entradas   enable row level security;
alter table public.fixos_pulados enable row level security;

-- CATEGORIAS
create policy "cat_select" on public.categorias for select using (auth.uid() = user_id);
create policy "cat_insert" on public.categorias for insert with check (auth.uid() = user_id);
create policy "cat_update" on public.categorias for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "cat_delete" on public.categorias for delete using (auth.uid() = user_id);

-- MESES
create policy "mes_select" on public.meses for select using (auth.uid() = user_id);
create policy "mes_insert" on public.meses for insert with check (auth.uid() = user_id);
create policy "mes_update" on public.meses for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "mes_delete" on public.meses for delete using (auth.uid() = user_id);

-- CONTAS FIXAS
create policy "fix_select" on public.fixos for select using (auth.uid() = user_id);
create policy "fix_insert" on public.fixos for insert with check (auth.uid() = user_id);
create policy "fix_update" on public.fixos for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "fix_delete" on public.fixos for delete using (auth.uid() = user_id);

-- ANÁLISES
create policy "ana_select" on public.analises for select using (auth.uid() = user_id);
create policy "ana_insert" on public.analises for insert with check (auth.uid() = user_id);
create policy "ana_update" on public.analises for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "ana_delete" on public.analises for delete using (auth.uid() = user_id);

-- GASTOS
create policy "gasto_select" on public.gastos for select using (auth.uid() = user_id);
create policy "gasto_insert" on public.gastos for insert with check (auth.uid() = user_id);
create policy "gasto_update" on public.gastos for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "gasto_delete" on public.gastos for delete using (auth.uid() = user_id);

-- ============================================================
--  Categoria inicial para cada novo usuário (trigger)
--  Só "Casa", para a conta não nascer vazia. As demais o próprio
--  usuário cria na hora de lançar um gasto, e pode apagar depois.
-- ============================================================
create or replace function public.seed_categorias()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.categorias (user_id, nome, cor) values
    (new.id, 'Casa', '#22c55e');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_seed on auth.users;
create trigger on_auth_user_created_seed
  after insert on auth.users
  for each row execute function public.seed_categorias();

-- ============================================================
--  LIXEIRA
--  Nada é apagado direto: a linha inteira é copiada para cá antes de sair
--  da tabela de origem, e é de lá que ela volta — com o mesmo id, para que
--  parcelas e vínculos continuem apontando para o lugar certo.
--  O app faz a faxina sozinho: o que passou de 30 dias sai de vez.
--
--  Se o banco já existe, basta rodar deste comentário até o fim do arquivo
--  no SQL Editor — o resto do schema não muda.
-- ============================================================
create table if not exists public.lixeira (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tabela      text not null,               -- 'gastos' | 'entradas' | 'analises'
  registro_id uuid not null,               -- id que a linha tinha (e terá de volta)
  mes         text,                        -- 'YYYY-MM', para mostrar na lista
  rotulo      text not null default '',    -- nome do gasto / descrição da entrada
  valor       numeric(12,2) not null default 0,
  dados       jsonb not null,              -- a linha inteira, como estava
  removido_em timestamptz not null default now()
);

create index if not exists lixeira_user_idx on public.lixeira (user_id, removido_em desc);

alter table public.lixeira enable row level security;

drop policy if exists "lix_select" on public.lixeira;
drop policy if exists "lix_insert" on public.lixeira;
drop policy if exists "lix_delete" on public.lixeira;
create policy "lix_select" on public.lixeira for select using (auth.uid() = user_id);
create policy "lix_insert" on public.lixeira for insert with check (auth.uid() = user_id);
create policy "lix_delete" on public.lixeira for delete using (auth.uid() = user_id);
