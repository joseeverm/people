/**
 * PERFILADOR — Proxy de IA (Edge Function `llm`)
 * ==============================================
 * ÚNICA frontera con los proveedores de IA. Antes esta lógica vivía en
 * `client/src/core/llm.ts` y las API keys viajaban en el bundle; ahora el
 * client hace un solo POST aquí y las keys solo existen como secrets de
 * Supabase (GROQ_API_KEY / GEMINI_API_KEY).
 *
 * ENTRADA (POST, JSON):
 *   {
 *     tarea: 'clasificacion' | 'inferencia',
 *     sistema: string,
 *     usuario: string,
 *     maxTokens?: number,   // por defecto 4000, tope MAX_TOKENS_TOPE
 *     json?: boolean        // exige JSON válido y completo al modelo
 *   }
 *
 * SALIDA:
 *   200 → { texto, proveedor, modelo }
 *   otro → { error: { mensaje, status } }
 *
 * El `status` del error es el del PROVEEDOR (0 = red, 429 = cuota, ...), no el
 * HTTP de esta función: el client lo lee del cuerpo y lo usa tal cual (la
 * bandeja, por ejemplo, reintenta cuando ve un 429).
 *
 * REPARTO POR TAREA (cada una con respaldo en el otro proveedor):
 *   CLASIFICACIÓN → Groq primero. Alto volumen, tarea mecánica, muy rápido.
 *                   Respaldo: Gemini Flash.
 *   INFERENCIA    → Gemini primero. Bajo volumen, la calidad manda.
 *                   Respaldo: Groq (peor calidad, mantiene el servicio vivo).
 *
 * POR QUÉ DOS IMPLEMENTACIONES:
 * Groq es compatible con el formato OpenAI → `fetch` directo, simple.
 * Gemini emite keys nuevas en formato "AQ." que NO autentican contra su
 * endpoint REST crudo → hay que usar el SDK oficial.
 */

import { GoogleGenAI } from 'npm:@google/genai@2.13.0';

// ------------------------------------------------------------
// Definición de proveedores y cascadas
// ------------------------------------------------------------

type Tarea = 'clasificacion' | 'inferencia';
type Proveedor = 'groq' | 'gemini';

/** Un intento en la cascada: qué proveedor y con qué modelo. */
interface Intento {
  proveedor: Proveedor;
  modelo: string;
}

/**
 * FUENTE DE VERDAD de las cascadas. El client tiene una copia declarativa en
 * `CASCADAS` (solo para etiquetar el modelo de un snapshot de perfil); si
 * cambias algo aquí, actualiza también aquella.
 *
 * IMPORTANTE: los nombres de modelo rotan. Si empiezas a ver 404 constantes:
 *  - Groq:   console.groq.com → Models
 *  - Gemini: la lista de ListModels con tu key
 */
