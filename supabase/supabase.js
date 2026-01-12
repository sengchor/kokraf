import { createClient } from 'supabase'

export const SUPABASE_URL = "https://rktxzmvbgzozhsncjqfn.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_9_oW1wlMSD0ZJaR5-FBZOA_WLEfrc4o";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);