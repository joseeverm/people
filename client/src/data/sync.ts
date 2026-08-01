/**
 * SINCRONIZACIÓN — subida (push) + bajada (pull) contra Supabase.
 *
 * El ciclo completo es `sincronizar()`: primero `subir()`, después `bajar()`,
 * en ese ORDEN ESTRICTO. Al revés, un cambio local que todavía espera en el
 * outbox podría quedar pisado por la versión vieja que aún tiene el servidor.
 *
 * El cursor del pull es SIEMPRE la marca `updated_at` que mandó el servidor,
 * nunca `Date.now()` de este dispositivo: dos teléfonos con los relojes
 * desfasados se saltarían registros en silencio, que es la peor forma de
 * perder datos (sin error, sin rastro).
 *
 * Reglas de la cola de subida:
 *  - Se procesa en orden FIFO.
 *  - Éxito → la operación sale de la cola.
 *  - Fallo de RED o de sesión → se corta la pasada entera (si no hay red, las
 *    demás también fallarían) y se reintenta luego. No se pierde nada.
 *  - Conflicto de clave duplicada (23505) → se trata como ÉXITO: es un
 *    reintento de algo que ya había subido y cuya confirmación se perdió.
 *    Los ids los genera el client, así que "ya existe" solo puede significar
 *    "ya la subí yo".
 *  - Cualquier otro fallo (una fila que Postgres rechaza) → se anota el intento
 *    y se SIGUE con la siguiente, para que una operación envenenada no bloquee
 *    para siempre todo lo que venga detrás.
 */
import type { GuiaRelacion, PerfilGenerado, Persona, Prediccion, Senal } from '../core/esquema';
import type { EntidadSync, OperacionOutbox } from './outbox';
import { repo } from './dexie-repo';
import type { LoteBajada } from './repository';
import { haySupabase, supabase } from './supabase';

/** Código de Postgres para violación de unique/PK. */
const CLAVE_DUPLICADA = '23505';

/** Cuántas operaciones como mucho por pasada, para no bloquear la UI. */
const LOTE = 200;

/** Filas por página del pull. PostgREST corta en 1000 por defecto; 500 deja
 *  margen y mantiene cada aplicación a Dexie corta. */
const PAGINA = 500;

/** Orden del pull. Sin claves foráneas en el esquema el orden no afecta a la
 *  integridad; personas va primero solo para que la lista se pueble antes en
 *  la primera carga, que es la que se ve tardar. */
const ENTIDADES: EntidadSync[] = ['persona', 'senal', 'prediccion', 'perfil', 'guia'];

/** Claves de `syncMeta`. El cursor es por entidad y no global: una tabla con
 *  cambios recientes no debe empujar el cursor por delante de filas que otra
 *  tabla todavía no ha bajado. */
const CLAVE_CURSOR: Record<EntidadSync, string> = {
  persona: 'cursor:personas',
  senal: 'cursor:senales',
  prediccion: 'cursor:predicciones',
  perfil: 'cursor:perfiles',
  guia: 'cursor:guias',
};

const CLAVE_ULTIMA_SYNC = 'ultimaSincronizacion';

/** Se emite en `window` cuando un pull aplicó filas nuevas, para que una vista
 *  abierta pueda recargar lo que muestra. Las vistas leen del repo al montar,
 *  así que sin esto los datos recién bajados no se ven hasta navegar. */
export const EVENTO_DATOS_BAJADOS = 'sync:datos-bajados';

export interface ResultadoSubida {
  subidas: number;
  pendientes: number;
  /** Mensaje legible del primer fallo; null si fue todo bien. */
  error: string | null;
  /** true si se cortó por falta de red o de sesión (no es un error del dato). */
  sinConexion: boolean;
}

// ----------------------------------------------------------------------------
// Mapeo dominio → Postgres
// ----------------------------------------------------------------------------
// El client es camelCase y Postgres snake_case. La traducción es explícita a
// propósito: un mapeo automático escondería el día que un campo del esquema
// cambie de nombre y la fila se subiera incompleta en silencio.

type Fila = Record<string, unknown>;

function filaPersona(p: Persona, userId: string): Fila {
  return {
    id: p.id,
    user_id: userId,
    nombre: p.nombre,
    aliases: p.aliases,
    contextos: p.contextos,
    notas: p.notas ?? null,
    creada_en: p.creadaEn,
    archivada: p.archivada,
  };
}

