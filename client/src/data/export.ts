/**
 * PERFILADOR — Export / Import JSON (paso 6 del MVP)
 * ====================================================
 * Copia de seguridad completa y portable: `ExportBundle` tal cual está
 * definido en `core/esquema.ts` (version 1 + los cuatro arrays), sin lock-in.
 *
 * Qué vive aquí:
 *  - construir el nombre de archivo y disparar la descarga en el navegador;
 *  - leer y VALIDAR un archivo antes de tocar la base;
 *  - contar lo que hay ahora vs. lo que trae el archivo, para que la
 *    confirmación del import sea informada.
 *
 * Lo que NO vive aquí: el reemplazo en sí. Eso lo hace `repo.importar()`
 * (una transacción, ver dexie-repo.ts) porque es persistencia.
 *
 * ⚠️ El import es DESTRUCTIVO: reemplaza personas, señales, predicciones y
 * perfiles. La UI debe confirmarlo explícitamente antes de llamar.
 */

import type { ExportBundle } from '../core/esquema';
import type { Repository } from './repository';

/** Conteo por tabla — para el resumen de export y para la confirmación de import. */
export interface ResumenBundle {
  personas: number;
  senales: number;
  predicciones: number;
  perfiles: number;
}

/** Error de validación de un archivo de import, con mensaje legible para la UI. */
export class ErrorImport extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorImport';
  }
}

// ------------------------------------------------------------
// Export
// ------------------------------------------------------------

/** `people-backup-2026-07-25.json` — fecha LOCAL (no UTC: cambiaría el día de noche). */
export function nombreArchivoExport(fecha: Date = new Date()): string {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const d = String(fecha.getDate()).padStart(2, '0');
  return `people-backup-${y}-${m}-${d}.json`;
}

export function contar(b: ExportBundle): ResumenBundle {
  return {
    personas: b.personas.length,
    senales: b.senales.length,
    predicciones: b.predicciones.length,
    perfiles: b.perfiles.length,
  };
}

/** Dispara la descarga del bundle como archivo JSON. */
export function descargarBundle(b: ExportBundle, nombre = nombreArchivoExport()): void {
  const blob = new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Export completo: pide el bundle al repositorio, lo descarga y devuelve el
 * resumen. Base vacía es un caso válido: produce un bundle con los cuatro
 * arrays vacíos (que además reimporta sin problema).
 */
export async function exportarYDescargar(
  repo: Repository
): Promise<{ resumen: ResumenBundle; nombre: string }> {
  const bundle = await repo.exportar();
  const nombre = nombreArchivoExport();
  descargarBundle(bundle, nombre);
  return { resumen: contar(bundle), nombre };
}

// ------------------------------------------------------------
// Import — validación
// ------------------------------------------------------------

const CAMPOS_ARRAY = ['personas', 'senales', 'predicciones', 'perfiles'] as const;

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Comprueba que cada elemento sea un objeto con `id` string. Barato pero
 * necesario: sin `id` Dexie revienta a mitad de la transacción, y para
 * entonces la base ya está vacía.
 */
function validarRegistros(nombre: string, items: unknown[]): void {
  items.forEach((item, i) => {
    if (!esObjeto(item))
      throw new ErrorImport(`El elemento ${i} de "${nombre}" no es un objeto.`);
    if (typeof item.id !== 'string' || !item.id)
      throw new ErrorImport(`El elemento ${i} de "${nombre}" no tiene un "id" válido.`);
  });
}

/**
 * Valida la forma de un ExportBundle. Lanza `ErrorImport` con un mensaje
 * legible ante cualquier problema — si lanza, NO se debe tocar la base.
 */
export function validarExportBundle(dato: unknown): ExportBundle {
  if (!esObjeto(dato))
    throw new ErrorImport('El archivo no contiene un objeto JSON.');

  if (dato.version !== 1)
    throw new ErrorImport(
      `Versión de backup no soportada: ${JSON.stringify(dato.version)} (se esperaba 1).`
    );

  for (const campo of CAMPOS_ARRAY) {
    if (!Array.isArray(dato[campo]))
      throw new ErrorImport(`Falta el array "${campo}" o no es una lista.`);
  }

  for (const campo of CAMPOS_ARRAY) {
    validarRegistros(campo, dato[campo] as unknown[]);
  }

  // `senales` es el núcleo del sistema: exige además la persona protagonista.
  (dato.senales as Record<string, unknown>[]).forEach((s, i) => {
    if (!Array.isArray(s.personaIds) || s.personaIds.length === 0)
      throw new ErrorImport(`La señal ${i} no tiene "personaIds".`);
  });

  return {
    version: 1,
    exportadoEn: typeof dato.exportadoEn === 'string' ? dato.exportadoEn : '',
    personas: dato.personas as ExportBundle['personas'],
    senales: dato.senales as ExportBundle['senales'],
    predicciones: dato.predicciones as ExportBundle['predicciones'],
    perfiles: dato.perfiles as ExportBundle['perfiles'],
  };
}

/** Lee y valida un archivo elegido por el usuario. Lanza `ErrorImport` si no vale. */
export async function leerArchivoBundle(archivo: File): Promise<ExportBundle> {
  const texto = await archivo.text();
  let dato: unknown;
  try {
    dato = JSON.parse(texto);
  } catch {
    throw new ErrorImport('El archivo no es JSON válido.');
  }
  return validarExportBundle(dato);
}

/** Lo que hay AHORA en la base, para comparar contra el archivo antes de reemplazar. */
export async function resumenActual(repo: Repository): Promise<ResumenBundle> {
  return contar(await repo.exportar());
}
