/**
 * PERFILADOR — Implementación Dexie del Repository
 * ===================================================
 * IndexedDB local. Es la única implementación mientras no exista server
 * (ver CLAUDE.md § Estado del proyecto).
 *
 * Invariantes que esta clase debe respetar SIEMPRE:
 *  - `senales`: append-only. No exponer ningún método de update/delete sobre
 *    una Senal confirmada; corregir = agregar una señal nueva.
 *  - `perfiles`: solo se agregan snapshots nuevos. `guardarPerfil` nunca hace
 *    put/update sobre un id existente.
 *  - El nivel de conocimiento NO se guarda en ninguna tabla: se calcula al
 *    vuelo desde `core/esquema.ts` (calcularNivel + pesoEfectivo) a partir de
 *    `senales`.
 */

import Dexie, { type EntityTable, type Table } from 'dexie';
import type {
  Persona,
  Senal,
  CapturaPendiente,
  Prediccion,
  PerfilGenerado,
  GuiaRelacion,
  ExportBundle,
} from '../core/esquema';
import type { EntidadSync, OperacionOutbox, OperacionPendiente } from './outbox';
import type { LoteBajada, Repository, ResultadoBajadaTabla } from './repository';

/** Estados de CapturaPendiente que ya no cuentan como "pendientes" para la UI. */
const ESTADOS_RESUELTOS: CapturaPendiente['estado'][] = ['confirmada', 'sincronizada'];

/** Fila de `syncMeta`. Almacenamiento puro clave→valor: el significado de las
 *  claves lo pone sync.ts, no esta capa. */
interface MetaSync {
  clave: string;
  valor: string;
}

const SIN_CAMBIOS: ResultadoBajadaTabla = { insertadas: 0, actualizadas: 0, omitidas: 0 };

/**
 * Dexie deriva de T tanto el tipo de la clave como el de inserción (donde `id`
 * pasa a ser opcional). Con un T todavía sin instanciar eso no resuelve, y los
 * helpers genéricos de la bajada dejan de compilar por `anyOf(string[])`.
 *
 * Las cuatro tablas del pull tienen `id: string` obligatorio —los ids los
 * genera el client con crypto.randomUUID() antes de escribir—, así que esta
 * vista describe la realidad; no es un cast de conveniencia para callar a tsc.
 */
function comoTablaDeIds<T extends { id: string }>(t: EntityTable<T, 'id'>): Table<T, string> {
  return t as unknown as Table<T, string>;
}

export class DexieRepo extends Dexie implements Repository {
  personas!: EntityTable<Persona, 'id'>;
  senales!: EntityTable<Senal, 'id'>;
  capturasPendientes!: EntityTable<CapturaPendiente, 'idLocal'>;
  predicciones!: EntityTable<Prediccion, 'id'>;
  perfiles!: EntityTable<PerfilGenerado, 'id'>;
  guias!: EntityTable<GuiaRelacion, 'id'>;
  outbox!: EntityTable<OperacionOutbox, 'id'>;
  syncMeta!: EntityTable<MetaSync, 'clave'>;

  constructor() {
    super('perfilador');
    this.version(1).stores({
      personas: 'id, nombre, archivada',
      // *personaIds: índice multi-entrada, una señal puede tocar varias personas.
      senales: 'id, *personaIds, fecha, tipo, prediccionId',
      capturasPendientes: 'idLocal, estado, registradaEn',
      predicciones: 'id, personaId, estado, dominio',
      perfiles: 'id, personaId, generadoEn',
    });
    // v2: cola de subida. Dexie conserva las tablas de v1 tal cual; los datos
    // que ya existían NO se encolan (nunca estuvieron en el servidor y no hay
    // pull todavía para reconciliarlos) — ver nota en README/CLAUDE.md.
    // `++id` autoincremental: es lo que da el orden FIFO de la cola.
    this.version(2).stores({
      outbox: '++id, entidad, creadoEn',
    });
    // v3: metadatos del pull. Guarda el cursor por entidad (la mayor marca
    // `updated_at` que mandó el SERVIDOR) y la última sincronización correcta.
    // Que no exista cursor es justamente lo que marca "primera carga": un
    // dispositivo nuevo baja el historial entero.
    this.version(3).stores({
      syncMeta: 'clave',
    });
    // v4: guías de relación. Snapshots como los perfiles (se agregan, nunca se
    // sobreescriben), así que el índice es el mismo: por persona y por fecha,
    // que es lo único que se consulta (la última de cada persona).
    this.version(4).stores({
      guias: 'id, personaId, generadaEn',
    });
  }

