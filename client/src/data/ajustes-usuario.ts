/**
 * AJUSTES DE LA CUENTA en el servidor (tabla `ajustes_usuario`).
 *
 * Hoy solo guarda el modo de almacenamiento, y existe porque ese modo es una
 * decisión de la CUENTA y no del dispositivo: guardado solo en localStorage,
 * entrar con la misma cuenta en otro teléfono volvía a preguntar y, si ahí se
 * respondía otra cosa, el usuario se quedaba sin sus datos sin ver ningún error.
 *
 * Esta tabla NO viaja por el outbox ni por el pull incremental como las cinco
 * del dominio, y no es un descuido: se lee de un tirón al entrar, ANTES de
 * montar la app, porque es lo que decide si el ciclo de sincronización puede
 * correr siquiera. Lo que gobierna al sync no puede depender del sync.
 *
 * La frontera con la base remota sigue siendo `data/supabase.ts`; esto es solo
 * el par de consultas de esa tabla, tipadas y con los fallos ya traducidos.
 */
import type { ModoAlmacenamiento } from './modo-almacenamiento';
import { haySupabase, supabase } from './supabase';

const TABLA = 'ajustes_usuario';

/**
 * El resultado tiene TRES casos y no dos, y esa es la distinción de la que
 * depende todo el arranque:
 *
 *  - `encontrado`  → la cuenta ya decidió: se aplica sin preguntar.
 *  - `sin-fila`    → nadie ha decidido nunca: hay que preguntar.
 *  - `inalcanzable`→ NO SE SABE. Nunca debe tratarse como `sin-fila`: preguntar
 *    aquí es justo el fallo original (el usuario contesta otra cosa que su
 *    cuenta y se queda sin datos), solo que ahora por un corte de red.
 */
export type ModoRemoto =
  | { estado: 'encontrado'; modo: ModoAlmacenamiento }
  | { estado: 'sin-fila' }
  | { estado: 'inalcanzable'; mensaje: string };

/** Falta aplicar la migración. Se distingue porque es lo único que el usuario
 *  (o quien despliega) puede arreglar, y merece decir cómo. */
const MENSAJE_SIN_TABLA =
  'El servidor todavía no guarda los ajustes de la cuenta: falta aplicar la ' +
  'migración `ajustes_usuario` (npx supabase db push).';

/** PostgREST no encuentra la tabla en su caché de esquema. */
function esTablaAusente(error: { code?: string; message?: string }): boolean {
  return (
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    /could not find the table/i.test(error.message ?? '')
  );
}

export async function leerModoRemoto(userId: string): Promise<ModoRemoto> {
  if (!haySupabase) {
    return { estado: 'inalcanzable', mensaje: 'Sin configurar Supabase (falta .env.local).' };
  }
  // Sin red ni se intenta: el mensaje del catch sería el genérico de fetch y
  // aquí conviene decir exactamente qué pasa, que la UI lo enseña.
  if (!navigator.onLine) {
    return { estado: 'inalcanzable', mensaje: 'Sin conexión.' };
  }

  try {
    // maybeSingle: cero filas es una respuesta legítima (nadie ha elegido aún),
    // no un error. Con `single()` sería PGRST116 y habría que distinguirlo del
    // resto de fallos por el código, que es más frágil.
    const { data, error } = await supabase
      .from(TABLA)
      .select('modo')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      return {
        estado: 'inalcanzable',
        mensaje: esTablaAusente(error) ? MENSAJE_SIN_TABLA : error.message,
      };
    }
    if (!data) return { estado: 'sin-fila' };

    const modo = data.modo;
    if (modo !== 'local' && modo !== 'nube') {
      // La columna tiene CHECK, así que esto solo puede pasar si alguien tocó
      // la tabla a mano. Mejor "no sé" que aplicar un modo inventado.
      return { estado: 'inalcanzable', mensaje: `Modo desconocido en el servidor: ${modo}` };
    }
    return { estado: 'encontrado', modo };
  } catch (e) {
    // supabase-js normalmente devuelve el error en vez de lanzarlo; si lanza,
    // es un fallo de transporte.
    return { estado: 'inalcanzable', mensaje: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Deja el modo de la cuenta. Lanza si no se pudo: quien llama tiene que
 * decidir qué hacer, y en los dos flujos que la usan la decisión es distinta
 * (ver `SeccionAlmacenamiento`). Tragarse el fallo dejaría la cuenta diciendo
 * una cosa y este dispositivo haciendo otra, que es el fallo original otra vez.
 */
export async function guardarModoRemoto(userId: string, modo: ModoAlmacenamiento): Promise<void> {
  if (!haySupabase) throw new Error('No hay servidor configurado.');

  // `user_id` explícito aunque la columna tenga `default auth.uid()`: es la
  // columna de conflicto del upsert, así que tiene que ir en la fila. El RLS
  // rechaza igualmente cualquier valor que no sea el de la sesión.
  const { error } = await supabase
    .from(TABLA)
    .upsert({ user_id: userId, modo }, { onConflict: 'user_id' });

  if (error) throw new Error(esTablaAusente(error) ? MENSAJE_SIN_TABLA : error.message);
}
