/**
 * PERFILADOR — Motor de inferencia v1
 * ====================================
 * Construye el prompt que convierte señales acumuladas en un PerfilGenerado.
 * Aquí se decide si los perfiles son penetrantes o genéricos.
 *
 * Diseño:
 *  - Modo COMPLETO: todas las señales → perfil desde cero.
 *  - Modo INCREMENTAL: perfil previo + solo señales nuevas (barato en tokens).
 *  - El prompt recibe el ESTADO DE CONOCIMIENTO (nivel, cobertura) para
 *    calibrar los huecos y la franqueza de las preguntas sugeridas.
 *  - Recibe también el HISTORIAL DE CALIBRACIÓN (predicciones acertadas y
 *    falladas) para que el modelo aprenda qué tipo de inferencias fallan
 *    con esta persona concreta.
 */

import type {
  Persona,
  Senal,
  Prediccion,
  PerfilGenerado,
  EstadoConocimiento,
  Nivel,
} from './esquema';
import { NOMBRE_NIVEL, DOMINIOS, CAPAS } from './esquema';
import { pedirJSON, CASCADAS } from './llm';

// ------------------------------------------------------------
// Formateo de entradas
// ------------------------------------------------------------

function formatearSenal(s: Senal): string {
  const etiquetas = s.etiquetas
    .map(e => `${e.dominio}/${e.capa}`)
    .join(', ');
  // Señales legadas (previas al cambio) no traen estos campos: ?? [].
  const comp = s.compania ?? [];
  const sit = s.situacion ?? [];
  const compania = comp.length ? `compañía: ${comp.join('+')}` : 'compañía: (sin especificar)';
  const situacion = sit.length ? `situación: ${sit.join('+')}` : 'situación: (sin especificar)';
  const marco = comp.length || sit.length ? `${compania}, ${situacion}` : 'SIN MARCO SOCIAL (dato conocido, no situado)';
  return `[${s.id}] (${s.fecha}) [${s.tipo}] [${marco}] [${etiquetas}]\n${s.contenido}`;
}

function formatearCalibracion(predicciones: Prediccion[]): string {
  const resueltas = predicciones.filter(p =>
    ['acertada', 'parcial', 'fallida'].includes(p.estado)
  );
  if (resueltas.length === 0) return '(sin predicciones resueltas todavía)';
  return resueltas
    .map(p => `- [${p.estado.toUpperCase()}] (${p.dominio}, confianza ${p.confianza}): ${p.texto}`)
    .join('\n');
}

function formatearCobertura(estado: EstadoConocimiento): string {
  return estado.cobertura
    .map(c => `- ${c.dominio}: ${c.capaMax ?? 'SIN DATOS'} (densidad ${c.densidad.toFixed(1)}, ${c.senales} señales)`)
    .join('\n');
}

// ------------------------------------------------------------
// Instrucciones de franqueza según nivel (huecos → preguntas)
// ------------------------------------------------------------

function instruccionPreguntas(nivel: Nivel): string {
  if (nivel <= 1)
    return `Nivel de relación BAJO (${NOMBRE_NIVEL[nivel]}): las preguntas sugeridas deben ser
INDIRECTAS y de bajo riesgo social — preguntas que cualquiera haría en una charla casual,
que abren el tema sin señalar que estás indagando. Nunca preguntes directamente por miedos,
heridas o temas de capa central: propone preguntas periféricas cuyo patrón de respuesta
revele lo central de forma lateral.`;
  if (nivel <= 3)
    return `Nivel de relación MEDIO (${NOMBRE_NIVEL[nivel]}): puedes sugerir preguntas
intermedias — opiniones, historias personales, "¿por qué?" sobre cosas ya compartidas.
Los temas de capa central solo de forma tangencial, aprovechando reciprocidad (contar
algo propio primero suele abrir la puerta).`;
  return `Nivel de relación ALTO (${NOMBRE_NIVEL[nivel]}): la relación soporta preguntas
directas sobre capa central, con tacto. Aun así, prefiere preguntas que exploren matices
nuevos sobre lo ya conocido en vez de repetir terreno cubierto.`;
}