  /**
   * Encola una operación para el servidor. SIEMPRE debe llamarse dentro de la
   * misma transacción que la escritura local que la origina: si Dexie revierte,
   * se va la escritura y la operación encolada juntas.
   */
  private encolar(op: OperacionPendiente, operacion: 'insert' | 'update') {
    return this.outbox.add({
      ...op,
      operacion,
      creadoEn: new Date().toISOString(),
      intentos: 0,
    } as OperacionOutbox);
  }

  // ------------------------------------------------------------
  // personas
  // ------------------------------------------------------------

  async listarPersonas(): Promise<Persona[]> {
    return this.personas.toArray();
  }

  async crearPersona(p: Omit<Persona, 'id' | 'creadaEn'>): Promise<Persona> {
    const persona: Persona = {
      ...p,
      id: crypto.randomUUID(),
      creadaEn: new Date().toISOString(),
    };
    await this.transaction('rw', this.personas, this.outbox, async () => {
      await this.personas.add(persona);
      await this.encolar({ entidad: 'persona', payload: persona }, 'insert');
    });
    return persona;
  }

  async actualizarPersona(p: Persona): Promise<void> {
    await this.transaction('rw', this.personas, this.outbox, async () => {
      await this.personas.put(p);
      await this.encolar({ entidad: 'persona', payload: p }, 'update');
    });
  }

  // ------------------------------------------------------------
  // señales (append-only — sin update ni delete)
  // ------------------------------------------------------------

  async agregarSenal(s: Omit<Senal, 'id'>): Promise<Senal> {
    const senal: Senal = { ...s, id: crypto.randomUUID() };
    // Dexie anida transacciones: si ya hay una abierta que incluya estas dos
    // tablas (resolverCaptura, resolverPrediccionConVerificacion), esto se
    // suma a ella en vez de abrir otra.
    await this.transaction('rw', this.senales, this.outbox, async () => {
      await this.senales.add(senal);
      await this.encolar({ entidad: 'senal', payload: senal }, 'insert');
    });
    return senal;
  }

  async senalesDe(personaId: string): Promise<Senal[]> {
    const senales = await this.senales.where('personaIds').equals(personaId).toArray();
    return senales.sort((a, b) => a.fecha.localeCompare(b.fecha));
  }

  async todasLasSenales(): Promise<Senal[]> {
    return this.senales.toArray();
  }

  // ------------------------------------------------------------
  // cola de captura (la captura nunca se pierde)
  // ------------------------------------------------------------

  async encolarCaptura(texto: string): Promise<CapturaPendiente> {
    const captura: CapturaPendiente = {
      idLocal: crypto.randomUUID(),
      textoCrudo: texto,
      registradaEn: new Date().toISOString(),
      estado: 'sin_clasificar',
    };
    await this.capturasPendientes.add(captura);
    return captura;
  }

  async pendientes(): Promise<CapturaPendiente[]> {
    const todas = await this.capturasPendientes.toArray();
    return todas.filter(c => !ESTADOS_RESUELTOS.includes(c.estado));
  }

  async asignarPersonasCaptura(
    idLocal: string,
    personaId: string,
    personaIdsSecundarios: string[] = []
  ): Promise<void> {
    await this.capturasPendientes.update(idLocal, { personaId, personaIdsSecundarios });
  }

