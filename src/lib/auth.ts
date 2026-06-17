import type { SupabaseClient } from '@supabase/supabase-js'

/** Id do usuário logado (ou null). Usado para escopar todos os dados pessoais. */
export async function getUserId(supabase: SupabaseClient): Promise<string | null> {
  const { data } = await supabase.auth.getUser()
  return data.user?.id ?? null
}
