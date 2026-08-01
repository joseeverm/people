/**
 * PERFILADOR — Motor de guía de relación
 * =======================================
 * El perfil (motor-inferencia.ts) responde "quién es esta persona". Este motor
 * responde otra cosa: "cómo me relaciono mejor con ELLA, en concreto".
 *
 * La pieza que lo hace posible es `progresionDeCapas()`: la reconstrucción, a
 * partir de las señales, de CUÁNDO se alcanzó cada capa de cada dominio y con
 * qué interacción. Eso no está en el perfil ni en el EstadoConocimiento —
 * ambos guardan la foto actual (capaMax), no el camino— y sin el camino el
 * bloque `comoSeAbre` es indistinguible de la astrología: el modelo necesita
 * ver qué TIPO de conversación produjo cada avance de profundidad para poder
 * decir por qué vía se abre esta persona.
 *
 * Exige un perfil previo: la guía razona sobre el retrato ya construido, no lo
 * reconstruye. Sin perfil no hay nada sobre lo que orientar.
 */

import type {
  Afirmacion,
  Capa,
  Dominio,
  EstadoConocimiento,
  GuiaRelacion,
  PerfilGenerado,
  Persona,
  Senal,
  TipoSenal,
} from './esquema';
import { CAPA_VALOR, DOMINIOS, NOMBRE_NIVEL } from './esquema';
import { pedirJSON, CASCADAS } from './llm';

// ------------------------------------------------------------
// Progresión de capas — la entrada que no existía
// ------------------------------------------------------------

/** Un momento en que la relación ganó profundidad en un dominio concreto. */
export interface AvanceCapa {
  dominio: Dominio;
  /** La capa que se alcanzó por primera vez con esta señal. */
  capa: Capa;
  /** Fecha en que OCURRIÓ (Senal.fecha), no cuándo se anotó. */
  fecha: string;
  senalId: string;
  tipo: TipoSenal;
  compania: string[];
  situacion: string[];
  contenido: string;
}

/**
 * Reconstruye, en orden cronológico, cada avance de profundidad: la primera
 * señal que llevó un dominio a periférica, la primera que lo llevó a
 * intermedia, la primera a central.
 *
 * Solo registra AVANCES (capa estrictamente mayor a la más profunda que ese
 * dominio ya tenía): una décima señal periférica sobre gustos no dice nada
 * sobre cómo se abre la persona, y ahogaría la señal de los momentos que sí.
 *
 * Un salto directo de periférica a central se registra tal cual, sin inventar
 * la intermedia que nunca ocurrió: ese salto ES el dato interesante.
 */
export function progresionDeCapas(senales: Senal[]): AvanceCapa[] {
  const cronologicas = [...senales].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const alcanzado = new Map<Dominio, number>();
  const avances: AvanceCapa[] = [];

  for (const s of cronologicas) {
    // Una misma señal puede etiquetar el mismo dominio en dos capas; cuenta
    // solo la más profunda, para no anotar dos avances con la misma señal.
    const masProfundaDeLaSenal = new Map<Dominio, Capa>();
    for (const e of s.etiquetas) {
      const previa = masProfundaDeLaSenal.get(e.dominio);
      if (!previa || CAPA_VALOR[e.capa] > CAPA_VALOR[previa]) {
        masProfundaDeLaSenal.set(e.dominio, e.capa);
      }
    }

    for (const [dominio, capa] of masProfundaDeLaSenal) {
      if (CAPA_VALOR[capa] <= (alcanzado.get(dominio) ?? 0)) continue;
      alcanzado.set(dominio, CAPA_VALOR[capa]);
      avances.push({
        dominio,
        capa,
        fecha: s.fecha,
        senalId: s.id,
        tipo: s.tipo,
        // Señales legadas no traen estos campos (ver esquema.ts): ?? [].
        compania: s.compania ?? [],
        situacion: s.situacion ?? [],
        contenido: s.contenido,
      });
    }
  }

  return avances;
}

// ------------------------------------------------------------
// Formateo de entradas
// ------------------------------------------------------------

function formatearSenal(s: Senal): string {
  const etiquetas = s.etiquetas.map(e => `${e.dominio}/${e.capa}`).join(', ');
  const comp = s.compania ?? [];
  const sit = s.situacion ?? [];
  const marco =
    comp.length || sit.length
      ? `compañía: ${comp.join('+') || '(sin especificar)'}, situación: ${sit.join('+') || '(sin especificar)'}`
      : 'SIN MARCO SOCIAL (dato conocido, no situado)';
  return `[${s.id}] (${s.fecha}) [${s.tipo}] [${marco}] [${etiquetas}]\n${s.contenido}`;
}

function formatearProgresion(avances: AvanceCapa[]): string {
  if (avances.length === 0) {
    return '(todavía no hay ningún avance de profundidad registrado)';
  }
  return avances
    .map(a => {
      const comp = a.compania.length ? a.compania.join('+') : '(sin especificar)';
      const sit = a.situacion.length ? a.situacion.join('+') : '(sin especificar)';
      return `- ${a.fecha} · ${a.dominio} alcanza capa ${a.capa.toUpperCase()} · tipo: ${a.tipo} · compañía: ${comp} · situación: ${sit}\n  [${a.senalId}] ${a.contenido}`;
    })
    .join('\n');
}