const CASCADAS: Record<Tarea, Intento[]> = {
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

/** Tope defensivo: el proxy es personal, pero no hay que dejarlo sin límite. */
const MAX_TOKENS_TOPE = 16000;
const MAX_TOKENS_DEFECTO = 4000;

// ------------------------------------------------------------
// Error tipado
// ------------------------------------------------------------

class ErrorLLM extends Error {
  status: number;
  detalle?: string;
  /** Si true, tiene sentido intentar el siguiente proveedor de la cascada. */
  reintentable: boolean;

  constructor(mensaje: string, status: number, detalle?: string, reintentable = false) {
    super(mensaje);
    this.name = 'ErrorLLM';
    this.status = status;
    this.detalle = detalle;
    this.reintentable = reintentable;
  }
}

/** 429 (cuota), 5xx (saturación) y fallos de red → probar el siguiente. */
function esReintentable(status: number): boolean {
  return status === 429 || status === 0 || status >= 500;
}

function mensajePorStatus(status: number, proveedor: Proveedor): string {
  switch (status) {
    case 400: return `Petición mal formada (${proveedor})`;
    case 401:
    case 403: return `API key de ${proveedor} inválida o sin permisos`;
    case 404: return `Modelo no encontrado en ${proveedor} (¿cambió de nombre?)`;
    case 429: return `Cuota agotada en ${proveedor}`;
    case 0:   return `Sin conexión con ${proveedor}`;
    default:  return `Error de ${proveedor} (${status})`;
  }
}

// ------------------------------------------------------------
// Proveedor 1: Groq (compatible OpenAI, fetch directo)
// ------------------------------------------------------------

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

async function llamarGroq(
  modelo: string,
  sistema: string,
  usuario: string,
  maxTokens: number,
  json: boolean,
): Promise<string> {
  const key = Deno.env.get('GROQ_API_KEY');
  if (!key) {
    throw new ErrorLLM('Falta el secret GROQ_API_KEY en Supabase', 0, undefined, false);
  }

  let resp: Response;
  try {
    resp = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: modelo,
        messages: [
          { role: 'system', content: sistema },
          { role: 'user', content: usuario },
        ],
        max_tokens: maxTokens,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
  } catch (e) {
    throw new ErrorLLM(mensajePorStatus(0, 'groq'), 0, String(e), true);
  }

  if (!resp.ok) {
    const detalle = await resp.text().catch(() => '');
    throw new ErrorLLM(
      mensajePorStatus(resp.status, 'groq'),
      resp.status,
      detalle,
      esReintentable(resp.status),
    );
  }

  const data = await resp.json();
  const texto: string = data?.choices?.[0]?.message?.content ?? '';
  if (!texto.trim()) throw new ErrorLLM('Respuesta vacía de Groq', 200, undefined, true);
  return texto;
}

// ------------------------------------------------------------
// Proveedor 2: Gemini (SDK oficial — las keys "AQ." lo requieren)
// ------------------------------------------------------------

let clienteGemini: GoogleGenAI | null = null;

function obtenerGemini(): GoogleGenAI {
  if (clienteGemini) return clienteGemini;
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    throw new ErrorLLM('Falta el secret GEMINI_API_KEY en Supabase', 0, undefined, false);
  }
  clienteGemini = new GoogleGenAI({ apiKey });
  return clienteGemini;
}

