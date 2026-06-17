-- =============================================================
-- Fase 0 — Armazenamento de PDFs de editais (Supabase Storage)
-- Rode isto no SQL Editor do Supabase UMA vez.
-- =============================================================

-- Bucket público para os PDFs dos editais (leitura por todos, upload só logado).
insert into storage.buckets (id, name, public)
values ('editais', 'editais', true)
on conflict (id) do nothing;

-- Qualquer um pode LER os editais (biblioteca compartilhada).
drop policy if exists "Editais: leitura publica" on storage.objects;
create policy "Editais: leitura publica"
  on storage.objects for select
  using (bucket_id = 'editais');

-- Apenas usuários AUTENTICADOS podem subir editais.
drop policy if exists "Editais: upload autenticado" on storage.objects;
create policy "Editais: upload autenticado"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'editais');

-- Autenticados podem atualizar/remover (ex.: corrigir um arquivo).
drop policy if exists "Editais: update autenticado" on storage.objects;
create policy "Editais: update autenticado"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'editais');

drop policy if exists "Editais: delete autenticado" on storage.objects;
create policy "Editais: delete autenticado"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'editais');
