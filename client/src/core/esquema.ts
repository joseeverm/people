/**
 * PERFILADOR — Esquema de datos v1
 * =================================
 * Contrato central de la app. Todo lo demás (captura, inferencia LLM,
 * consulta inversa, UI) se construye contra estos tipos.
 *
 * Principios de diseño (decididos en ideación):
 *  1. Las SEÑALES son inmutables y fechadas: son la única fuente de verdad.
 *  2. Los PERFILES son regenerables: derivados de señales, nunca editados a mano.
 *  3. Capas epistémicas: hecho observado ≠ inferencia. Toda afirmación cita evidencia.
 *  4. Dos ejes de conocimiento: AMPLITUD (dominios) × PROFUNDIDAD (capas).
 *  5. El NIVEL se calcula, jamás se almacena.
 *  6. Preparado para relaciones entre personas (señales multi-persona), sin
 *     implementar grafo en el MVP.
 *  7. Exportable a JSON plano (ExportBundle) desde el día uno.
 */

// ============================================================
// 1. TAXONOMÍA — Dominios y capas (los dos ejes)
// ============================================================

/** Los 9 dominios que cubren a una persona. Amplitud = cuántos tienen cobertura. */
export const DOMINIOS = [
  'identidad_basica',   // edad, origen, situación de vida
  'cotidianidad',       // rutinas, hábitos, cómo pasa sus días
  'gustos_ocio',        // música, comida, planes, entretenimiento
  'trabajo_ambiciones', // a qué se dedica, qué quiere lograr
  'relaciones',         // familia, amistades, pareja, cómo se vincula
  'historia_personal',  // de dónde viene, eventos que la formaron
  'valores_creencias',  // qué considera correcto, qué la indigna
  'miedos_inseguridades', // qué evita, qué la avergüenza, qué teme
  'autoimagen',         // cómo se ve a sí misma vs. cómo es realmente
] as const;

export type Dominio = (typeof DOMINIOS)[number];

/** Capas de la cebolla (Penetración Social). Profundidad = capa máxima alcanzada. */
export const CAPAS = ['periferica', 'intermedia', 'central'] as const;
export type Capa = (typeof CAPAS)[number];

/** Orden numérico de capas para cálculos. */
export const CAPA_VALOR: Record<Capa, number> = {
  periferica: 1,
  intermedia: 2,
  central: 3,
};

/**
 * Vida media (días) de una señal por dominio: cuánto tarda su peso en caer al 50%.
 * Los valores decaen lento; los gustos, rápido. Infinity = no decae.
 */
export const VIDA_MEDIA_DIAS: Record<Dominio, number> = {
  identidad_basica: Infinity,
  historia_personal: Infinity,
  valores_creencias: 1460,      // ~4 años
  autoimagen: 1095,             // ~3 años
  miedos_inseguridades: 1095,
  relaciones: 730,              // ~2 años
  trabajo_ambiciones: 545,
  cotidianidad: 365,
  gustos_ocio: 365,
};

// ============================================================
// 2. PERSONA
// ============================================================

export interface Persona {
  id: string;                 // uuid
  nombre: string;             // nombre canónico
  /** Resolución de identidad en captura: "el flaco", "Andrés el del camping"… */
  aliases: string[];
  /**
   * Contextos en los que interactúas con esta persona. Etiquetas libres
   * ('campamento', 'trabajo', 'familia', 'vereda'). Las señales referencian una.
   */
  contextos: string[];
  notas?: string;             // nota libre NO estructurada (no participa en inferencia)
  creadaEn: string;           // ISO 8601
  archivada: boolean;         // dejó de ser relevante; no se borra su historia
}

// ============================================================
// 3. SEÑAL — el átomo del sistema (inmutable, append-only)
// ============================================================

export type TipoSenal =
  | 'observacion'    // algo que TÚ viste/notaste (tu interpretación mínima)
  | 'cita'           // palabras textuales de la persona (dichas o escritas)
  | 'respuesta'      // contestación a una pregunta que le hiciste deliberadamente
  | 'comportamiento' // acción concreta observada (lo que HIZO, no lo que dijo)
  | 'dato_conocido'  // hecho factual que ya sabes, sin interacción puntual (cumpleaños, edad, origen)
  | 'verificacion';  // resultado de una predicción (la señal de mayor peso)