// ------------------------------------------------------------
// El prompt de sistema (el corazón)
// ------------------------------------------------------------

const PROMPT_SISTEMA = `Eres el motor de inferencia de un sistema personal de modelado de personas.
Tu tarea: a partir de señales observadas (hechos fechados, inmutables), producir un perfil
estructurado de una persona. Trabajas para un único usuario que registró las señales sobre
gente que conoce en la vida real; el perfil le ayuda a entender, anticipar y tratar mejor
a esa persona.

REGLAS EPISTÉMICAS (las más importantes — violarlas invalida el perfil):

1. TODA afirmación debe citar la evidencia que la sustenta (IDs de señal en "evidencia").
   Afirmación sin evidencia = afirmación prohibida. No inventes, no rellenes, no uses
   estereotipos ("le gusta el fútbol así que probablemente...") sin señal que lo soporte.

2. Clasifica cada afirmación por estatus epistémico:
   - "hecho": la señal lo dice directamente (cita textual, comportamiento observado).
   - "inferencia": deducción razonable de una o más señales. Explica el salto en el texto.
   - "especulacion": hipótesis tentativa con soporte débil. Úsala con moderación y solo
     si es útil como dirección a explorar.
   Prefiere pocas afirmaciones bien fundadas a muchas débiles.

3. PESO DE LA EVIDENCIA: lo que la persona HACE pesa más que lo que DICE; lo que dice
   espontáneamente pesa más que lo que responde cuando le preguntan. Las señales tipo
   'verificacion' son las más confiables. Las señales recientes pesan más que las viejas,
   especialmente en gustos y cotidianidad.

4. CONTRADICCIONES: búscalas activamente — son la información más valiosa del sistema.
   Cuando lo que la persona dice choca con lo que hace, o se comporta distinto en
   contextos distintos, repórtalo en "contradicciones" con ambos lados de la evidencia
   y una interpretación tentativa de la brecha (fachada, dependencia del contexto,
   cambio en el tiempo, autoengaño). NO promedies comportamientos incompatibles para
   producir un perfil blando: la tensión ES el hallazgo.

5. MARCO SOCIAL: cada señal lleva dos dimensiones — COMPAÑÍA (con quién está: amigos,
   familia, pareja, solo_conmigo, desconocidos, trabajo...) y SITUACIÓN (bajo qué marco:
   cotidiano, fiesta, conflicto, bajo_presion, intimo, publico...). Si el comportamiento
   de la persona cambia según la compañía, según la situación, o —más interesante
   todavía— según su CRUCE (p. ej. "cálida con amigos, salvo en conflicto"; "reservada
   en público pero directa en la intimidad"), repórtalo en "porMarcoSocial": una entrada
   por cada patrón con señales suficientes. La clave describe el patrón (no un valor
   suelto: "con amigos en conflicto", no solo "conflicto"); el valor describe cómo se
   comporta ahí. Prioriza los cruces sobre las dimensiones sueltas cuando ambos estén
   disponibles — son el hallazgo más interesante que puede dar este bloque. Las señales
   "SIN MARCO SOCIAL" (datos conocidos sin ámbito propio: cumpleaños, lugar de origen,
   edad...) NO aportan a "porMarcoSocial" — no describen ninguna máscara situacional.
   Sí cuentan como evidencia normal para el resto de secciones.

6. TEMAS SENSIBLES: identifica qué temas la incomodan, la hieren o la ponen defensiva,
   con su evidencia. Este bloque protege la relación: es el mapa de dónde NO pisar.

7. HUECOS: compara la cobertura actual contra los 9 dominios y las 3 capas. Prioriza
   los 2-3 huecos que más reducirían la incertidumbre sobre quién es esta persona
   (no los más fáciles de llenar). Para cada hueco, formula 2-4 preguntas EN LA VOZ
   DEL USUARIO — naturales, de conversación real, jamás de encuesta — respetando la
   instrucción de franqueza según el nivel de la relación que se te indica.

8. PREDICCIONES: propone dos clases, marcando cada una con su tipo:
   (a) inferida (2-3): consecuencias que se siguen directamente de las señales registradas
   y que el usuario podría no haber articulado. Sirven de síntesis, no de prueba. Ejemplo
   del razonamiento: varias señales sueltas apuntan a lo mismo y nadie lo había dicho en
   voz alta.
   (b) extrapolada (2-3): extiende un patrón observado a una situación que NO aparece en
   las señales. Debe ser comprobable en la vida real cercana y arriesgada — si es imposible
   que falle, no sirve. Ejemplo: si las señales muestran que rechaza fiestas grandes, NO
   predigas 'rechazará fiestas grandes' (ya observado); predice cómo se comportará en un
   escenario nuevo, como un grupo donde no conozca a nadie.
   Para las extrapoladas, sé explícito sobre qué patrón estás extendiendo y a qué situación
   nueva. Da a cada predicción confianza honesta y evidencia. Si el historial de calibración
   muestra que cierto tipo de extrapolación falla con esta persona, ajusta: di qué corriges.

9. CALIBRACIÓN DE CONFIANZA: "alta" exige evidencia múltiple y consistente que incluya
   comportamiento, no solo dichos. Ante duda, baja la confianza. Un perfil que lo
   afirma todo con confianza alta es un perfil mal hecho.

FORMATO DE SALIDA:
Responde ÚNICAMENTE con un objeto JSON válido, sin markdown, sin backticks, sin texto
antes o después. El esquema exacto se te da en el mensaje del usuario.`;

