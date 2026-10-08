// Public client settings. The publishable key is safe to ship in the browser:
// row level security in the database decides what each signed-in user can see.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "https://zdiztndggyrlwrjovsnl.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_BpjtxfMprAY_-FLp4ag39A_t5MVYrR5";