/** Peso base por tipo: lo que alguien HACE pesa más que lo que dice. */
export const PESO_TIPO: Record<TipoSenal, number> = {
  verificacion: 1.0,
  comportamiento: 0.9,
  dato_conocido: 0.85, // factual y estable, pero no observado en una interacción
  cita: 0.7,
  respuesta: 0.6,   // respuestas directas pueden estar cuidadas/actuadas
  observacion: 0.5, // filtrada por tu interpretación
};

/** Una señal puede tocar varios dominios, cada uno a su propia profundidad. */
export interface EtiquetaDominio {
  dominio: Dominio;
  capa: Capa;
}

/**
 * Vocabulario sugerido para `Senal.compania` — con quién está la persona en
 * lo que describe la señal. Ampliable: no es un enum cerrado, son solo las
 * sugerencias que ofrece la UI y el clasificador; se puede escribir cualquier
 * valor libre (normalizado a minúsculas/sin tildes al guardar).
 */
export const COMPANIA_SUGERIDA = [
  'amigos',
  'familia',
  'pareja',
  'solo_conmigo',
  'desconocidos',
  'trabajo',
] as const;

/**
 * Vocabulario sugerido para `Senal.situacion` — bajo qué marco ocurre lo
 * descrito. Igual de ampliable que COMPANIA_SUGERIDA.
 */
export const SITUACION_SUGERIDA = [
  'cotidiano',
  'fiesta',
  'conflicto',
  'bajo_presion',
  'intimo',
  'publico',
] as const;

export interface Senal {
  id: string;
  /**
   * Multi-persona (preparación para el grafo): [personaId] normal;
   * ["idA","idB"] cuando la señal describe una dinámica entre dos.
   * La primera es siempre la protagonista.
   */
  personaIds: [string, ...string[]];
  fecha: string;              // cuándo OCURRIÓ (ISO 8601)
  registradaEn: string;       // cuándo la anotaste (puede diferir)
  /**
   * Con quién está la persona en lo descrito (marco social, NO lugar físico):
   * 'amigos', 'familia', 'pareja'... Puede tener varios valores. Vacío si no
   * aplica o no se pudo inferir — típicamente 'dato_conocido' (un hecho que
   * sabes sin que provenga de una interacción situada, como un cumpleaños o
   * el lugar de origen) no tiene compañía. No se inventa un valor para
   * rellenar el campo. Vocabulario sugerido en COMPANIA_SUGERIDA, ampliable.
   *
   * OPCIONAL a propósito: las señales creadas antes de introducir este campo
   * NO lo tienen en IndexedDB (no hay migración), así que al leerlas llega
   * `undefined`. Todo consumidor debe tratarlo como `?? []`.
   */
  compania?: string[];
  /**
   * Bajo qué marco ocurre lo descrito: 'cotidiano', 'fiesta', 'conflicto'...
   * Puede tener varios valores. Igual de opcional que `compania` y por las
   * mismas razones (incluida la ausencia en señales legadas). Vocabulario
   * sugerido en SITUACION_SUGERIDA, ampliable.
   */
  situacion?: string[];
  tipo: TipoSenal;
  /** El hecho, en tus palabras o textual. Con contexto suficiente para releerse en 2 años. */
  contenido: string;
  /** Asignadas por el clasificador LLM en la captura, confirmadas por ti. */
  etiquetas: EtiquetaDominio[];
  /** Solo si tipo === 'verificacion': qué predicción resuelve. */
  prediccionId?: string;
}