function filaSenal(s: Senal, userId: string): Fila {
  return {
    id: s.id,
    user_id: userId,
    persona_ids: s.personaIds,
    fecha: s.fecha,
    registrada_en: s.registradaEn,
    // Señales legadas llegan sin estos campos (?? null, no ?? []): la columna
    // es nullable justamente para distinguir "no aplica" de "lista vacía".
    compania: s.compania ?? null,
    situacion: s.situacion ?? null,
    tipo: s.tipo,
    contenido: s.contenido,
    etiquetas: s.etiquetas,
    prediccion_id: s.prediccionId ?? null,
  };
}

function filaPrediccion(p: Prediccion, userId: string): Fila {
  return {
    id: p.id,
    user_id: userId,
    persona_id: p.personaId,
    dominio: p.dominio,
    tipo: p.tipo,
    texto: p.texto,
    confianza: p.confianza,
    basada_en: p.basadaEn,
    origen: p.origen,
    creada_en: p.creadaEn,
    estado: p.estado,
    resuelta_por: p.resueltaPor ?? null,
  };
}

function filaPerfil(p: PerfilGenerado, userId: string): Fila {
  return {
    id: p.id,
    user_id: userId,
    persona_id: p.personaId,
    generado_en: p.generadoEn,
    ultima_senal_incluida: p.ultimaSenalIncluida,
    num_senales: p.numSenales,
    modelo: p.modelo,
    resumen: p.resumen,
    rasgos: p.rasgos,
    gustos: p.gustos,
    disgustos: p.disgustos,
    motivaciones: p.motivaciones,
    temas_sensibles: p.temasSensibles,
    contradicciones: p.contradicciones,
    por_marco_social: p.porMarcoSocial,
    huecos: p.huecos,
    predicciones_propuestas: p.prediccionesPropuestas,
  };
}

function filaGuia(g: GuiaRelacion, userId: string): Fila {
  return {
    id: g.id,
    user_id: userId,
    persona_id: g.personaId,
    generada_en: g.generadaEn,
    ultima_senal_incluida: g.ultimaSenalIncluida,
    modelo: g.modelo,
    terreno_fertil: g.terrenoFertil,
    terreno_minado: g.terrenoMinado,
    como_se_abre: g.comoSeAbre,
    que_valora_en_la_gente: g.queValoraEnLaGente,
    siguiente_paso: g.siguientePaso,
  };
}

const TABLA: Record<EntidadSync, string> = {
  persona: 'personas',
  senal: 'senales',
  prediccion: 'predicciones',
  perfil: 'perfiles',
  guia: 'guias',
};

// ----------------------------------------------------------------------------
// Mapeo Postgres → dominio (el inverso del de arriba, para el pull)
// ----------------------------------------------------------------------------
// También explícito, y por un motivo extra: hay que DEJAR FUERA `user_id` y
// `updated_at`. Son columnas del servidor, no del dominio; copiarlas a Dexie
// las metería en el próximo ExportBundle y en el payload del outbox.
//
// Ojo con null vs. undefined: en las columnas opcionales el servidor manda
// `null` y el dominio espera `undefined`. En `compania`/`situacion` la
// diferencia importa de verdad — null significa "no aplica" y [] significaría
// "lista vacía" (ver esquema.ts y la migración).

interface FilaConMarca {
  id: string;
  updated_at: string;
}

interface FilaPersona extends FilaConMarca {
  nombre: string;
  aliases: string[];
  contextos: string[];
  notas: string | null;
  creada_en: string;
  archivada: boolean;
}

interface FilaSenal extends FilaConMarca {
  persona_ids: string[];
  fecha: string;
  registrada_en: string;
  compania: string[] | null;
  situacion: string[] | null;
  tipo: Senal['tipo'];
  contenido: string;
  etiquetas: Senal['etiquetas'];
  prediccion_id: string | null;
}

interface FilaPrediccion extends FilaConMarca {
  persona_id: string;
  dominio: Prediccion['dominio'];
  tipo: Prediccion['tipo'];
  texto: string;
  confianza: Prediccion['confianza'];
  basada_en: string[];
  origen: Prediccion['origen'];
  creada_en: string;
  estado: Prediccion['estado'];
  resuelta_por: string | null;
}

