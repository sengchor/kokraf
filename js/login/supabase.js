import { createClient } from 'supabase'

const SUPABASE_URL = "https://rktxzmvbgzozhsncjqfn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_9_oW1wlMSD0ZJaR5-FBZOA_WLEfrc4o";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);