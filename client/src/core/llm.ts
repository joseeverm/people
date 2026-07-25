/**
 * PERFILADOR — Capa de acceso al LLM v5 (vía Edge Function)
 * =========================================================
 * ÚNICA frontera con la IA. El clasificador y el motor de inferencia llaman a
 * `pedirJSON()`; no saben qué hay detrás.
 *
 * QUÉ CAMBIÓ RESPECTO A v4:
 * Antes este archivo hablaba directo con Groq y Gemini y las API keys viajaban
 * en el bundle. Ahora hace UN SOLO fetch a la Edge Function `llm` de Supabase
 * (`server/supabase/functions/llm/index.ts`), que es quien guarda las keys y
 * recorre la cascada de proveedores. Aquí ya no queda ni una key ni el SDK de
 * Gemini.
 *
 * La interfaz pública (`pedirLLM`, `pedirJSON`, `ErrorLLM`, `CASCADAS`) es
 * idéntica a la de v4 a propósito: `clasificador.ts`, `motor-inferencia.ts`,
 * `Bandeja.tsx` y `VistaPerfil.tsx` no se enteran del cambio.
 *
 * Keys en .env.local (solo las de Supabase, ambas públicas por diseño):
 *   VITE_SUPABASE_URL
 *   VITE_SUPABASE_ANON_KEY
 */

// ------------------------------------------------------------
// Definición de proveedores y cascadas
// ------------------------------------------------------------

export type Proveedor = 'groq' | 'gemini';

/** Un intento en la cascada: qué proveedor y con qué modelo. */
export interface Intento {
  proveedor: Proveedor;
  modelo: string;
}

export type Tarea = 'clasificacion' | 'inferencia';

/**
 * ESPEJO DECLARATIVO de las cascadas que ejecuta el servidor. La FUENTE DE
 * VERDAD está en `server/supabase/functions/llm/index.ts`; esta copia existe
 * para dos cosas y ninguna más:
 *
 *  1. Que las llamadas sigan diciendo `cascada: CASCADAS.clasificacion` y de
 *     ahí se deduzca la `tarea` que se manda al servidor.
 *  2. Etiquetar el campo `modelo` de un snapshot de perfil (`VistaPerfil`).
 *     Es una etiqueta orientativa: si el servidor cayó al respaldo, el modelo
 *     real fue otro (lo dice `console.debug` en dev).
 *
 * Si cambias las cascadas del servidor, actualiza esta lista también.
 */
export const CASCADAS: Record<Tarea, Intento[]> = {
  clasificacion: [
    { proveedor: 'groq', modelo: 'llama-3.3-70b-versatile' },
    { proveedor: 'groq', modelo: 'openai/gpt-oss-120b' },
    { proveedor: 'gemini', modelo: 'gemini-flash-latest' },
  ],
  inferencia: [
    { proveedor: 'gemini', modelo: 'gemini-pro-latest' },
    { proveedor: 'gemini', modelo: 'gemini-flash-latest' },
    { proveedor: 'groq', modelo: 'llama-3.3-70b-versatile' },
  ],
};

// ------------------------------------------------------------
// Error tipado
// ------------------------------------------------------------

export class ErrorLLM extends Error {
  status: number;
  detalle?: string;
  /**
   * Mantiene el campo por compatibilidad con v4, pero ya no lo usa nadie para
   * decidir: la cascada — y con ella los reintentos entre proveedores— vive
   * ahora en el servidor. Lo que llega aquí es el veredicto final.
   */
  reintentable: boolean;

  constructor(mensaje: string, status: number, detalle?: string, reintentable = false) {
    super(mensaje);
    this.name = 'ErrorLLM';
    this.status = status;
    this.detalle = detalle;
    this.reintentable = reintentable;
  }
}

/** Mensajes para fallos que ocurren de este lado del cable (no del proveedor). */
function mensajePorStatus(status: number): string {
  switch (status) {
    case 401:
    case 403: return 'La anon key de Supabase es inválida o falta';
    case 404: return 'La función llm no existe (¿está desplegada?)';
    case 0:   return 'Sin conexión con el servidor';
    default:  return `Error del servidor de IA (${status})`;
  }
}

// ------------------------------------------------------------
// Configuración de la Edge Function
// ------------------------------------------------------------

function urlFuncion(): string {
  const base = import.meta.env.VITE_SUPABASE_URL;
  if (!base) {
    throw new ErrorLLM('Falta VITE_SUPABASE_URL en .env.local', 0, undefined, false);
  }
  return `${base.replace(/\/$/, '')}/functions/v1/llm`;
}