interface FilaPerfil extends FilaConMarca {
  persona_id: string;
  generado_en: string;
  ultima_senal_incluida: string;
  num_senales: number;
  modelo: string;
  resumen: string;
  rasgos: PerfilGenerado['rasgos'];
  gustos: PerfilGenerado['gustos'];
  disgustos: PerfilGenerado['disgustos'];
  motivaciones: PerfilGenerado['motivaciones'];
  temas_sensibles: PerfilGenerado['temasSensibles'];
  contradicciones: PerfilGenerado['contradicciones'];
  por_marco_social: PerfilGenerado['porMarcoSocial'];
  huecos: PerfilGenerado['huecos'];
  predicciones_propuestas: PerfilGenerado['prediccionesPropuestas'];
}

function desdePersona(f: FilaPersona): Persona {
  return {
    id: f.id,
    nombre: f.nombre,
    aliases: f.aliases,
    contextos: f.contextos,
    notas: f.notas ?? undefined,
    creadaEn: f.creada_en,
    archivada: f.archivada,
  };
}

function desdeSenal(f: FilaSenal): Senal {
  return {
    id: f.id,
    // La columna tiene `check (array_length >= 1)`, así que el servidor no
    // puede mandar un array vacío; el aserto solo recupera la tupla del tipo.
    personaIds: f.persona_ids as [string, ...string[]],
    fecha: f.fecha,
    registradaEn: f.registrada_en,
    compania: f.compania ?? undefined,
    situacion: f.situacion ?? undefined,
    tipo: f.tipo,
    contenido: f.contenido,
    etiquetas: f.etiquetas,
    prediccionId: f.prediccion_id ?? undefined,
  };
}

function desdePrediccion(f: FilaPrediccion): Prediccion {
  return {
    id: f.id,
    personaId: f.persona_id,
    dominio: f.dominio,
    tipo: f.tipo,
    texto: f.texto,
    confianza: f.confianza,
    basadaEn: f.basada_en,
    origen: f.origen,
    creadaEn: f.creada_en,
    estado: f.estado,
    resueltaPor: f.resuelta_por ?? undefined,
  };
}

function desdePerfil(f: FilaPerfil): PerfilGenerado {
  return {
    id: f.id,
    personaId: f.persona_id,
    generadoEn: f.generado_en,
    ultimaSenalIncluida: f.ultima_senal_incluida,
    numSenales: f.num_senales,
    modelo: f.modelo,
    resumen: f.resumen,
    rasgos: f.rasgos,
    gustos: f.gustos,
    disgustos: f.disgustos,
    motivaciones: f.motivaciones,
    temasSensibles: f.temas_sensibles,
    contradicciones: f.contradicciones,
    porMarcoSocial: f.por_marco_social,
    huecos: f.huecos,
    prediccionesPropuestas: f.predicciones_propuestas,
  };
}

interface FilaGuia extends FilaConMarca {
  persona_id: string;
  generada_en: string;
  ultima_senal_incluida: string;
  modelo: string;
  terreno_fertil: GuiaRelacion['terrenoFertil'];
  terreno_minado: GuiaRelacion['terrenoMinado'];
  como_se_abre: GuiaRelacion['comoSeAbre'];
  que_valora_en_la_gente: GuiaRelacion['queValoraEnLaGente'];
  siguiente_paso: GuiaRelacion['siguientePaso'];
}

function desdeGuia(f: FilaGuia): GuiaRelacion {
  return {
    id: f.id,
    personaId: f.persona_id,
    generadaEn: f.generada_en,
    ultimaSenalIncluida: f.ultima_senal_incluida,
    modelo: f.modelo,
    terrenoFertil: f.terreno_fertil,
    terrenoMinado: f.terreno_minado,
    comoSeAbre: f.como_se_abre,
    queValoraEnLaGente: f.que_valora_en_la_gente,
    siguientePaso: f.siguiente_paso,
  };
}

/** Empaqueta una página cruda en el lote tipado que espera el repo. */
function aLote(entidad: EntidadSync, filas: FilaConMarca[]): LoteBajada {
  switch (entidad) {
    case 'persona':
      return { entidad, filas: (filas as FilaPersona[]).map(desdePersona) };
    case 'senal':
      return { entidad, filas: (filas as FilaSenal[]).map(desdeSenal) };
    case 'prediccion':
      return { entidad, filas: (filas as FilaPrediccion[]).map(desdePrediccion) };
    case 'perfil':
      return { entidad, filas: (filas as FilaPerfil[]).map(desdePerfil) };
    case 'guia':
      return { entidad, filas: (filas as FilaGuia[]).map(desdeGuia) };
  }
}

