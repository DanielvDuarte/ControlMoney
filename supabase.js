import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anon) {
  // Falha cedo e com mensagem clara em vez de erro obscuro no primeiro fetch.
  throw new Error(
    "Faltam as variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY. " +
    "Confira o arquivo .env (local) ou as variáveis do deploy."
  );
}

export const supabase = createClient(url, anon);
