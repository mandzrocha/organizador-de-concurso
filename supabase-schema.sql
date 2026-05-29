-- EditalFocus Database Schema
-- Run this in Supabase SQL editor

-- Concursos (exams/competitions)
create table if not exists exams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  organization text,
  exam_date date,
  is_primary boolean default false,
  edital_url text,
  description text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Base subjects (matérias - can be shared across exams)
create table if not exists subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  color text default '#6366f1',
  created_at timestamptz default now()
);

-- Link exams to subjects (each exam references subjects)
create table if not exists exam_subjects (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid references exams(id) on delete cascade,
  subject_id uuid references subjects(id) on delete cascade,
  weight integer default 1,
  created_at timestamptz default now(),
  unique(exam_id, subject_id)
);

-- Topics (subtópicos within a subject)
-- exam_id null = shared topic; exam_id set = exam-specific topic
create table if not exists topics (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid references subjects(id) on delete cascade,
  exam_id uuid references exams(id) on delete cascade null,
  name text not null,
  order_index integer default 0,
  created_at timestamptz default now()
);

-- Study activity logs
create table if not exists study_logs (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid references topics(id) on delete cascade,
  activity_type text not null check (activity_type in ('video', 'exercises', 'reading', 'review')),
  studied_at date not null default current_date,
  notes text,
  duration_minutes integer,
  created_at timestamptz default now()
);

-- Spaced repetition schedule (SM-2 algorithm)
create table if not exists revision_schedule (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid references topics(id) on delete cascade unique,
  next_review date,
  interval_days integer default 1,
  ease_factor float default 2.5,
  repetitions integer default 0,
  last_reviewed date,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Daily calendar plans
create table if not exists calendar_plans (
  id uuid primary key default gen_random_uuid(),
  planned_date date not null,
  topic_id uuid references topics(id) on delete cascade,
  activity_type text not null check (activity_type in ('video', 'exercises', 'reading', 'review')),
  status text not null check (status in ('planned', 'done', 'skipped')) default 'planned',
  original_date date,
  notes text,
  order_index integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Indexes for performance
create index if not exists idx_topics_subject on topics(subject_id);
create index if not exists idx_study_logs_topic on study_logs(topic_id);
create index if not exists idx_study_logs_date on study_logs(studied_at);
create index if not exists idx_calendar_plans_date on calendar_plans(planned_date);
create index if not exists idx_revision_schedule_next on revision_schedule(next_review);

-- Function to update updated_at timestamp
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Triggers
create or replace trigger exams_updated_at before update on exams
  for each row execute function update_updated_at();

create or replace trigger calendar_plans_updated_at before update on calendar_plans
  for each row execute function update_updated_at();

create or replace trigger revision_schedule_updated_at before update on revision_schedule
  for each row execute function update_updated_at();
