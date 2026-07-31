/**
 * OUTBOX — cola local de operaciones pendientes de subir.
 *
 * El patrón: toda escritura entra en IndexedDB **y** deja una operación aquí,
 * en la MISMA transacción de Dexie. O se guardan las dos cosas o ninguna, así
 * que es imposible que un dato quede escrito en local sin quedar encolado para
 * el servidor (que es como se pierden datos en las apps offline-first).
 *
 * La escritura local nunca espera al servidor: `subir()` (ver sync.ts) vacía
 * esta cola después, cuando haya red y sesión.
 */
import type { Persona, PerfilGenerado, Prediccion, Senal } from '../core/esquema';

export type EntidadSync = 'persona' | 'senal' | 'prediccion' | 'perfil';

/** Qué entidad lleva cada payload. Empareja `entidad` con el tipo del `payload`
 *  para que el mapeo a Postgres no tenga que hacer `as` a ciegas. */
export type OperacionPendiente =
  | { entidad: 'persona'; payload: Persona }
  | { entidad: 'senal'; payload: Senal }
  | { entidad: 'prediccion'; payload: Prediccion }
  | { entidad: 'perfil'; payload: PerfilGenerado };

export type OperacionOutbox = OperacionPendiente & {
  /** Autoincremental de Dexie: define el orden FIFO de subida. Opcional
   *  porque al insertar todavía no existe; Dexie lo asigna. */
  id?: number;
  operacion: 'insert' | 'update';
  creadoEn: string;
  /** Cuántas veces se intentó subir y falló. Solo informativo (para la UI y
   *  para detectar una operación envenenada): nada se descarta por contador. */
  intentos: number;
  /** Último error, para poder enseñar algo concreto en el indicador. */
  ultimoError?: string;
};
