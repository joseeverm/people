/**
 * PERFILADOR — Clasificador de captura v2
 * ========================================
 * Convierte texto crudo que escribes al vuelo en una PROPUESTA de Senal:
 *   "dijo que odia las fiestas grandes pero fue a la de anoche"
 *      → tipo: cita (+ una contradicción latente)
 *        compania/situacion: (inferidas o preguntadas)
 *        etiquetas: [gustos_ocio/intermedia]
 *
 * La persona YA está resuelta cuando se llama a este módulo: la asigna el
 * usuario manualmente en la bandeja ANTES de clasificar (ver Bandeja.tsx).
 * Esto ahorra tokens (no hay que mandar el catálogo completo de personas)
 * y hace la asignación infalible (no depende de que el LLM adivine bien).
 *
 * Nunca crea la señal directamente: produce una propuesta que TÚ confirmas.
 * El objetivo de diseño es que en el caso fácil solo tengas que pulsar "OK".
 */

import type {
  Persona,
  Senal,
  TipoSenal,
  EtiquetaDominio,
  Confianza,
} from './esquema';
import { DOMINIOS, CAPAS, COMPANIA_SUGERIDA, SITUACION_SUGERIDA } from './esquema';
import { pedirJSON, CASCADAS } from './llm';

// ------------------------------------------------------------
// Resultado de la clasificación
// ------------------------------------------------------------

export interface PropuestaSenal {
  /** El hecho reescrito con contexto suficiente para releerse en 2 años,
   *  sin perder las palabras textuales si eran una cita. */
  contenido: string;
  tipo: TipoSenal;
  /** Con quién está la persona, sugerido por el clasificador. Ausente/vacío si no se
   *  pudo inferir (el LLM puede omitir el campo entero); trátalo como `?? []`. */
  compania?: string[];
  /** Bajo qué marco ocurre, sugerido por el clasificador. Ausente/vacío si no se
   *  pudo inferir; trátalo como `?? []`. */
  situacion?: string[];
  etiquetas: EtiquetaDominio[];
  /** El clasificador puede detectar tensión con lo ya sabido y marcarla,
   *  para que el motor de inferencia luego la trate como contradicción. */
  posibleContradiccion: boolean;
  /** Confianza global de la propuesta: decide cuánto tienes que revisar. */
  confianza: Confianza;
  /** Qué debería preguntarte la UI antes de confirmar (vacío = confirma de un toque). */
  aclaraciones: Aclaracion[];
}

export type Aclaracion =
  | { tipo: 'elegir_compania'; opciones: string[] }
  | { tipo: 'elegir_situacion'; opciones: string[] }
  | { tipo: 'confirmar_tipo'; sugerido: TipoSenal }
  | { tipo: 'revisar_etiquetas' };

// ------------------------------------------------------------
// Prompt del clasificador
// ------------------------------------------------------------

const PROMPT_SISTEMA = `Eres el clasificador de captura de un sistema personal de modelado de
personas. El usuario anota, al vuelo y en lenguaje coloquial, hechos sobre gente que conoce.
La identidad de la persona YA está resuelta (el usuario la asignó a mano antes de llamarte):
tu única tarea es estructurar el HECHO, no decidir de quién es la nota.
Tu tarea: convertir esa nota cruda en una propuesta estructurada de "señal", que el usuario
confirmará con un toque. Optimiza para que el caso fácil no requiera ninguna corrección.

REGLAS:

1. CONTENIDO: reescribe el hecho de forma que se entienda dentro de 2 años sin el contexto
   mental de hoy, PERO conserva las palabras textuales si el usuario está citando algo que
   la persona dijo (esas comillas son evidencia y no se parafrasean).

2. TIPO de señal:
   - "cita": palabras textuales de la persona (dichas o escritas).
   - "comportamiento": algo que la persona HIZO.
   - "observacion": algo que el usuario notó/interpretó.
   - "respuesta": contestación a una pregunta que el usuario le hizo a propósito.
   - "dato_conocido": información factual sobre la persona que el usuario simplemente
     sabe, sin que provenga de una interacción puntual (fecha de nacimiento, lugar de
     origen, edad). Estas señales normalmente NO tienen compañía ni situación: déjalas
     vacías y no pidas aclaración sobre ellas.
   Si la nota mezcla (dijo X e hizo Y), elige el núcleo y menciona el resto en el contenido.

3. COMPAÑÍA: con quién está la persona en lo que describe la nota — amigos, familia,
   pareja, solo_conmigo (a solas contigo), desconocidos, trabajo... Puede ser más de un
   valor (p. ej. la nota mezcla familia y amigos). Vacío si la nota no deja claro con
   quién estaba, o si no aplica: "dato_conocido" (información que el usuario sabe sin
   que provenga de una interacción puntual, como fecha de nacimiento o lugar de origen)
   normalmente NO tiene compañía. No inventes un valor para rellenar el campo.

4. SITUACIÓN: bajo qué marco ocurre lo descrito — cotidiano, fiesta, conflicto,
   bajo_presion, intimo, publico... Puede ser más de un valor. Vacío si no aplica o no
   se puede inferir con lo que hay en la nota. Igual que compañía: nunca inventes un
   valor solo para no dejar el campo vacío.

5. DOMINIOS Y CAPAS: asigna 1-3 etiquetas dominio/capa.
   Dominios: ${DOMINIOS.join(', ')}.
   Capas: ${CAPAS.join(' < ')} (periférica = pública/superficial; intermedia = opiniones e
   historias que se cuentan a conocidos; central = miedos, heridas, motivaciones profundas).
   Sé conservador con "central": una nota casual rara vez toca el núcleo real de alguien.

6. CONTRADICCIÓN: si la nota misma revela una tensión (dice A pero hace B), marca
   posibleContradiccion=true. No juzgues; solo señala la tensión para el motor de perfil.

7. ACLARACIONES: enumera SOLO lo que de verdad necesitas que el usuario confirme
   (compañía incierta, situación incierta, tipo dudoso). Si todo está claro, deja la
   lista vacía: eso permite confirmación de un toque, que es el objetivo.

FORMATO: responde ÚNICAMENTE un objeto JSON válido, sin markdown ni texto extra,
con el esquema que se te indica en el mensaje del usuario.`;