  async resolverCaptura(idLocal: string, senal: Omit<Senal, 'id'>): Promise<void> {
    // `outbox` entra en el ámbito porque agregarSenal encola dentro.
    await this.transaction(
      'rw',
      this.capturasPendientes,
      this.senales,
      this.outbox,
      async () => {
        await this.agregarSenal(senal);
        await this.capturasPendientes.update(idLocal, { estado: 'confirmada' });
      }
    );
  }

  // ------------------------------------------------------------
  // predicciones
  // ------------------------------------------------------------

  async guardarPrediccion(p: Omit<Prediccion, 'id' | 'creadaEn'>): Promise<Prediccion> {
    const prediccion: Prediccion = {
      ...p,
      id: crypto.randomUUID(),
      creadaEn: new Date().toISOString(),
    };
    await this.transaction('rw', this.predicciones, this.outbox, async () => {
      await this.predicciones.add(prediccion);
      await this.encolar({ entidad: 'prediccion', payload: prediccion }, 'insert');
    });
    return prediccion;
  }

  async resolverPrediccion(
    id: string,
    estado: Prediccion['estado'],
    senalVerificacion: string
  ): Promise<void> {
    await this.transaction('rw', this.predicciones, this.outbox, async () => {
      const actual = await this.predicciones.get(id);
      if (!actual) throw new Error(`Predicción ${id} no existe.`);
      if (actual.estado !== 'pendiente')
        throw new Error(`La predicción ya fue resuelta (${actual.estado}); no se puede volver a resolver.`);
      await this.predicciones.update(id, { estado, resueltaPor: senalVerificacion });
      // El payload del outbox es la entidad COMPLETA, no el parche: quien sube
      // no tiene que reconstruir el estado previo ni depende del orden con
      // otras actualizaciones de la misma fila.
      const actualizada: Prediccion = { ...actual, estado, resueltaPor: senalVerificacion };
      await this.encolar({ entidad: 'prediccion', payload: actualizada }, 'update');
    });
  }

  async resolverPrediccionConVerificacion(
    prediccionId: string,
    estado: Extract<Prediccion['estado'], 'acertada' | 'parcial' | 'fallida'>,
    senal: Omit<Senal, 'id'>
  ): Promise<Senal> {
    return this.transaction('rw', this.predicciones, this.senales, this.outbox, async () => {
      const actual = await this.predicciones.get(prediccionId);
      if (!actual) throw new Error(`Predicción ${prediccionId} no existe.`);
      if (actual.estado !== 'pendiente')
        throw new Error(`La predicción ya fue resuelta (${actual.estado}); no se puede volver a resolver.`);
      // agregarSenal ya encola su propio insert; aquí solo falta la predicción.
      const creada = await this.agregarSenal(senal);
      await this.predicciones.update(prediccionId, { estado, resueltaPor: creada.id });
      const actualizada: Prediccion = { ...actual, estado, resueltaPor: creada.id };
      await this.encolar({ entidad: 'prediccion', payload: actualizada }, 'update');
      return creada;
    });
  }

  async prediccionesDe(personaId: string): Promise<Prediccion[]> {
    return this.predicciones.where('personaId').equals(personaId).toArray();
  }

  // ------------------------------------------------------------
  // perfiles (solo snapshots — nunca se editan ni se sobreescriben)
  // ------------------------------------------------------------

  async guardarPerfil(p: Omit<PerfilGenerado, 'id'>): Promise<PerfilGenerado> {
    const perfil: PerfilGenerado = { ...p, id: crypto.randomUUID() };
    await this.transaction('rw', this.perfiles, this.outbox, async () => {
      await this.perfiles.add(perfil);
      await this.encolar({ entidad: 'perfil', payload: perfil }, 'insert');
    });
    return perfil;
  }