/** Traduce la operación encolada a (tabla, fila). El switch sobre `entidad`
 *  estrecha el tipo del payload — de ahí la unión discriminada de outbox.ts. */
function traducir(op: OperacionOutbox, userId: string): { tabla: string; fila: Fila } {
  switch (op.entidad) {
    case 'persona':
      return { tabla: TABLA.persona, fila: filaPersona(op.payload, userId) };
    case 'senal':
      return { tabla: TABLA.senal, fila: filaSenal(op.payload, userId) };
    case 'prediccion':
      return { tabla: TABLA.prediccion, fila: filaPrediccion(op.payload, userId) };
    case 'perfil':
      return { tabla: TABLA.perfil, fila: filaPerfil(op.payload, userId) };
    case 'guia':
      return { tabla: TABLA.guia, fila: filaGuia(op.payload, userId) };
  }
}

// ----------------------------------------------------------------------------
// Subida
// ----------------------------------------------------------------------------

/** Un fallo de red se distingue por no traer código de Postgres. */
function esFalloDeRed(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code) return false;
  return /fetch|network|failed to fetch|load failed/i.test(error.message ?? '');
}

/** Aplica UNA operación. Devuelve null si quedó aplicada (o ya lo estaba). */
async function aplicar(op: OperacionOutbox, userId: string): Promise<{ code?: string; message: string } | null> {
  const { tabla, fila } = traducir(op, userId);

  if (op.operacion === 'insert') {
    const { error } = await supabase.from(tabla).insert(fila);
    // Ya existía: la subida anterior sí llegó y se perdió la confirmación.
    if (error && error.code === CLAVE_DUPLICADA) return null;
    return error ? { code: error.code, message: error.message } : null;
  }

  // update → upsert: si el insert original nunca llegó a subir (se quedó atrás
  // por un fallo puntual), un UPDATE puro no afectaría ninguna fila y el dato
  // se perdería en silencio. El upsert deja la fila en su estado final, que es
  // justo lo que lleva el payload.
  const { error } = await supabase.from(tabla).upsert(fila, { onConflict: 'id' });
  return error ? { code: error.code, message: error.message } : null;
}

/**
 * Vacía el outbox. Es seguro llamarla en paralelo por accidente: `enCurso`
 * evita dos pasadas simultáneas subiendo la misma operación dos veces.
 */
let enCurso: Promise<ResultadoSubida> | null = null;

export function subir(): Promise<ResultadoSubida> {
  if (!enCurso) {
    enCurso = subirUnaVez().finally(() => {
      enCurso = null;
    });
  }
  return enCurso;
}

async function subirUnaVez(): Promise<ResultadoSubida> {
  const pendientesIniciales = await repo.contarPendientes();
  const base: ResultadoSubida = {
    subidas: 0,
    pendientes: pendientesIniciales,
    error: null,
    sinConexion: false,
  };

  if (!haySupabase) {
    return { ...base, error: 'Sin configurar Supabase (falta .env.local).' };
  }
  if (pendientesIniciales === 0) return base;
  if (!navigator.onLine) return { ...base, sinConexion: true };

  // getSession lee de localStorage y no exige red: si el token está vencido y
  // no se puede refrescar (sin cobertura), la subida espera al próximo intento.
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) return { ...base, sinConexion: true, error: 'Sin sesión activa.' };

  const operaciones = await repo.operacionesPendientes(LOTE);
  let subidas = 0;
  let primerError: string | null = null;

  for (const op of operaciones) {
    if (op.id === undefined) continue;
    let fallo: { code?: string; message: string } | null;
    try {
      fallo = await aplicar(op, userId);
    } catch (e) {
      // supabase-js normalmente devuelve el error en vez de lanzarlo; si lanza,
      // es un fallo de transporte.
      fallo = { message: e instanceof Error ? e.message : String(e) };
    }

    if (!fallo) {
      await repo.descartarOperacion(op.id);
      subidas++;
      continue;
    }

    await repo.marcarIntentoFallido(op.id, fallo.message);
    primerError ??= fallo.message;

    // Sin red no tiene sentido seguir quemando la cola: todas fallarían igual.
    if (esFalloDeRed(fallo)) {
      return {
        subidas,
        pendientes: await repo.contarPendientes(),
        error: null,
        sinConexion: true,
      };
    }
    // Cualquier otro fallo es de ESTA fila: se sigue con la siguiente.
  }

  return {
    subidas,
    pendientes: await repo.contarPendientes(),
    error: primerError,
    sinConexion: false,
  };
}

