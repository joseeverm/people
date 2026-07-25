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

import Dexie, { type EntityTable } from 'dexie';
import type {
  Persona,
  Senal,
  CapturaPendiente,
  Prediccion,
  PerfilGenerado,
  ExportBundle,
} from '../core/esquema';
import type { Repository } from './repository';

/** Estados de CapturaPendiente que ya no cuentan como "pendientes" para la UI. */
const ESTADOS_RESUELTOS: CapturaPendiente['estado'][] = ['confirmada', 'sincronizada'];

export class DexieRepo extends Dexie implements Repository {
  personas!: EntityTable<Persona, 'id'>;
  senales!: EntityTable<Senal, 'id'>;
  capturasPendientes!: EntityTable<CapturaPendiente, 'idLocal'>;
  predicciones!: EntityTable<Prediccion, 'id'>;
  perfiles!: EntityTable<PerfilGenerado, 'id'>;

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
    await this.personas.add(persona);
    return persona;
  }

  async actualizarPersona(p: Persona): Promise<void> {
    await this.personas.put(p);
  }

  // ------------------------------------------------------------
  // señales (append-only — sin update ni delete)
  // ------------------------------------------------------------

  async agregarSenal(s: Omit<Senal, 'id'>): Promise<Senal> {
    const senal: Senal = { ...s, id: crypto.randomUUID() };
    await this.senales.add(senal);
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
    await this.transaction('rw', this.capturasPendientes, this.senales, async () => {
      await this.agregarSenal(senal);
      await this.capturasPendientes.update(idLocal, { estado: 'confirmada' });
    });
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
    await this.predicciones.add(prediccion);
    return prediccion;
  }

  async resolverPrediccion(
    id: string,
    estado: Prediccion['estado'],
    senalVerificacion: string
  ): Promise<void> {
    await this.transaction('rw', this.predicciones, async () => {
      const actual = await this.predicciones.get(id);
      if (!actual) throw new Error(`Predicción ${id} no existe.`);
      if (actual.estado !== 'pendiente')
        throw new Error(`La predicción ya fue resuelta (${actual.estado}); no se puede volver a resolver.`);
      await this.predicciones.update(id, { estado, resueltaPor: senalVerificacion });
    });
  }

  async resolverPrediccionConVerificacion(
    prediccionId: string,
    estado: Extract<Prediccion['estado'], 'acertada' | 'parcial' | 'fallida'>,
    senal: Omit<Senal, 'id'>
  ): Promise<Senal> {
    return this.transaction('rw', this.predicciones, this.senales, async () => {
      const actual = await this.predicciones.get(prediccionId);
      if (!actual) throw new Error(`Predicción ${prediccionId} no existe.`);
      if (actual.estado !== 'pendiente')
        throw new Error(`La predicción ya fue resuelta (${actual.estado}); no se puede volver a resolver.`);
      const creada = await this.agregarSenal(senal);
      await this.predicciones.update(prediccionId, { estado, resueltaPor: creada.id });
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
    await this.perfiles.add(perfil);
    return perfil;
  }

  async ultimoPerfil(personaId: string): Promise<PerfilGenerado | null> {
    const perfiles = await this.perfiles.where('personaId').equals(personaId).toArray();
    if (perfiles.length === 0) return null;
    return perfiles.reduce((mas, p) => (p.generadoEn > mas.generadoEn ? p : mas));
  }

  // ------------------------------------------------------------
  // export / import
  // ------------------------------------------------------------

  async exportar(): Promise<ExportBundle> {
    const [personas, senales, predicciones, perfiles] = await Promise.all([
      this.personas.toArray(),
      this.senales.toArray(),
      this.predicciones.toArray(),
      this.perfiles.toArray(),
    ]);
    return {
      version: 1,
      exportadoEn: new Date().toISOString(),
      personas,
      senales,
      predicciones,
      perfiles,
    };
  }

  /**
   * DESTRUCTIVO: reemplaza el contenido de las cuatro tablas del bundle. No
   * es un merge — restaurar un backup deja la base exactamente como estaba
   * cuando se exportó. Todo dentro de una transacción: si algo falla a mitad,
   * Dexie revierte y la base queda intacta (nunca vacía a medias).
   *
   * `capturasPendientes` NO se toca a propósito: el ExportBundle no la
   * incluye, así que borrarla destruiría notas sin clasificar que ningún
   * backup podría devolver (invariante: la captura nunca se pierde).
   */
  async importar(b: ExportBundle): Promise<void> {
    await this.transaction(
      'rw',
      this.personas,
      this.senales,
      this.predicciones,
      this.perfiles,
      async () => {
        await Promise.all([
          this.personas.clear(),
          this.senales.clear(),
          this.predicciones.clear(),
          this.perfiles.clear(),
        ]);
        await this.personas.bulkAdd(b.personas);
        await this.senales.bulkAdd(b.senales);
        await this.predicciones.bulkAdd(b.predicciones);
        await this.perfiles.bulkAdd(b.perfiles);
      }
    );
  }
}

/** Instancia única de la base local. El resto de la app la consume vía Repository. */
export const repo: Repository = new DexieRepo();