  async ultimoPerfil(personaId: string): Promise<PerfilGenerado | null> {
    const perfiles = await this.perfiles.where('personaId').equals(personaId).toArray();
    if (perfiles.length === 0) return null;
    return perfiles.reduce((mas, p) => (p.generadoEn > mas.generadoEn ? p : mas));
  }

  // ------------------------------------------------------------
  // guías de relación (mismas reglas que los perfiles: solo snapshots)
  // ------------------------------------------------------------

  async guardarGuia(g: Omit<GuiaRelacion, 'id'>): Promise<GuiaRelacion> {
    const guia: GuiaRelacion = { ...g, id: crypto.randomUUID() };
    await this.transaction('rw', this.guias, this.outbox, async () => {
      await this.guias.add(guia);
      await this.encolar({ entidad: 'guia', payload: guia }, 'insert');
    });
    return guia;
  }

  async ultimaGuia(personaId: string): Promise<GuiaRelacion | null> {
    const guias = await this.guias.where('personaId').equals(personaId).toArray();
    if (guias.length === 0) return null;
    return guias.reduce((mas, g) => (g.generadaEn > mas.generadaEn ? g : mas));
  }

  // ------------------------------------------------------------
  // outbox (lo consume sync.ts; la UI solo lee el contador)
  // ------------------------------------------------------------

  /** En orden FIFO: el autoincremental de Dexie es el orden de encolado. */
  async operacionesPendientes(limite = 200): Promise<OperacionOutbox[]> {
    return this.outbox.orderBy('id').limit(limite).toArray();
  }

  async contarPendientes(): Promise<number> {
    return this.outbox.count();
  }

  async descartarOperacion(id: number): Promise<void> {
    await this.outbox.delete(id);
  }

  /** Deja la operación en la cola y anota el intento fallido. Nada se descarta
   *  por número de intentos: perder una escritura en silencio sería peor que
   *  reintentarla para siempre y que se vea en el indicador. */
  async marcarIntentoFallido(id: number, error: string): Promise<void> {
    await this.transaction('rw', this.outbox, async () => {
      const op = await this.outbox.get(id);
      if (!op) return;
      await this.outbox.update(id, { intentos: op.intentos + 1, ultimoError: error });
    });
  }

  /**
   * Encola todo lo local que aún no esté en la cola. Ver el contrato en
   * repository.ts para el porqué (backup restaurado / datos pre-outbox).
   *
   * La operación elegida por entidad NO es casual:
   *  - inmutables ('senal', 'perfil', 'guia') → 'insert'. Si ya estaban arriba,
   *    el 23505 se trata como éxito y no se toca la fila del servidor, que es
   *    justo lo que se quiere de algo inmutable.
   *  - mutables ('persona', 'prediccion') → 'update', que sube como upsert:
   *    exista o no en el servidor, queda con el estado local, que es lo que
   *    pide reparar una restauración.
   *
   * Todo en una transacción: o se encola el conjunto entero o nada, para no
   * dejar una reparación a medias que parezca completa.
   */
  async encolarTodoLoLocal(): Promise<number> {
    // Las tablas van en array y no sueltas: la sobrecarga variádica de Dexie
    // llega hasta cinco, y aquí son seis.
    return this.transaction(
      'rw',
      [this.personas, this.senales, this.predicciones, this.perfiles, this.guias, this.outbox],
      async () => {
        const yaEncolado = new Set(
          (await this.outbox.toArray()).map(op => `${op.entidad}:${op.payload.id}`)
        );
        let encoladas = 0;

        // En este orden para que el FIFO suba cada persona antes que lo que
        // cuelga de ella. Sin claves foráneas no es obligatorio, pero deja el
        // servidor en un estado coherente en todo momento durante la subida.
        for (const p of await this.personas.toArray()) {
          if (yaEncolado.has(`persona:${p.id}`)) continue;
          await this.encolar({ entidad: 'persona', payload: p }, 'update');
          encoladas++;
        }
        for (const s of await this.senales.toArray()) {
          if (yaEncolado.has(`senal:${s.id}`)) continue;
          await this.encolar({ entidad: 'senal', payload: s }, 'insert');
          encoladas++;
        }
        for (const p of await this.predicciones.toArray()) {
          if (yaEncolado.has(`prediccion:${p.id}`)) continue;
          await this.encolar({ entidad: 'prediccion', payload: p }, 'update');
          encoladas++;
        }
        for (const p of await this.perfiles.toArray()) {
          if (yaEncolado.has(`perfil:${p.id}`)) continue;
          await this.encolar({ entidad: 'perfil', payload: p }, 'insert');
          encoladas++;
        }
        for (const g of await this.guias.toArray()) {
          if (yaEncolado.has(`guia:${g.id}`)) continue;
          await this.encolar({ entidad: 'guia', payload: g }, 'insert');
          encoladas++;
        }

        return encoladas;
      }
    );
  }

