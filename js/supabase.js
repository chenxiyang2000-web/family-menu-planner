/**
 * Supabase connection for the shared family state.
 *
 * Replace url and anonKey with the values from:
 * Supabase Dashboard -> Project Settings -> API.
 * The anon key is designed for browser use; access is controlled by RLS.
 */
export const SUPABASE_CONFIG = {
  url: 'https://mefkdpgkyaiixcccpymy.supabase.co',
  anonKey: 'sb_publishable_nHozmxmlha__o6paE3pwjg_ReSdKtCR',
  familyId: '00000000-0000-0000-0000-000000000001'
};

let clientPromise;

export const isSupabaseConfigured = () =>
  /^https:\/\/.+\.supabase\.co$/i.test(SUPABASE_CONFIG.url) &&
  SUPABASE_CONFIG.anonKey.length > 20;

export async function getSupabaseClient() {
  if (!isSupabaseConfigured()) return null;
  if (!clientPromise) {
    clientPromise = import(
      'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/+esm'
    ).then(({ createClient }) => createClient(
      SUPABASE_CONFIG.url,
      SUPABASE_CONFIG.anonKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false
        }
      }
    ));
  }
  return clientPromise;
}
