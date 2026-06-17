-- =====================================================================
-- FASE 1 — App multiusuário: separar "edital (compartilhado)" de
-- "progresso (pessoal)" + Row Level Security (RLS).
--
-- ⚠️ RASCUNHO. Rode COM acompanhamento, em duas etapas:
--   • PARTE A (aditiva): segura de rodar agora. Cria as tabelas por-usuário,
--     adiciona user_id e copia os dados existentes. NÃO liga RLS, então o app
--     atual continua funcionando igual.
--   • PARTE B (RLS + limpeza): rode SÓ DEPOIS que o código estiver adaptado,
--     senão o app para de gravar (as policies exigem user_id = auth.uid()).
--
-- Modelo final:
--   Compartilhado (catálogo): exams, subjects, exam_subjects, topics
--   Pessoal (por usuário):    user_exams, user_topic_progress,
--                             user_subject_progress, study_logs,
--                             revision_schedule, calendar_plans
-- =====================================================================


-- =====================================================================
-- PARTE A — ADITIVA (segura)
-- =====================================================================

-- 1) Quem estuda qual edital + flags pessoais (saem de exams.is_primary/is_watching)
create table if not exists user_exams (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  exam_id     uuid not null references exams(id) on delete cascade,
  is_primary  boolean default false,
  is_watching boolean default false,
  created_at  timestamptz default now(),
  unique (user_id, exam_id)
);
create index if not exists idx_user_exams_user on user_exams(user_id);

-- 2) Conclusão de tópico por usuário (sai de topics.completed_at)
create table if not exists user_topic_progress (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  topic_id     uuid not null references topics(id) on delete cascade,
  completed_at date,
  created_at   timestamptz default now(),
  unique (user_id, topic_id)
);
create index if not exists idx_user_topic_progress_user on user_topic_progress(user_id);

-- 3) Conclusão de matéria por usuário (sai de exam_subjects.completed_at)
create table if not exists user_subject_progress (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  exam_subject_id uuid not null references exam_subjects(id) on delete cascade,
  completed_at    date,
  created_at      timestamptz default now(),
  unique (user_id, exam_subject_id)
);
create index if not exists idx_user_subject_progress_user on user_subject_progress(user_id);

-- 4) user_id nas tabelas que já são por-usuário (mantém colunas antigas por ora)
alter table study_logs        add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table calendar_plans    add column if not exists user_id uuid references auth.users(id) on delete cascade;
-- revision_schedule hoje é UNIQUE(topic_id); no multiusuário vira UNIQUE(user_id, topic_id)
alter table revision_schedule add column if not exists user_id uuid references auth.users(id) on delete cascade;

create index if not exists idx_study_logs_user        on study_logs(user_id);
create index if not exists idx_calendar_plans_user    on calendar_plans(user_id);
create index if not exists idx_revision_schedule_user on revision_schedule(user_id);

-- 5) Backfill: adota TODOS os dados existentes para o usuário mais antigo
--    (rode isto DEPOIS de criar a sua conta no app).
do $$
declare target uuid;
begin
  select id into target from auth.users order by created_at asc limit 1;
  if target is null then
    raise notice 'Nenhum usuario em auth.users. Crie sua conta no app e rode o bloco de backfill de novo.';
    return;
  end if;

  insert into user_exams (user_id, exam_id, is_primary, is_watching)
    select target, id, coalesce(is_primary, false), coalesce(is_watching, false)
    from exams
  on conflict (user_id, exam_id) do nothing;

  insert into user_topic_progress (user_id, topic_id, completed_at)
    select target, id, completed_at from topics where completed_at is not null
  on conflict (user_id, topic_id) do nothing;

  insert into user_subject_progress (user_id, exam_subject_id, completed_at)
    select target, id, completed_at from exam_subjects where completed_at is not null
  on conflict (user_id, exam_subject_id) do nothing;

  update study_logs        set user_id = target where user_id is null;
  update calendar_plans    set user_id = target where user_id is null;
  update revision_schedule set user_id = target where user_id is null;

  raise notice 'Backfill concluido para o usuario %', target;
end $$;


-- =====================================================================
-- PARTE B — RLS + LIMPEZA  ⚠️ SÓ DEPOIS DE ADAPTAR O CÓDIGO
-- (deixei comentado de propósito; descomente quando formos virar a chave)
-- =====================================================================

-- -- revision_schedule: troca a unicidade para (user_id, topic_id)
-- alter table revision_schedule drop constraint if exists revision_schedule_topic_id_key;
-- create unique index if not exists revision_schedule_user_topic
--   on revision_schedule(user_id, topic_id);

-- -- Liga RLS
-- alter table exams                 enable row level security;
-- alter table subjects              enable row level security;
-- alter table exam_subjects         enable row level security;
-- alter table topics                enable row level security;
-- alter table user_exams            enable row level security;
-- alter table user_topic_progress   enable row level security;
-- alter table user_subject_progress enable row level security;
-- alter table study_logs            enable row level security;
-- alter table revision_schedule     enable row level security;
-- alter table calendar_plans        enable row level security;

-- -- Catálogo: leitura para todos, escrita para autenticados
-- do $$
-- declare t text;
-- begin
--   foreach t in array array['exams','subjects','exam_subjects','topics'] loop
--     execute format('drop policy if exists "%s_read" on %I', t, t);
--     execute format('create policy "%s_read" on %I for select using (true)', t, t);
--     execute format('drop policy if exists "%s_write" on %I', t, t);
--     execute format('create policy "%s_write" on %I for all to authenticated using (true) with check (true)', t, t);
--   end loop;
-- end $$;

-- -- Tabelas pessoais: só o dono (user_id = auth.uid())
-- do $$
-- declare t text;
-- begin
--   foreach t in array array['user_exams','user_topic_progress','user_subject_progress',
--                            'study_logs','revision_schedule','calendar_plans'] loop
--     execute format('drop policy if exists "%s_owner" on %I', t, t);
--     execute format('create policy "%s_owner" on %I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t, t);
--   end loop;
-- end $$;

-- -- Limpeza final (só quando o código não usar mais essas colunas):
-- -- alter table exams         drop column if exists is_primary;
-- -- alter table exams         drop column if exists is_watching;
-- -- alter table topics        drop column if exists completed_at;
-- -- alter table exam_subjects drop column if exists completed_at;
