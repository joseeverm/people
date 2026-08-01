/**
 * PERFILADOR — Repository (contrato de persistencia)
 * ====================================================
 * Interfaz única de acceso a datos. Todo el resto de la app (features, UI)
 * pasa por aquí — nunca llamar a Dexie directo desde componentes. Cuando
 * llegue el server, implementará esta misma interfaz haciendo de proxy/sync
 * sin que el resto del código cambie.
 *
 * Ver invariantes en CLAUDE.md: señales append-only, nivel nunca almacenado,
 * perfiles solo como snapshots nuevos, captura nunca se pierde.
 */

import type {
  Persona,
  Senal,
  CapturaPendiente,
  Prediccion,
  PerfilGenerado,
  GuiaRelacion,
  ExportBundle,
} from '../core/esquema';
import type { OperacionOutbox } from './outbox';

/**
 * Un lote de filas ya BAJADAS del servidor y traducidas al dominio. Unión
 * discriminada por la misma razón que `OperacionPendiente`: que el repo sepa
 * en qué tabla escribe sin hacer `as` a ciegas.
 */
export type LoteBajada =
  | { entidad: 'persona'; filas: Persona[] }
  | { entidad: 'senal'; filas: Senal[] }
  | { entidad: 'prediccion'; filas: Prediccion[] }
  | { entidad: 'perfil'; filas: PerfilGenerado[] }
  | { entidad: 'guia'; filas: GuiaRelacion[] };

export interface ResultadoBajadaTabla {
  insertadas: number;
  actualizadas: number;
  /** No se tocaron: o son inmutables y ya estaban, o lo local aún no se ha
   *  subido (hay operación pendiente en el outbox para ese id) y manda. */
  omitidas: number;
}

export interface Repository {
  // personas
  listarPersonas(): Promise<Persona[]>;
  crearPersona(p: Omit<Persona, 'id' | 'creadaEn'>): Promise<Persona>;
  actualizarPersona(p: Persona): Promise<void>; // aliases/contextos sí son editables
  // señales (append-only)
  agregarSenal(s: Omit<Senal, 'id'>): Promise<Senal>;
  senalesDe(personaId: string): Promise<Senal[]>;
  /** Todas las señales, de cualquier persona — usado para sugerir en la UI
   *  valores de compania/situacion ya usados antes (no repetir vocabulario). */
  todasLasSenales(): Promise<Senal[]>;
  // cola de captura
  encolarCaptura(texto: string): Promise<CapturaPendiente>;
  pendientes(): Promise<CapturaPendiente[]>;
  asignarPersonasCaptura(idLocal: string, personaId: string, personaIdsSecundarios?: string[]): Promise<void>;
  resolverCaptura(idLocal: string, senal: Omit<Senal, 'id'>): Promise<void>;
  // predicciones
  guardarPrediccion(p: Omit<Prediccion, 'id' | 'creadaEn'>): Promise<Prediccion>;
  resolverPrediccion(id: string, estado: Prediccion['estado'], senalVerificacion: string): Promise<void>;
  /**
   * Resuelve una predicción de forma ATÓMICA: crea la Senal de verificación
   * (inmutable, como cualquier otra) y marca la predicción resuelta en una sola
   * transacción. Guarda el invariante: una predicción ya resuelta no puede
   * volver a resolverse (lanza si su estado no es 'pendiente'). Devuelve la
   * señal creada.
   */
  resolverPrediccionConVerificacion(
    prediccionId: string,
    estado: Extract<Prediccion['estado'], 'acertada' | 'parcial' | 'fallida'>,
    senal: Omit<Senal, 'id'>
  ): Promise<Senal>;
  prediccionesDe(personaId: string): Promise<Prediccion[]>;
  // perfiles (snapshots)
  guardarPerfil(p: Omit<PerfilGenerado, 'id'>): Promise<PerfilGenerado>;
  ultimoPerfil(personaId: string): Promise<PerfilGenerado | null>;
  // guías de relación (snapshots, igual que los perfiles: se agregan, nunca
  // se editan ni se sobreescriben)
  guardarGuia(g: Omit<GuiaRelacion, 'id'>): Promise<GuiaRelacion>;
  ultimaGuia(personaId: string): Promise<GuiaRelacion | null>;
  // ----------------------------------------------------------------
  // outbox — cola de subida (patrón outbox, ver data/outbox.ts)
  // ----------------------------------------------------------------
  // Toda escritura de arriba encola aquí en su MISMA transacción. Estos
  // métodos existen en el contrato para que `sync.ts` y el indicador de la UI
  // no tengan que tocar Dexie directo (ver CLAUDE.md).

  /** Pendientes en orden FIFO (el orden en que se encolaron). */
  operacionesPendientes(limite?: number): Promise<OperacionOutbox[]>;
  contarPendientes(): Promise<number>;
  /** Se llama tras subir con éxito: saca la operación de la cola. */
  descartarOperacion(id: number): Promise<void>;
  /** Deja la operación encolada e incrementa `intentos`. */
  marcarIntentoFallido(id: number, error: string): Promise<void>;

  /**
   * Encola TODO lo local que no tenga ya una operación pendiente, para que la
   * próxima subida lo empuje al servidor. Repara los dos casos en los que hay
   * datos locales sin ninguna ruta hacia el servidor:
   *
   *  - restaurar un backup: `importar()` no encola nada (ver su comentario),
   *  - datos creados antes de que el outbox existiera (Dexie v1).
   *
   * Idempotente: repetirla no duplica nada, y como los ids los genera el
   * client, reenviar algo que ya estaba arriba tampoco duplica en el servidor.
   * Devuelve cuántas operaciones encoló.
   */
  encolarTodoLoLocal(): Promise<number>;

  // ----------------------------------------------------------------
  // bajada (pull) — ver data/sync.ts
  // ----------------------------------------------------------------

  /**
   * Aplica filas traídas del servidor. Reconcilia según la entidad:
   *
   *  - `senal`, `perfil` y `guia` son INMUTABLES: si el id ya está, se ignora
   *    (no puede haber cambiado); si no, se inserta.
   *  - `persona` y `prediccion` son mutables: gana el servidor, SALVO que
   *    haya una operación pendiente en el outbox para ese id — eso significa
   *    que lo local todavía no se ha subido y tiene prioridad.
   *
   * NUNCA encola nada: lo que baja del servidor no debe volver a subir (sería
   * un eco infinito). Por eso el pull escribe por aquí y no por los métodos
   * normales del repo, que sí encolan.
   */
  aplicarBajada(lote: LoteBajada): Promise<ResultadoBajadaTabla>;

  // ----------------------------------------------------------------
  // metadatos de sincronización (clave → valor)
  // ----------------------------------------------------------------
  // Almacén genérico: qué significa cada clave lo decide `sync.ts`. Aquí solo
  // se guarda la cadena. Es donde vive el cursor del pull (la mayor marca
  // `updated_at` recibida del SERVIDOR, nunca la hora local del dispositivo).

  leerMeta(clave: string): Promise<string | null>;
  guardarMeta(clave: string, valor: string): Promise<void>;

  // export
  exportar(): Promise<ExportBundle>;
  importar(b: ExportBundle): Promise<void>;
}