function formatearCobertura(estado: EstadoConocimiento): string {
  return estado.cobertura
    .map(
      c =>
        `- ${c.dominio}: ${c.capaMax ?? 'SIN DATOS'} (densidad ${c.densidad.toFixed(1)}, ${c.senales} señales)`
    )
    .join('\n');
}

/** El perfil entra reducido a lo que la guía necesita razonar, no entero. */
function perfilANucleo(p: PerfilGenerado) {
  return {
    resumen: p.resumen,
    rasgos: p.rasgos,
    gustos: p.gustos,
    disgustos: p.disgustos,
    motivaciones: p.motivaciones,
    temasSensibles: p.temasSensibles,
    contradicciones: p.contradicciones,
    porMarcoSocial: p.porMarcoSocial,
    huecos: p.huecos,
  };
}

// ------------------------------------------------------------
// El prompt de sistema
// ------------------------------------------------------------

const PROMPT_SISTEMA = `Eres el motor de guía de relación de un sistema personal de modelado de personas.
Trabajas para un único usuario que registró señales sobre una persona que conoce en la vida
real, y que ya tiene de ella un perfil generado. Tu salida no es otro retrato: es una guía
de trato.

Tu tarea es orientar al usuario sobre cómo relacionarse mejor con esta persona concreta,
basándote EXCLUSIVAMENTE en el historial de su relación. No apliques teoría genérica sobre
tipos de personalidad: si no hay señales que lo sustenten, no lo afirmes. Una guía basada en
generalidades es inútil; una basada en lo que efectivamente ha funcionado con esta persona
es lo valioso.

REGLAS EPISTÉMICAS (las mismas que rigen el perfil — violarlas invalida la guía):

1. TODA afirmación debe citar en "evidencia" los IDs de las señales que la sustentan.
   Afirmación sin evidencia = afirmación prohibida. No inventes IDs: solo existen los que
   aparecen en las señales que se te dan.

2. Clasifica cada afirmación por estatus epistémico:
   - "hecho": la señal lo dice directamente.
   - "inferencia": deducción razonable de una o más señales. Explica el salto en el texto.
   - "especulacion": hipótesis tentativa con soporte débil, útil como dirección a explorar.
   Prefiere POCAS afirmaciones bien fundadas a muchas débiles. Tres puntos sólidos por
   bloque valen más que ocho genéricos.

3. CALIBRACIÓN DE CONFIANZA: "alta" exige evidencia múltiple y consistente que incluya
   comportamiento, no solo dichos. Ante duda, baja la confianza.

4. PESO DE LA EVIDENCIA: lo que la persona HACE pesa más que lo que DICE; lo espontáneo
   más que lo respondido a pregunta directa. Las señales recientes pesan más que las viejas.

QUÉ VA EN CADA BLOQUE:

- terrenoFertil: temas de los que habla con ganas. Explica POR QUÉ le interesan (el motivo
  subyacente), no solo cuáles son: eso permite al usuario improvisar temas nuevos que encajen.

- terrenoMinado: qué evitar, por qué, y qué señales indican que se está entrando ahí.
  Incluye cómo salir del tema si se entró sin querer.

- comoSeAbre: usando la PROGRESIÓN DE CAPAS, identifica por qué vía y en qué condiciones
  esta persona se revela (reciprocidad, humor, conversaciones largas, cierto tipo de
  compañía o situación). Sé concreto: cita los momentos en que se alcanzó mayor profundidad
  y qué tenían en común.

- queValoraEnLaGente: qué admira y qué desprecia en terceros, según comentarios suyos sobre
  otras personas. Solo con evidencia real; si no hay señales sobre cómo juzga a otros, dilo
  y deja el bloque vacío.

- siguientePaso: dado el nivel actual y los huecos, qué movimiento concreto y realista
  profundizaría la relación. Debe ser accionable ("en la próxima conversación, X"),
  respetando el ritmo que ya mostró esta persona.

Si el material es insuficiente para un bloque, déjalo VACÍO en vez de rellenarlo. Un bloque
vacío es información útil: indica qué falta observar.

FORMATO DE SALIDA:
Responde ÚNICAMENTE con un objeto JSON válido, sin markdown, sin backticks, sin texto antes
o después. El esquema exacto se te da en el mensaje del usuario.`;

// ------------------------------------------------------------
// Esquema de salida
// ------------------------------------------------------------

const ESQUEMA_SALIDA = `{
  "terrenoFertil": [Afirmacion],
  "terrenoMinado": [Afirmacion],
  "comoSeAbre": [Afirmacion],
  "queValoraEnLaGente": [Afirmacion],
  "siguientePaso": [Afirmacion]
}

donde Afirmacion = {
  "texto": "string — el consejo o hallazgo, redactado para leerse antes de ver a la persona",
  "dominio": "${DOMINIOS.join('|')}",
  "capa": "periferica|intermedia|central",
  "confianza": "baja|media|alta",
  "evidencia": ["senalId", "..."],
  "estatus": "hecho|inferencia|especulacion"
}

"dominio" y "capa" son el dominio y la profundidad a los que se refiere ese punto concreto
(en "siguientePaso", los del terreno que el movimiento pretende abrir).
Todos los bloques son obligatorios en el JSON; los que no tengan material van como [].`;