function anonKey(): string {
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!key) {
    throw new ErrorLLM('Falta VITE_SUPABASE_ANON_KEY en .env.local', 0, undefined, false);
  }
  return key;
}

/**
 * El dominio pide una cascada (interfaz heredada de v4); el servidor espera una
 * tarea. La comparación por identidad cubre los dos únicos usos reales; el
 * respaldo por proveedor cubre una cascada armada a mano.
 */
function tareaDe(cascada?: Intento[]): Tarea {
  if (!cascada || cascada === CASCADAS.inferencia) return 'inferencia';
  if (cascada === CASCADAS.clasificacion) return 'clasificacion';
  return cascada[0]?.proveedor === 'groq' ? 'clasificacion' : 'inferencia';
}

// ------------------------------------------------------------
// Interfaz pública — lo único que el dominio conoce
// ------------------------------------------------------------

export interface PeticionLLM {
  sistema: string;
  usuario: string;
  maxTokens?: number;
  /** Cascada a recorrer. Por defecto, la de inferencia. */
  cascada?: Intento[];
  json?: boolean;
}

/** Forma de la respuesta de la Edge Function. */
interface RespuestaOK {
  texto: string;
  proveedor: Proveedor;
  modelo: string;
}
interface RespuestaError {
  error: { mensaje: string; status: number };
}

/**
 * Parsea el JSON de una respuesta, limpiando fences ```json si el modelo los
 * añade. El servidor ya validó que el JSON esté completo antes de devolverlo
 * (y probó el siguiente proveedor si venía truncado), así que llegar aquí con
 * basura es raro — pero el parseo defensivo se queda.
 */
function parsearJSON<T>(texto: string): T {
  try {
    return JSON.parse(texto) as T;
  } catch {
    const limpio = texto.replace(/```json|```/g, '').trim();
    const i = limpio.indexOf('{');
    const f = limpio.lastIndexOf('}');
    if (i !== -1 && f !== -1) {
      try {
        return JSON.parse(limpio.slice(i, f + 1)) as T;
      } catch {
        // sigue al error de abajo
      }
    }
    throw new ErrorLLM(
      'El modelo no devolvió JSON válido (posiblemente truncado)',
      200,
      `...${texto.slice(-200)}`,   // el final, para ver dónde se cortó
      true
    );
  }
}

/**
 * Un solo POST a la Edge Function. Los reintentos entre proveedores ocurren
 * allá; lo que vuelve es o el texto bueno o el error final, ya con el mensaje
 * legible y el status del proveedor que falló (que es lo que mira la UI: la
 * bandeja, por ejemplo, reintenta cuando ve un 429).
 */
export async function pedirLLM(p: PeticionLLM): Promise<string> {
  const cuerpo = {
    tarea: tareaDe(p.cascada),
    sistema: p.sistema,
    usuario: p.usuario,
    maxTokens: p.maxTokens ?? 4000,
    json: p.json ?? false,
  };

  let resp: Response;
  try {
    resp = await fetch(urlFuncion(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${anonKey()}`,
        apikey: anonKey(),
      },
      body: JSON.stringify(cuerpo),
    });
  } catch (e) {
    if (e instanceof ErrorLLM) throw e;   // falta de config, no fallo de red
    throw new ErrorLLM(mensajePorStatus(0), 0, String(e), true);
  }

  if (!resp.ok) {
    // Camino normal: la función devuelve { error: { mensaje, status } } con el
    // status REAL del proveedor. Si el cuerpo no trae ese sobre, el fallo es de
    // la plataforma (anon key mala, función no desplegada) y se traduce solo.
    const datos = (await resp.json().catch(() => null)) as RespuestaError | null;
    const err = datos?.error;
    if (err) throw new ErrorLLM(err.mensaje, err.status, undefined, false);
    throw new ErrorLLM(mensajePorStatus(resp.status), resp.status, undefined, false);
  }

  const datos = (await resp.json()) as RespuestaOK;
  if (!datos?.texto?.trim()) {
    throw new ErrorLLM('Respuesta vacía del servidor de IA', 200, undefined, true);
  }

  if (import.meta.env.DEV) {
    console.debug(`[llm] respondió ${datos.proveedor}/${datos.modelo}`);
  }
  return datos.texto;
}

/** Pide JSON y lo parsea (ya validado por el servidor dentro de su cascada). */
export async function pedirJSON<T = unknown>(
  p: Omit<PeticionLLM, 'json'>
): Promise<T> {
  const texto = await pedirLLM({ ...p, json: true });
  return parsearJSON<T>(texto);
}