async function llamarGemini(
  modelo: string,
  sistema: string,
  usuario: string,
  maxTokens: number,
  json: boolean,
): Promise<string> {
  const ai = obtenerGemini();
  const modeloLimpio = modelo.replace(/^models\//, '');

  // TEMPORAL: thinkingConfig desactivado del todo (incluso para "flash") —
  // el filtro por nombre de modelo no evitó el 400 en Flash. Se queda fuera
  // mientras el console.error de abajo confirma qué campo rechaza la API
  // (visible en `supabase functions logs llm`).
  const config = {
    systemInstruction: sistema,
    maxOutputTokens: maxTokens,
    ...(json ? { responseMimeType: 'application/json' } : {}),
  };

  try {
    const respuesta = await ai.models.generateContent({
      model: modeloLimpio,
      contents: usuario,
      config,
    });
    const texto = respuesta.text;
    if (!texto?.trim()) {
      throw new ErrorLLM('Respuesta vacía de Gemini', 200, undefined, true);
    }
    return texto;
  } catch (e) {
    if (e instanceof ErrorLLM) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    const status = Number(/\b(400|401|403|404|429|500|503)\b/.exec(msg)?.[1] ?? 0);
    if (status === 400) {
      console.error('[llm] gemini 400, body enviado:', { model: modeloLimpio, config });
    }
    throw new ErrorLLM(
      mensajePorStatus(status, 'gemini'),
      status,
      msg,
      esReintentable(status),
    );
  }
}

// ------------------------------------------------------------
// Cascada
// ------------------------------------------------------------

/**
 * Valida que el texto sea JSON completo, limpiando fences ```json si el modelo
 * los añade. Un JSON truncado — típicamente por `maxTokens` corto — se marca
 * reintentable para que la cascada pruebe el siguiente proveedor en vez de
 * devolverle al client una respuesta a medias.
 */
function validarJSON(texto: string): void {
  try {
    JSON.parse(texto);
    return;
  } catch {
    const limpio = texto.replace(/```json|```/g, '').trim();
    const i = limpio.indexOf('{');
    const f = limpio.lastIndexOf('}');
    if (i !== -1 && f !== -1) {
      try {
        JSON.parse(limpio.slice(i, f + 1));
        return;
      } catch {
        // sigue al error de abajo
      }
    }
    throw new ErrorLLM(
      'El modelo no devolvió JSON válido (posiblemente truncado)',
      200,
      `...${texto.slice(-200)}`,   // el final, para ver dónde se cortó
      true,
    );
  }
}

interface Respuesta {
  texto: string;
  proveedor: Proveedor;
  modelo: string;
}

/**
 * Recorre la cascada: intenta cada proveedor/modelo en orden y devuelve la
 * primera respuesta buena. Solo avanza al siguiente si el error es
 * reintentable (cuota agotada, saturación, red, JSON truncado). Un 401 o un
 * 400 detienen todo: reintentar con otro modelo no arreglaría una key mala.
 */
async function ejecutarCascada(
  tarea: Tarea,
  sistema: string,
  usuario: string,
  maxTokens: number,
  json: boolean,
): Promise<Respuesta> {
  let ultimoError: ErrorLLM | null = null;

  for (const intento of CASCADAS[tarea]) {
    try {
      const texto =
        intento.proveedor === 'groq'
          ? await llamarGroq(intento.modelo, sistema, usuario, maxTokens, json)
          : await llamarGemini(intento.modelo, sistema, usuario, maxTokens, json);

      // Valida que el JSON esté completo antes de dar la respuesta por buena;
      // si está truncado, esto lanza un ErrorLLM reintentable y el catch de
      // abajo pasa al siguiente proveedor de la cascada.
      if (json) validarJSON(texto);

      console.log(`[llm] ${tarea}: respondió ${intento.proveedor}/${intento.modelo}`);
      return { texto, proveedor: intento.proveedor, modelo: intento.modelo };
    } catch (e) {
      const err = e instanceof ErrorLLM ? e : new ErrorLLM(String(e), 0, undefined, true);
      ultimoError = err;
      if (!err.reintentable) throw err;    // error definitivo: no seguir probando
      console.log(`[llm] falló ${intento.proveedor}/${intento.modelo}: ${err.message}`);
      // continúa al siguiente intento
    }
  }

  throw new ErrorLLM(
    `Todos los proveedores fallaron. Último: ${ultimoError?.message ?? 'desconocido'}`,
    ultimoError?.status ?? 0,
    ultimoError?.detalle,
  );
}

// ------------------------------------------------------------
// HTTP
// ------------------------------------------------------------

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json200(cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/**
 * Todo error sale con este sobre. El HTTP es solo para que `resp.ok` sea
 * false; el status que le importa al client va DENTRO, en `error.status`.
 */
function jsonError(mensaje: string, status: number, http: number): Response {
  return new Response(JSON.stringify({ error: { mensaje, status } }), {
    status: http,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function esTarea(v: unknown): v is Tarea {
  return v === 'clasificacion' || v === 'inferencia';
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') {
    return jsonError('Solo se acepta POST', 405, 405);
  }

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = await req.json();
  } catch {
    return jsonError('Cuerpo no es JSON válido', 400, 400);
  }

  const { tarea, sistema, usuario } = cuerpo;
  if (!esTarea(tarea)) {
    return jsonError("Campo 'tarea' debe ser 'clasificacion' o 'inferencia'", 400, 400);
  }
  if (typeof sistema !== 'string' || typeof usuario !== 'string' || !usuario.trim()) {
    return jsonError("Campos 'sistema' y 'usuario' deben ser texto no vacío", 400, 400);
  }

  const maxTokens = Math.min(
    Math.max(1, Number(cuerpo.maxTokens) || MAX_TOKENS_DEFECTO),
    MAX_TOKENS_TOPE,
  );
  const json = cuerpo.json === true;

  try {
    return json200(await ejecutarCascada(tarea, sistema, usuario, maxTokens, json));
  } catch (e) {
    const err = e instanceof ErrorLLM ? e : new ErrorLLM(String(e), 0);
    // 502: el fallo es del proveedor de arriba, no de esta función ni del
    // client. El detalle solo va al log — al client le basta el mensaje.
    if (err.detalle) console.error(`[llm] ${err.message} :: ${err.detalle}`);
    return jsonError(err.message, err.status, 502);
  }
});
