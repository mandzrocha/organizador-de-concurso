-- EditalFocus — App pessoal de usuário único (sem login/auth)
-- Desativa o Row Level Security para permitir leitura/escrita com a chave anon.
-- Rode este script no SQL Editor do Supabase.

alter table exams              disable row level security;
alter table subjects           disable row level security;
alter table exam_subjects      disable row level security;
alter table topics             disable row level security;
alter table study_logs         disable row level security;
alter table revision_schedule  disable row level security;
alter table calendar_plans     disable row level security;
