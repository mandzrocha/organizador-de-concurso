-- =============================================================
-- ConcurFlow — Caderno de erros (anotações manuais)
-- Rode este script no SQL Editor do Supabase (uma vez).
-- A lista de "pontos fracos" é automática (calculada dos seus
-- registros) e NÃO precisa de tabela. Esta tabela guarda só as
-- anotações de erro que você escreve manualmente.
-- =============================================================

create table if not exists public.error_notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  topic_id   uuid references public.topics(id) on delete set null, -- tópico (opcional)
  content    text not null,                 -- o que errou / o que revisar
  resolved   boolean not null default false, -- marcado como resolvido
  created_at timestamptz not null default now()
);

create index if not exists error_notes_user_idx on public.error_notes (user_id);

alter table public.error_notes enable row level security;

drop policy if exists "error_notes_own" on public.error_notes;
create policy "error_notes_own" on public.error_notes
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