/** Cola offline de captura (IndexedDB → Supabase cuando haya red). */
export interface CapturaPendiente {
  idLocal: string;
  textoCrudo: string;         // lo que escribiste, sin clasificar
  registradaEn: string;
  /**
   * Asignación manual PREVIA a clasificar (la persona la elige el usuario,
   * no la IA). Persistida para no perderla si sales de la bandeja antes de
   * clasificar esta nota.
   */
  personaId?: string;
  personaIdsSecundarios?: string[];
  /** Resultado del clasificador, pendiente de tu confirmación. */
  propuesta?: {
    personaIds: string[];
    tipo: TipoSenal;
    /** Opcional: las propuestas encoladas antes del cambio no lo traen (?? []). */
    compania?: string[];
    situacion?: string[];
    etiquetas: EtiquetaDominio[];
  };
  estado: 'sin_clasificar' | 'propuesta' | 'confirmada' | 'sincronizada';
}

// ============================================================
// 4. PREDICCIÓN — el ciclo de calibración
// ============================================================

export type Confianza = 'baja' | 'media' | 'alta';

/**
 * Dos clases de predicción con propósitos distintos:
 *  - 'inferida': se sigue directamente de las señales ya registradas. Sirve de
 *    SÍNTESIS — conecta puntos que el usuario pudo pasar por alto. Casi
 *    imposible de fallar, así que NO mide capacidad predictiva.
 *  - 'extrapolada': extiende un patrón observado a una situación todavía NO
 *    observada. Es arriesgada y comprobable: la que mide de verdad si el modelo
 *    de la persona predice bien. Solo estas cuentan para la calibración.
 */
export type TipoPrediccion = 'inferida' | 'extrapolada';

export interface Prediccion {
  id: string;
  personaId: string;
  dominio: Dominio;
  tipo: TipoPrediccion;
  /** Hipótesis comprobable: "prefiere planes de pocas personas". */
  texto: string;
  confianza: Confianza;
  /** Evidencia que la sustenta (trazabilidad total). */
  basadaEn: string[];         // Senal.id[]
  origen: 'llm' | 'manual';   // el sistema la sugirió o la formulaste tú
  creadaEn: string;
  estado: 'pendiente' | 'acertada' | 'parcial' | 'fallida' | 'descartada';
  /** La señal tipo 'verificacion' que la resolvió. */
  resueltaPor?: string;       // Senal.id
}

// ============================================================
// 5. PERFIL GENERADO — snapshot regenerable (salida del LLM)
// ============================================================

/** Toda afirmación del perfil cita su evidencia y declara su estatus epistémico. */
export interface Afirmacion {
  texto: string;
  dominio: Dominio;
  capa: Capa;
  confianza: Confianza;
  evidencia: string[];        // Senal.id[] — sin evidencia no hay afirmación
  /** 'hecho' = directamente soportada; 'inferencia' = deducida; 'especulacion' = tentativa. */
  estatus: 'hecho' | 'inferencia' | 'especulacion';
}

export interface Contradiccion {
  descripcion: string;        // "dice odiar madrugar; llega siempre primero"
  senalesEnTension: string[]; // Senal.id[] de ambos lados
  /** Hipótesis sobre la brecha: fachada, contexto-dependencia, cambio en el tiempo… */
  interpretacion?: string;
  confianza: Confianza;
}

/** Hueco de información + preguntas para llenarlo, calibradas al nivel actual. */
export interface HuecoInfo {
  dominio: Dominio;
  capaObjetivo: Capa;
  /** Por qué este hueco es el prioritario ahora. */
  razon: string;
  /**
   * Preguntas en TU voz, adecuadas al nivel de la relación:
   * indirectas en niveles bajos, directas solo en altos.
   */
  preguntasSugeridas: string[];
}

export interface PerfilGenerado {
  id: string;
  personaId: string;
  generadoEn: string;
  /** Última señal incluida → permite regeneración incremental (perfil viejo + señales nuevas). */
  ultimaSenalIncluida: string;   // Senal.id
  numSenales: number;
  modelo: string;                // ej. "claude-sonnet-4-6" — para auditar calidad
  resumen: string;               // 2-3 frases: quién es esta persona según el modelo
  rasgos: Afirmacion[];
  gustos: Afirmacion[];
  disgustos: Afirmacion[];
  motivaciones: Afirmacion[];
  temasSensibles: Afirmacion[];  // qué NO tocar, o tocar con cuidado
  contradicciones: Contradiccion[];
  /**
   * Cómo cambia la persona por marco social: por compañía, por situación, o
   * por su cruce (el más interesante — p. ej. "cálida con amigos salvo en
   * conflicto"). La clave describe el patrón, no un único valor suelto.
   * Antes se llamaba `porContexto` y cubría solo un eje; ahora cubre las
   * dos dimensiones de Senal (`compania` y `situacion`).
   */
  porMarcoSocial: Record<string, string>;
  huecos: HuecoInfo[];
  /** Predicciones nuevas propuestas en esta generación (se persisten como Prediccion). */
  prediccionesPropuestas: Omit<Prediccion, 'id' | 'creadaEn' | 'estado' | 'resueltaPor'>[];
}

