-- =============================================================
-- ConcurFlow — Metas semanais + Simulados
-- Rode este script inteiro no SQL Editor do Supabase (uma vez).
-- Seguro de rodar novamente (idempotente): usa IF NOT EXISTS.
-- =============================================================

-- ----------------------------------------------------------------
-- 1) METAS SEMANAIS (uma linha por usuário; colunas nulas = sem meta)
--    Os valores são apenas os ALVOS. O progresso é calculado no app
--    a partir de study_logs / user_topic_progress da semana atual.
-- ----------------------------------------------------------------
create table if not exists public.user_goals (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  weekly_minutes   integer,   -- meta de tempo de estudo na semana (em minutos)
  weekly_questions integer,   -- meta de questões resolvidas na semana
  weekly_topics    integer,   -- meta de tópicos concluídos na semana
  weekly_days      integer,   -- meta de dias ativos na semana (0-7)
  updated_at       timestamptz not null default now()
);

alter table public.user_goals enable row level security;

drop policy if exists "user_goals_own" on public.user_goals;
create policy "user_goals_own" on public.user_goals
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ----------------------------------------------------------------
-- 2) SIMULADOS (cada linha = um simulado feito pelo usuário)
-- ----------------------------------------------------------------
create table if not exists public.mock_exams (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  exam_id          uuid references public.exams(id) on delete set null, -- concurso (opcional)
  title            text not null,
  banca            text,                        -- banca organizadora (opcional)
  taken_at         date not null default current_date,
  total_questions  integer not null,
  correct_answers  integer not null,
  duration_minutes integer,                     -- tempo gasto (opcional)
  notes            text,                        -- anotações (opcional)
  created_at       timestamptz not null default now()
);

create index if not exists mock_exams_user_idx     on public.mock_exams (user_id);
create index if not exists mock_exams_taken_at_idx on public.mock_exams (user_id, taken_at);

alter table public.mock_exams enable row level security;

drop policy if exists "mock_exams_own" on public.mock_exams;
create policy "mock_exams_own" on public.mock_exams
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
