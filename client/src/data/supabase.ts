/**
 * Cliente único de Supabase (auth + Data API para la sincronización).
 *
 * OJO con la frontera: `core/llm.ts` habla con la Edge Function `llm` por
 * `fetch` crudo y NO usa este cliente — sigue siendo la única frontera con la
 * IA. Este módulo es la frontera con la BASE DE DATOS remota. No mezclarlas.
 */
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Sin config no hay sync ni login; la app local debe seguir funcionando igual. */
export const haySupabase = Boolean(url && anonKey);

if (!haySupabase && import.meta.env.DEV) {
  console.warn(
    '[supabase] Falta VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY en .env.local: ' +
      'la app funciona en local pero no habrá login ni sincronización.'
  );
}

export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'anon', {
  auth: {
    // La sesión vive en localStorage y se refresca sola: entrar una vez basta.
    persistSession: true,
    autoRefreshToken: true,
    // No hay flujo OAuth ni magic links: nada que leer de la URL. Evita que el
    // cliente se quede esperando parámetros que nunca llegan.
    detectSessionInUrl: false,
  },
});