/**
 * GUÍA DE RELACIÓN — snapshot, como PerfilGenerado: se agregan, nunca se
 * editan ni se sobreescriben.
 *
 * El perfil responde "quién es esta persona"; la guía responde "cómo me
 * relaciono mejor con ella". Se genera A PARTIR del perfil (lo exige: sin
 * perfil previo no hay guía) más la PROGRESIÓN DE CAPAS derivada de las
 * señales — qué interacción concreta produjo cada avance de profundidad, que
 * es lo que hace posible el bloque `comoSeAbre` y no está en ningún otro sitio.
 *
 * Los cinco bloques son Afirmacion[] por lo mismo que el perfil: cada punto
 * cita su evidencia, declara confianza y estatus epistémico. Un bloque VACÍO
 * es un resultado válido y con significado — dice qué falta observar — así que
 * ni el motor lo rellena ni la vista lo esconde.
 */
export interface GuiaRelacion {
  id: string;
  personaId: string;
  generadaEn: string;
  /** Última señal incluida, para saber si la guía se quedó atrás. */
  ultimaSenalIncluida: string;   // Senal.id
  modelo: string;
  /** Temas que la encienden, y POR QUÉ le interesan (el motivo subyacente). */
  terrenoFertil: Afirmacion[];
  /** Qué evitar, con qué señal indica que se está pisando ahí. */
  terrenoMinado: Afirmacion[];
  /** Por qué vía y a qué ritmo se revela esta persona (usa la progresión de capas). */
  comoSeAbre: Afirmacion[];
  /** Qué admira o desprecia en terceros, según sus comentarios sobre otros. */
  queValoraEnLaGente: Afirmacion[];
  /** Movimiento concreto y accionable para profundizar, dado el nivel actual. */
  siguientePaso: Afirmacion[];
}

// ============================================================
// 6. NIVEL DE CONOCIMIENTO — siempre derivado, nunca almacenado
// ============================================================

export type Nivel = 0 | 1 | 2 | 3 | 4 | 5;

export const NOMBRE_NIVEL: Record<Nivel, string> = {
  0: 'Detectada',
  1: 'Conocida',
  2: 'Familiar',
  3: 'Cercana',
  4: 'Leída',
  5: 'Modelada',
};

/** Matriz de cobertura: para cada dominio, qué tan profundo llegaste y con cuánto sustento. */
export interface CoberturaDominio {
  dominio: Dominio;
  capaMax: Capa | null;       // null = dominio virgen
  /** Suma de pesos efectivos (tipo × decaimiento temporal) de sus señales. */
  densidad: number;
  senales: number;
}

export interface EstadoConocimiento {
  personaId: string;
  cobertura: CoberturaDominio[];        // los 9 dominios, siempre
  dominiosCubiertos: number;            // densidad mínima superada
  dominiosCentrales: number;            // con capa 'central' alcanzada
  /** Calibración: aciertos / resueltas. null si <3 predicciones resueltas. */
  tasaAcierto: number | null;
  prediccionesResueltas: number;
  nivel: Nivel;
}

/** Peso efectivo de una señal hoy = peso por tipo × decaimiento exponencial. */
export function pesoEfectivo(senal: Senal, dominio: Dominio, hoy: Date): number {
  const vidaMedia = VIDA_MEDIA_DIAS[dominio];
  const base = PESO_TIPO[senal.tipo];
  if (!isFinite(vidaMedia)) return base;
  const dias =
    (hoy.getTime() - new Date(senal.fecha).getTime()) / 86_400_000;
  return base * Math.pow(0.5, dias / vidaMedia);
}