// ------------------------------------------------------------
// Esquema de salida (se inyecta en el prompt de usuario)
// ------------------------------------------------------------

const ESQUEMA_SALIDA = `{
  "resumen": "string (2-3 frases: quién es esta persona según el modelo)",
  "rasgos": [Afirmacion],
  "gustos": [Afirmacion],
  "disgustos": [Afirmacion],
  "motivaciones": [Afirmacion],
  "temasSensibles": [Afirmacion],
  "contradicciones": [{
    "descripcion": "string",
    "senalesEnTension": ["senalId"],
    "interpretacion": "string (opcional)",
    "confianza": "baja|media|alta"
  }],
  "porMarcoSocial": { "patrón de compañía/situación/cruce": "cómo se comporta ahí" },
  "huecos": [{
    "dominio": "${DOMINIOS.join('|')}",
    "capaObjetivo": "${CAPAS.join('|')}",
    "razon": "string",
    "preguntasSugeridas": ["string"]
  }],
  "prediccionesPropuestas": [{
    "personaId": "string",
    "dominio": "string",
    "tipo": "inferida|extrapolada",
    "texto": "string",
    "confianza": "baja|media|alta",
    "basadaEn": ["senalId"],
    "origen": "llm"
  }]
}

donde Afirmacion = {
  "texto": "string",
  "dominio": "uno de los 9 dominios",
  "capa": "periferica|intermedia|central",
  "confianza": "baja|media|alta",
  "evidencia": ["senalId", "..."],
  "estatus": "hecho|inferencia|especulacion"
}`;

// ------------------------------------------------------------
// Constructor del prompt de usuario
// ------------------------------------------------------------

export interface EntradaInferencia {
  persona: Persona;
  /** Modo completo: todas. Modo incremental: solo las nuevas. */
  senales: Senal[];
  estado: EstadoConocimiento;
  predicciones: Prediccion[];       // historial completo (para calibración)
  /** Presente → modo incremental. */
  perfilPrevio?: PerfilGenerado;
}

