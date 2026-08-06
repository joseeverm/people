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
    // Google vuelve a la app con `?code=...` en la URL. Con esto activo el
    // cliente canjea ese código por una sesión ANTES de resolver getSession()
    // (ambos esperan a la misma inicialización interna), así que `useSesion`
    // ya ve la sesión buena en su primera lectura: se entra directo, sin
    // pasar otra vez por el login. Después limpia los parámetros de la URL.
    detectSessionInUrl: true,
    // PKCE (el valor por omisión, explícito porque de él depende el formato
    // del redirect): el `code` viaja en la query, no en el fragmento `#`.
    // El fragmento nunca llega al servidor, pero sí lo hace la query — por eso
    // el redirect debe estar en la lista blanca de Supabase (ver README).
    flowType: 'pkce',
  },
});

/**
 * A dónde vuelve Google tras autenticar. Se calcula en tiempo de ejecución a
 * propósito: la misma build corre en localhost y en Vercel, y una URL fija en
 * .env obligaría a mantener dos builds. Lo que sí hay que declarar a mano son
 * estas mismas URLs en Supabase (Authentication → URL Configuration).
 */
export function urlDeRetorno(): string {
  return new URL(import.meta.env.BASE_URL, window.location.origin).toString();
}