const ESQUEMA_SALIDA = `{
  "contenido": "string",
  "tipo": "cita|comportamiento|observacion|respuesta|dato_conocido",
  "compania": ["string"],
  "situacion": ["string"],
  "etiquetas": [{ "dominio": "<uno de los 9>", "capa": "periferica|intermedia|central" }],
  "posibleContradiccion": boolean,
  "confianza": "baja|media|alta",
  "aclaraciones": [
    { "tipo": "elegir_compania", "opciones": ["string"] } |
    { "tipo": "elegir_situacion", "opciones": ["string"] } |
    { "tipo": "confirmar_tipo", "sugerido": "string" } |
    { "tipo": "revisar_etiquetas" }
  ]
}`;

// ------------------------------------------------------------
// Entrada y llamada
// ------------------------------------------------------------

export interface EntradaClasificacion {
  textoCrudo: string;
  persona: Persona;                 // ya resuelta por el usuario
  personasSecundarias?: Persona[];  // si la nota involucra a más de una
}

export async function clasificar(
  e: EntradaClasificacion
): Promise<PropuestaSenal> {
  const secundarias = e.personasSecundarias ?? [];
  const promptUsuario = `NOTA CRUDA DEL USUARIO:
"${e.textoCrudo}"

PERSONA DE ESTA NOTA: ${e.persona.nombre}${
    secundarias.length
      ? `\nTambién participan en la nota: ${secundarias.map(p => p.nombre).join(', ')}`
      : ''
  }

VOCABULARIO SUGERIDO para compañía y situación (ampliable, no cerrado — usa otro
valor libre si encaja mejor, o deja el campo vacío si ninguno aplica):
- Compañía: ${COMPANIA_SUGERIDA.join(', ')}
- Situación: ${SITUACION_SUGERIDA.join(', ')}

ESQUEMA DE SALIDA (responde SOLO este JSON):
${ESQUEMA_SALIDA}`;

  const propuesta = await pedirJSON<PropuestaSenal>({
    sistema: PROMPT_SISTEMA,
    usuario: promptUsuario,
    cascada: CASCADAS.clasificacion,
    maxTokens: 2000,
  });

  return sanear(propuesta);
}

// ------------------------------------------------------------
// Saneamiento
// ------------------------------------------------------------

/** Si hay aclaraciones pendientes, la confianza global no puede ser "alta". */
function sanear(p: PropuestaSenal): PropuestaSenal {
  if (p.aclaraciones.length && p.confianza === 'alta') p.confianza = 'media';
  return p;
}

// ------------------------------------------------------------
// De propuesta confirmada → Senal (tras las elecciones del usuario)
// ------------------------------------------------------------

export interface ConfirmacionUsuario {
  compania: string[];
  situacion: string[];
  tipo: TipoSenal;
  etiquetas: EtiquetaDominio[];
  contenido: string;        // el usuario pudo editarlo
  fecha: string;            // por defecto hoy; editable (el hecho pudo ser ayer)
}

export function materializarSenal(
  entrada: EntradaClasificacion,
  c: ConfirmacionUsuario
): Omit<Senal, 'id'> {
  const ids = [entrada.persona.id, ...(entrada.personasSecundarias ?? []).map(p => p.id)];

  return {
    personaIds: ids as [string, ...string[]],
    fecha: c.fecha,
    registradaEn: new Date().toISOString(),
    compania: c.compania,
    situacion: c.situacion,
    tipo: c.tipo,
    contenido: c.contenido,
    etiquetas: c.etiquetas,
  };
}