// ----------------------------------------------------------------------------
// Bajada (pull)
// ----------------------------------------------------------------------------

export interface ProgresoBajada {
  entidad: EntidadSync;
  /** Filas ya aplicadas de ESTA entidad en esta pasada. */
  descargadas: number;
  /** Cuántas dice tener el servidor. Solo se pide en la primera carga, que es
   *  la única con una barra que llenar; en un pull incremental es null. */
  total: number | null;
  primeraCarga: boolean;
}

export interface ResultadoBajada {
  descargadas: number;
  insertadas: number;
  actualizadas: number;
  omitidas: number;
  /** Mensaje legible del primer fallo; null si fue todo bien. */
  error: string | null;
  sinConexion: boolean;
  /** Alguna entidad no tenía cursor: se bajó su historial completo. */
  primeraCarga: boolean;
}

/** Una página de una entidad, desde el cursor (excluido) hacia adelante. */
async function pedirPagina(
  entidad: EntidadSync,
  userId: string,
  cursor: string | null
): Promise<{ filas: FilaConMarca[]; error: { code?: string; message: string } | null }> {
  let consulta = supabase
    .from(TABLA[entidad])
    .select('*')
    // RLS ya filtra por usuario. El filtro explícito no sobra: es lo que hace
    // que el plan use el índice (user_id, updated_at), creado para esto.
    .eq('user_id', userId)
    .order('updated_at', { ascending: true })
    .limit(PAGINA);

  if (cursor) consulta = consulta.gt('updated_at', cursor);

  const { data, error } = await consulta;
  if (error) return { filas: [], error: { code: error.code, message: error.message } };
  return { filas: (data ?? []) as FilaConMarca[], error: null };
}

/** Solo para la barra de progreso de la primera carga. Si falla, se baja
 *  igual: no saber el total no impide descargar. */
async function contarEnServidor(entidad: EntidadSync, userId: string): Promise<number | null> {
  const { count, error } = await supabase
    .from(TABLA[entidad])
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  return error ? null : (count ?? null);
}

let enCursoBajada: Promise<ResultadoBajada> | null = null;

/**
 * Trae del servidor lo cambiado desde el último pull. Como `subir()`, es segura
 * si se llama dos veces a la vez: la segunda se engancha a la pasada en curso.
 */
export function bajar(alProgresar?: (p: ProgresoBajada) => void): Promise<ResultadoBajada> {
  if (!enCursoBajada) {
    enCursoBajada = bajarUnaVez(alProgresar).finally(() => {
      enCursoBajada = null;
    });
  }
  return enCursoBajada;
}

