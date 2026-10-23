import { createClient } from '@supabase/supabase-js'
import { timedFetch } from './timedFetch'

// This is the public browser key. Database access is enforced by RLS and RPC grants.
export const supabase = createClient(
  'https://snnlibzckwpmbkersdnm.supabase.co',
  'sb_publishable_LhGZZ27YZPL_gC740L9DEQ_Yrs5_ZJC',
  { global: { fetch: timedFetch }, auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } },
)