  // ------------------------------------------------------------
  // bajada (pull) — escribe SIN encolar, para no reenviar lo que ya vino
  // ------------------------------------------------------------

  async aplicarBajada(lote: LoteBajada): Promise<ResultadoBajadaTabla> {
    switch (lote.entidad) {
      // Inmutables: si ya está, no puede haber cambiado.
      case 'senal':
        return this.aplicarInmutables(comoTablaDeIds(this.senales), lote.filas);
      case 'perfil':
        return this.aplicarInmutables(comoTablaDeIds(this.perfiles), lote.filas);
      case 'guia':
        return this.aplicarInmutables(comoTablaDeIds(this.guias), lote.filas);
      // Mutables: gana el servidor salvo que lo local esté sin subir.
      case 'persona':
        return this.aplicarMutables(comoTablaDeIds(this.personas), lote.filas, 'persona');
      case 'prediccion':
        return this.aplicarMutables(comoTablaDeIds(this.predicciones), lote.filas, 'prediccion');
    }
  }

  // `Table<T, string>` y no `EntityTable<T, 'id'>`: con un T todavía sin
  // instanciar, Dexie no puede resolver el tipo de la clave y `anyOf(string[])`
  // deja de compilar. Declarar la clave como string directamente lo evita.
  private async aplicarInmutables<T extends { id: string }>(
    tabla: Table<T, string>,
    filas: T[]
  ): Promise<ResultadoBajadaTabla> {
    if (filas.length === 0) return SIN_CAMBIOS;
    return this.transaction('rw', tabla, async () => {
      const ids = filas.map(f => f.id);
      const ya = new Set(await tabla.where('id').anyOf(ids).primaryKeys());
      const nuevas = filas.filter(f => !ya.has(f.id));
      // bulkAdd y no bulkPut: sobrescribir una señal o un perfil ya existente
      // rompería la inmutabilidad aunque el contenido fuera idéntico.
      if (nuevas.length > 0) await tabla.bulkAdd(nuevas);
      return {
        insertadas: nuevas.length,
        actualizadas: 0,
        omitidas: filas.length - nuevas.length,
      };
    });
  }

  private async aplicarMutables<T extends { id: string }>(
    tabla: Table<T, string>,
    filas: T[],
    entidad: EntidadSync
  ): Promise<ResultadoBajadaTabla> {
    if (filas.length === 0) return SIN_CAMBIOS;
    return this.transaction('rw', tabla, this.outbox, async () => {
      // Los ids protegidos se leen DENTRO de la transacción a propósito: si se
      // leyeran antes, una escritura local entre medias encolaría una operación
      // que este mismo lote pisaría acto seguido, y ese cambio se perdería sin
      // dar error.
      const pendientes = await this.outbox.where('entidad').equals(entidad).toArray();
      const protegidos = new Set(pendientes.map(op => op.payload.id));

      const aplicables = filas.filter(f => !protegidos.has(f.id));
      const existentes = new Set(
        await tabla
          .where('id')
          .anyOf(aplicables.map(f => f.id))
          .primaryKeys()
      );
      if (aplicables.length > 0) await tabla.bulkPut(aplicables);

      const actualizadas = aplicables.filter(f => existentes.has(f.id)).length;
      return {
        insertadas: aplicables.length - actualizadas,
        actualizadas,
        omitidas: filas.length - aplicables.length,
      };
    });
  }