// ------------------------------------------------------------
// Constructor del prompt de usuario
// ------------------------------------------------------------

export interface EntradaGuia {
  persona: Persona;
  /** Obligatorio: la guía razona sobre el perfil ya construido. */
  perfil: PerfilGenerado;
  estado: EstadoConocimiento;
  /** Todas las señales de la persona: la evidencia solo puede salir de aquí. */
  senales: Senal[];
  progresion: AvanceCapa[];
}

export function construirPromptUsuario(e: EntradaGuia): string {
  const partes: string[] = [];

  partes.push(`PERSONA: ${e.persona.nombre} (id: ${e.persona.id})
Aliases: ${e.persona.aliases.join(', ') || '(ninguno)'}
Contextos de interacción: ${e.persona.contextos.join(', ') || '(ninguno)'}`);

  partes.push(`ESTADO DE CONOCIMIENTO ACTUAL:
Nivel: ${e.estado.nivel} (${NOMBRE_NIVEL[e.estado.nivel]})
Tasa de acierto en predicciones: ${e.estado.tasaAcierto ?? 'sin datos'} (${e.estado.prediccionesResueltas} resueltas)
Cobertura por dominio:
${formatearCobertura(e.estado)}`);

  partes.push(`PERFIL VIGENTE (generado ${e.perfil.generadoEn}, sobre ${e.perfil.numSenales} señales):
${JSON.stringify(perfilANucleo(e.perfil), null, 2)}`);

  partes.push(`PROGRESIÓN DE CAPAS — cuándo y CÓMO ganó profundidad esta relación.
Cada línea es la primera vez que un dominio alcanzó esa capa, con la señal que lo produjo.
Esta es la entrada clave para "comoSeAbre": busca qué tienen en COMÚN los momentos de mayor
profundidad (el tipo de señal, la compañía, la situación, el ritmo entre unos y otros).
${formatearProgresion(e.progresion)}`);

  partes.push(`SEÑALES COMPLETAS (${e.senales.length}, en orden cronológico).
La evidencia de tus afirmaciones debe salir de estos IDs y de ningún otro:
${e.senales.map(formatearSenal).join('\n\n')}`);

  partes.push(`ESQUEMA DE SALIDA (responde SOLO este JSON):
${ESQUEMA_SALIDA}`);

  return partes.join('\n\n---\n\n');
}

// ------------------------------------------------------------
// Llamada a la API + validación
// ------------------------------------------------------------

/** Los cinco bloques, en el orden en que se presentan al usuario. */
export const BLOQUES_GUIA = [
  'terrenoFertil',
  'terrenoMinado',
  'comoSeAbre',
  'queValoraEnLaGente',
  'siguientePaso',
] as const;

export type BloqueGuia = (typeof BLOQUES_GUIA)[number];

/** Lo que produce el motor: la guía sin los campos que pone la capa de datos. */
export type GuiaGenerada = Pick<GuiaRelacion, BloqueGuia>;

export async function generarGuia(e: EntradaGuia): Promise<GuiaGenerada> {
  const guia = await pedirJSON<GuiaGenerada>({
    sistema: PROMPT_SISTEMA,
    usuario: construirPromptUsuario(e),
    cascada: CASCADAS.inferencia,
    maxTokens: 8000,
  });

  return validarGuia(guia, new Set(e.senales.map(s => s.id)));
}

/**
 * Invariante compartido con el perfil: ninguna afirmación sin evidencia, y toda
 * evidencia debe ser el ID de una señal real de esta persona. Una guía que
 * alucina IDs se rechaza entera.
 *
 * Un bloque ausente o no-lista se normaliza a []: para este motor "vacío" es
 * una respuesta legítima (así se le pide), y no vale la pena tumbar una guía
 * correcta porque el modelo omitiera una clave que no tenía con qué llenar.
 */
function validarGuia(guia: GuiaGenerada, idsValidos: Set<string>): GuiaGenerada {
  const normalizada = {} as GuiaGenerada;

  for (const bloque of BLOQUES_GUIA) {
    const lista: Afirmacion[] = Array.isArray(guia?.[bloque]) ? guia[bloque] : [];
    for (const a of lista) {
      if (!a?.evidencia?.length) {
        throw new Error(`Afirmación sin evidencia en "${bloque}": ${a?.texto ?? '(sin texto)'}`);
      }
      const fantasma = a.evidencia.find(id => !idsValidos.has(id));
      if (fantasma) {
        throw new Error(`Evidencia inexistente (${fantasma}) en "${bloque}": ${a.texto}`);
      }
    }
    normalizada[bloque] = lista;
  }

  return normalizada;
}