async function bajarUnaVez(alProgresar?: (p: ProgresoBajada) => void): Promise<ResultadoBajada> {
  const r: ResultadoBajada = {
    descargadas: 0,
    insertadas: 0,
    actualizadas: 0,
    omitidas: 0,
    error: null,
    sinConexion: false,
    primeraCarga: false,
  };

  if (!haySupabase) return { ...r, error: 'Sin configurar Supabase (falta .env.local).' };
  if (!navigator.onLine) return { ...r, sinConexion: true };

  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) return { ...r, sinConexion: true, error: 'Sin sesión activa.' };

  for (const entidad of ENTIDADES) {
    const cursorInicial = await repo.leerMeta(CLAVE_CURSOR[entidad]);
    // Que NO exista cursor es lo que define "primera carga", y basta con eso:
    // que Dexie esté vacío es la consecuencia habitual, no un requisito. Un
    // dispositivo con datos previos al pull también tiene que bajarlo todo, y
    // los ids repetidos se descartan solos al reconciliar.
    const primeraCarga = cursorInicial === null;
    if (primeraCarga) r.primeraCarga = true;

    const total = primeraCarga ? await contarEnServidor(entidad, userId) : null;
    let cursor = cursorInicial;
    let descargadasEntidad = 0;

    if (primeraCarga) alProgresar?.({ entidad, descargadas: 0, total, primeraCarga });

    for (;;) {
      const { filas, error } = await pedirPagina(entidad, userId, cursor);

      if (error) {
        // Sin red las demás entidades fallarían igual: se corta la pasada
        // entera y se reintenta luego. Nada que reparar.
        if (esFalloDeRed(error)) return { ...r, sinConexion: true };
        // Cualquier otro fallo es de ESTA tabla: se anota y se sigue con la
        // siguiente, igual que en la subida — una tabla que el servidor
        // rechaza no debe dejar sin sincronizar a las otras tres.
        r.error ??= `${TABLA[entidad]}: ${error.message}`;
        break;
      }

      if (filas.length === 0) break;

      const aplicado = await repo.aplicarBajada(aLote(entidad, filas));
      r.insertadas += aplicado.insertadas;
      r.actualizadas += aplicado.actualizadas;
      r.omitidas += aplicado.omitidas;
      r.descargadas += filas.length;
      descargadasEntidad += filas.length;

      // El cursor avanza DESPUÉS de aplicar y con la marca DEL SERVIDOR (nunca
      // la hora local). Si el navegador se cierra justo aquí, la próxima pasada
      // repite esta página como mucho —los ids ya están y se omiten— en vez de
      // saltársela, que sería perder datos en silencio.
      const anterior = cursor;
      cursor = filas[filas.length - 1].updated_at; // vienen ascendentes
      await repo.guardarMeta(CLAVE_CURSOR[entidad], cursor);

      alProgresar?.({ entidad, descargadas: descargadasEntidad, total, primeraCarga });

      if (filas.length < PAGINA) break;

      if (cursor === anterior) {
        // Una página entera con la misma marca: `gt` volvería a pedir lo mismo.
        // En la práctica no puede pasar (cada fila se inserta en su propia
        // petición, con su propio now()), pero un bucle infinito en una PWA es
        // peor que un aviso.
        r.error ??= `${TABLA[entidad]}: ${PAGINA} filas comparten marca; el cursor no avanza.`;
        break;
      }
    }
  }

  if (r.insertadas + r.actualizadas > 0) {
    window.dispatchEvent(new CustomEvent(EVENTO_DATOS_BAJADOS));
  }
  return r;
}

// ----------------------------------------------------------------------------
// Ciclo completo
// ----------------------------------------------------------------------------

export type FaseSync = 'subiendo' | 'bajando' | 'quieto';

export interface OpcionesSync {
  alProgresar?: (p: ProgresoBajada) => void;
  alCambiarFase?: (fase: FaseSync) => void;
}

export interface ResultadoSync {
  subida: ResultadoSubida;
  /** null si no se llegó a bajar (la subida se cortó por falta de red). */
  bajada: ResultadoBajada | null;
}

let enCursoSync: Promise<ResultadoSync> | null = null;

/**
 * El ciclo completo: subir y DESPUÉS bajar. Nunca al revés — si se bajara
 * primero, un cambio local todavía encolado quedaría pisado por la versión
 * vieja del servidor antes de haber tenido ocasión de subir.
 */
export function sincronizar(opciones: OpcionesSync = {}): Promise<ResultadoSync> {
  if (!enCursoSync) {
    enCursoSync = cicloCompleto(opciones).finally(() => {
      enCursoSync = null;
    });
  }
  return enCursoSync;
}

async function cicloCompleto(o: OpcionesSync): Promise<ResultadoSync> {
  try {
    o.alCambiarFase?.('subiendo');
    const subida = await subir();

    // Sin red la bajada fallaría igual, y además dejaría el outbox lleno: es
    // exactamente el escenario que el orden estricto evita.
    if (subida.sinConexion) return { subida, bajada: null };

    o.alCambiarFase?.('bajando');
    const bajada = await bajar(o.alProgresar);

    if (!bajada.error && !bajada.sinConexion) {
      // Hora LOCAL, y aquí sí está bien: esto se le muestra al usuario en su
      // propio dispositivo ("hace 5 minutos"), no se compara con marcas del
      // servidor ni decide qué filas bajar.
      await repo.guardarMeta(CLAVE_ULTIMA_SYNC, new Date().toISOString());
    }

    return { subida, bajada };
  } finally {
    o.alCambiarFase?.('quieto');
  }
}

/** Última sincronización completa correcta (ISO), o null si nunca hubo una. */
export function leerUltimaSincronizacion(): Promise<string | null> {
  return repo.leerMeta(CLAVE_ULTIMA_SYNC);
}
