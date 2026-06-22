-- =============================================================
-- ConcurFlow — Bucket de fotos de perfil (avatars)
-- Rode no SQL Editor do Supabase (uma vez). Cria o bucket público
-- "avatars" e as policies para o usuário subir/atualizar a própria foto.
-- =============================================================

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Leitura pública (as fotos são exibidas no app)
drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read" on storage.objects
  for select using (bucket_id = 'avatars');

-- Usuário autenticado pode enviar/atualizar/remover no bucket avatars
drop policy if exists "avatars_auth_write" on storage.objects;
create policy "avatars_auth_write" on storage.objects
  for all to authenticated
  using (bucket_id = 'avatars')
  with check (bucket_id = 'avatars');