  // ------------------------------------------------------------
  // metadatos de sincronización
  // ------------------------------------------------------------

  async leerMeta(clave: string): Promise<string | null> {
    const fila = await this.syncMeta.get(clave);
    return fila?.valor ?? null;
  }

  async guardarMeta(clave: string, valor: string): Promise<void> {
    await this.syncMeta.put({ clave, valor });
  }

  // ------------------------------------------------------------
  // export / import
  // ------------------------------------------------------------

  async exportar(): Promise<ExportBundle> {
    const [personas, senales, predicciones, perfiles, guias] = await Promise.all([
      this.personas.toArray(),
      this.senales.toArray(),
      this.predicciones.toArray(),
      this.perfiles.toArray(),
      this.guias.toArray(),
    ]);
    return {
      version: 1,
      exportadoEn: new Date().toISOString(),
      personas,
      senales,
      predicciones,
      perfiles,
      guias,
    };
  }

  /**
   * DESTRUCTIVO: reemplaza el contenido de las cinco tablas del bundle. No
   * es un merge — restaurar un backup deja la base exactamente como estaba
   * cuando se exportó. Todo dentro de una transacción: si algo falla a mitad,
   * Dexie revierte y la base queda intacta (nunca vacía a medias).
   *
   * `guias` se vacía y repuebla como las demás, incluso restaurando un backup
   * ANTERIOR a que existieran (donde el campo no viene y se lee como []). Es
   * lo correcto: una guía cita IDs de señal, así que dejarlas vivas mientras
   * las señales se reemplazan produciría guías apuntando a evidencia que ya
   * no existe.
   *
   * `capturasPendientes` NO se toca a propósito: el ExportBundle no la
   * incluye, así que borrarla destruiría notas sin clasificar que ningún
   * backup podría devolver (invariante: la captura nunca se pierde).
   *
   * ⚠️ TAMPOCO encola nada en el outbox, y eso deja el local divergido del
   * servidor a propósito. Un import es un reemplazo total: propagarlo exigiría
   * BORRAR en remoto lo que el backup no trae, y este esquema no tiene DELETE
   * (señales inmutables, perfiles históricos).
   *
   * Los cursores de `syncMeta` se dejan INTACTOS, y eso también es deliberado:
   * reiniciarlos haría que el siguiente pull rebajara del servidor todo lo que
   * el backup justamente no traía (las señales son inmutables: al no existir en
   * local se reinsertarían), deshaciendo la restauración. El precio es que lo
   * que el backup omitió sigue vivo en el servidor y no vuelve — restaurar una
   * copia es una operación local, no una forma de revertir el servidor.
   */
  async importar(b: ExportBundle): Promise<void> {
    await this.transaction(
      'rw',
      this.personas,
      this.senales,
      this.predicciones,
      this.perfiles,
      this.guias,
      async () => {
        await Promise.all([
          this.personas.clear(),
          this.senales.clear(),
          this.predicciones.clear(),
          this.perfiles.clear(),
          this.guias.clear(),
        ]);
        await this.personas.bulkAdd(b.personas);
        await this.senales.bulkAdd(b.senales);
        await this.predicciones.bulkAdd(b.predicciones);
        await this.perfiles.bulkAdd(b.perfiles);
        await this.guias.bulkAdd(b.guias ?? []);
      }
    );
  }
}

/** Instancia única de la base local. El resto de la app la consume vía Repository. */
export const repo: Repository = new DexieRepo();
