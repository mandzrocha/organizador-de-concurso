-- =============================================================
-- ConcurFlow — Palavra-chave de notícias por concurso
-- Quando preenchida, a notícia só casa com o concurso se o TÍTULO contiver
-- exatamente essa palavra/frase (pode ter várias separadas por vírgula).
-- Assim nunca mais aparece edital de um concurso atribuído a outro.
-- Rode no SQL Editor do Supabase (uma vez).
-- =============================================================

alter table public.exams add column if not exists news_keyword text;