/** Umbral de densidad para considerar un dominio "cubierto" (≈ 2-3 señales vigentes). */
export const DENSIDAD_MINIMA = 1.2;

/**
 * Reglas de nivel. Nota anti-inflación: N4-N5 exigen calibración demostrada,
 * no solo volumen de datos. Si todo el mundo sale N4, el sistema miente.
 *
 *  N1: capa periférica en ≥3 dominios cubiertos
 *  N2: capa intermedia en ≥3 dominios; ≥5 dominios cubiertos
 *  N3: ≥1 dominio con capa central; ≥6 dominios cubiertos; ≥1 predicción acertada
 *  N4: capa central en ≥2 de {valores_creencias, miedos_inseguridades, autoimagen};
 *      ≥1 contradicción mapeada; tasaAcierto ≥ 0.6 con ≥5 resueltas
 *  N5: capa central en los 3 dominios duros; ≥8 dominios cubiertos;
 *      tasaAcierto ≥ 0.75 con ≥10 resueltas
 */
export function calcularNivel(e: Omit<EstadoConocimiento, 'nivel'>): Nivel {
  const central = (d: Dominio) =>
    e.cobertura.some(c => c.dominio === d && c.capaMax === 'central');
  const duros: Dominio[] = ['valores_creencias', 'miedos_inseguridades', 'autoimagen'];
  const durosCentrales = duros.filter(central).length;
  const intermedios = e.cobertura.filter(
    c => c.capaMax && CAPA_VALOR[c.capaMax] >= 2 && c.densidad >= DENSIDAD_MINIMA
  ).length;

  if (
    durosCentrales === 3 && e.dominiosCubiertos >= 8 &&
    (e.tasaAcierto ?? 0) >= 0.75 && e.prediccionesResueltas >= 10
  ) return 5;
  if (
    durosCentrales >= 2 &&
    (e.tasaAcierto ?? 0) >= 0.6 && e.prediccionesResueltas >= 5
  ) return 4;
  if (e.dominiosCentrales >= 1 && e.dominiosCubiertos >= 6 && e.prediccionesResueltas >= 1)
    return 3;
  if (intermedios >= 3 && e.dominiosCubiertos >= 5) return 2;
  if (e.dominiosCubiertos >= 3) return 1;
  return 0;
}

// ============================================================
// 7. CONSULTA INVERSA — contratos (la implementación vive en el motor LLM)
// ============================================================

/** "¿A quién le gustaría este plan?" / "¿qué regalo para X?" */
export interface ConsultaInversa {
  pregunta: string;                    // lenguaje natural
  /** Restringir a un subconjunto (por defecto: todas las no archivadas). */
  personaIds?: string[];
}

export interface ResultadoConsultaInversa {
  personaId: string;
  respuesta: string;
  confianza: Confianza;
  evidencia: string[];                 // Senal.id[]
}

// ============================================================
// 8. EXPORTACIÓN — JSON plano, versionado, sin lock-in
// ============================================================

export interface ExportBundle {
  version: 1;
  exportadoEn: string;
  personas: Persona[];
  senales: Senal[];
  predicciones: Prediccion[];
  perfiles: PerfilGenerado[];          // snapshots históricos incluidos
  /**
   * OPCIONAL a propósito, y sigue siendo `version: 1`: los backups exportados
   * antes de que existieran las guías no traen el campo y tienen que poder
   * restaurarse igual. Al importar se lee como `?? []`, que para un backup
   * viejo significa "esta copia no tenía guías" — y como el import es un
   * reemplazo total, las borra igual que hace con el resto.
   */
  guias?: GuiaRelacion[];
}

// ============================================================
// 9. CONFIGURACIÓN
// ============================================================

export interface Config {
  /** El contenido viaja cifrado al servidor (AES-GCM, clave derivada de passphrase). */
  cifradoActivo: boolean;
  /** Regeneración completa cada N incrementales (control de deriva del perfil). */
  regeneracionCompletaCada: number;    // ej. 5
  modeloLLM: string;
}
