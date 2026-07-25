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
  ExportBundle,
} from '../core/esquema';

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
  // export
  exportar(): Promise<ExportBundle>;
  importar(b: ExportBundle): Promise<void>;
}