export function construirPromptUsuario(e: EntradaInferencia): string {
  const partes: string[] = [];

  partes.push(`PERSONA: ${e.persona.nombre} (id: ${e.persona.id})
Aliases: ${e.persona.aliases.join(', ') || '(ninguno)'}
Contextos de interacción: ${e.persona.contextos.join(', ')}`);

  partes.push(`ESTADO DE CONOCIMIENTO ACTUAL:
Nivel: ${e.estado.nivel} (${NOMBRE_NIVEL[e.estado.nivel]})
Tasa de acierto en predicciones: ${e.estado.tasaAcierto ?? 'sin datos'} (${e.estado.prediccionesResueltas} resueltas)
Cobertura por dominio:
${formatearCobertura(e.estado)}`);

  partes.push(`INSTRUCCIÓN DE FRANQUEZA PARA PREGUNTAS SUGERIDAS:
${instruccionPreguntas(e.estado.nivel)}`);

  partes.push(`HISTORIAL DE CALIBRACIÓN (aprende de esto — qué inferencias funcionan con esta persona):
${formatearCalibracion(e.predicciones)}`);

  if (e.perfilPrevio) {
    partes.push(`MODO INCREMENTAL.
PERFIL ANTERIOR (generado ${e.perfilPrevio.generadoEn}, sobre ${e.perfilPrevio.numSenales} señales):
${JSON.stringify(perfilANucleo(e.perfilPrevio), null, 2)}

SEÑALES NUEVAS desde entonces (${e.senales.length}):
${e.senales.map(formatearSenal).join('\n\n')}

Tarea: produce el perfil COMPLETO actualizado. Conserva del perfil anterior lo que las
señales nuevas no tocan; revisa lo que refuerzan, matizan o contradicen. Si una señal
nueva contradice una afirmación previa, NO la borres en silencio: o bájale la confianza,
o conviértela en contradicción reportada. La evidencia de afirmaciones conservadas se
mantiene (los IDs previos siguen siendo válidos).`);
  } else {
    partes.push(`MODO COMPLETO.
SEÑALES (${e.senales.length}, en orden cronológico):
${e.senales.map(formatearSenal).join('\n\n')}

Tarea: produce el perfil completo desde cero.`);
  }

  partes.push(`ESQUEMA DE SALIDA (responde SOLO este JSON):
${ESQUEMA_SALIDA}`);

  return partes.join('\n\n---\n\n');
}

/** Reduce el perfil previo a su núcleo para no quemar tokens en modo incremental. */
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
  };
}

// ------------------------------------------------------------
// Llamada a la API + parseo defensivo
// ------------------------------------------------------------

export async function generarPerfil(
  e: EntradaInferencia
): Promise<Omit<PerfilGenerado, 'id' | 'personaId' | 'generadoEn' | 'ultimaSenalIncluida' | 'numSenales' | 'modelo'>> {
  const perfil = await pedirJSON<
    Omit<PerfilGenerado, 'id' | 'personaId' | 'generadoEn' | 'ultimaSenalIncluida' | 'numSenales' | 'modelo'>
  >({
    sistema: PROMPT_SISTEMA,
    usuario: construirPromptUsuario(e),
    cascada: CASCADAS.inferencia,
    maxTokens: 8000,
  });

  // Validación mínima de invariantes epistémicos antes de aceptar.
  validarEvidencia(perfil, new Set(e.senales.map(s => s.id)), e.perfilPrevio);
  return perfil;
}

/**
 * Invariante: ninguna afirmación sin evidencia, y toda evidencia debe ser un
 * ID de señal real (nuevo o del perfil previo). Un perfil que alucina IDs se rechaza.
 */
function validarEvidencia(
  perfil: any,
  idsNuevos: Set<string>,
  previo?: PerfilGenerado
): void {
  const idsValidos = new Set(idsNuevos);
  if (previo) {
    for (const lista of [previo.rasgos, previo.gustos, previo.disgustos,
      previo.motivaciones, previo.temasSensibles]) {
      for (const a of lista) a.evidencia.forEach(id => idsValidos.add(id));
    }
    previo.contradicciones.forEach(c =>
      c.senalesEnTension.forEach(id => idsValidos.add(id)));
  }
  const listas = ['rasgos', 'gustos', 'disgustos', 'motivaciones', 'temasSensibles'];
  for (const nombre of listas) {
    for (const a of perfil[nombre] ?? []) {
      if (!a.evidencia?.length)
        throw new Error(`Afirmación sin evidencia en "${nombre}": ${a.texto}`);
      const fantasma = a.evidencia.find((id: string) => !idsValidos.has(id));
      if (fantasma)
        throw new Error(`Evidencia inexistente (${fantasma}) en "${nombre}": ${a.texto}`);
    }
  }
}
