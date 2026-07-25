/**
 * Ajustes — copia de seguridad (paso 6 del MVP).
 *
 * Export: descarga todo (personas, señales, predicciones y TODOS los
 * snapshots de perfiles) como `people-backup-AAAA-MM-DD.json`.
 *
 * Import: DESTRUCTIVO. El archivo se lee y valida primero; solo si valida se
 * muestra la comparación "lo que hay ahora" vs. "lo que trae el archivo" y se
 * exige confirmación explícita. Si no valida, se muestra el error y la base
 * no se toca.
 */
import { useRef, useState } from 'react';
import type { ExportBundle } from '../../core/esquema';
import { repo } from '../../data/dexie-repo';
import {
  contar,
  ErrorImport,
  exportarYDescargar,
  leerArchivoBundle,
  resumenActual,
  type ResumenBundle,
} from '../../data/export';

interface Confirmacion {
  bundle: ExportBundle;
  nombreArchivo: string;
  archivo: ResumenBundle;
  actual: ResumenBundle;
}

function mensajeError(e: unknown): string {
  if (e instanceof ErrorImport) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

/** "3 personas · 41 señales · 2 predicciones · 5 perfiles" */
function describir(r: ResumenBundle): string {
  return [
    `${r.personas} ${r.personas === 1 ? 'persona' : 'personas'}`,
    `${r.senales} ${r.senales === 1 ? 'señal' : 'señales'}`,
    `${r.predicciones} ${r.predicciones === 1 ? 'predicción' : 'predicciones'}`,
    `${r.perfiles} ${r.perfiles === 1 ? 'perfil' : 'perfiles'}`,
  ].join(' · ');
}

export function Ajustes() {
  const [exportando, setExportando] = useState(false);
  const [resumenExport, setResumenExport] = useState<string | null>(null);
  const [errorExport, setErrorExport] = useState<string | null>(null);

  const [confirmacion, setConfirmacion] = useState<Confirmacion | null>(null);
  const [importando, setImportando] = useState(false);
  const [resumenImport, setResumenImport] = useState<string | null>(null);
  const [errorImport, setErrorImport] = useState<string | null>(null);
  const inputArchivo = useRef<HTMLInputElement>(null);

  async function exportar() {
    setExportando(true);
    setErrorExport(null);
    setResumenExport(null);
    try {
      const { resumen, nombre } = await exportarYDescargar(repo);
      setResumenExport(`Exportadas ${describir(resumen)} → ${nombre}`);
    } catch (e) {
      setErrorExport(mensajeError(e));
    } finally {
      setExportando(false);
    }
  }

  /** Lee y valida el archivo. No toca la base: solo prepara la confirmación. */
  async function elegirArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    // Se limpia el input para que volver a elegir el MISMO archivo dispare change.
    e.target.value = '';
    if (!archivo) return;

    setErrorImport(null);
    setResumenImport(null);
    setConfirmacion(null);
    try {
      const bundle = await leerArchivoBundle(archivo);
      setConfirmacion({
        bundle,
        nombreArchivo: archivo.name,
        archivo: contar(bundle),
        actual: await resumenActual(repo),
      });
    } catch (err) {
      setErrorImport(mensajeError(err));
    }
  }

  async function confirmarImport() {
    if (!confirmacion) return;
    setImportando(true);
    setErrorImport(null);
    try {
      await repo.importar(confirmacion.bundle);
      setResumenImport(`Importadas ${describir(confirmacion.archivo)}.`);
      setConfirmacion(null);
    } catch (e) {
      setErrorImport(mensajeError(e));
    } finally {
      setImportando(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 p-6">
      <h1 className="text-lg font-medium">Ajustes</h1>

      {/* ---------------- Export ---------------- */}
      <section className="flex flex-col gap-2 rounded-lg border border-[var(--border)] p-4">
        <h2 className="text-base font-medium">Exportar</h2>
        <p className="text-sm opacity-70">
          Descarga un JSON con todo: personas, señales, predicciones y todos los
          snapshots de perfiles.
        </p>
        <button
          type="button"
          className="self-start rounded-md bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
          disabled={exportando}
          onClick={exportar}
        >
          {exportando ? 'Exportando…' : 'Exportar copia'}
        </button>
        {resumenExport && <p className="text-sm opacity-70">{resumenExport}</p>}
        {errorExport && <p className="text-sm text-red-500">{errorExport}</p>}
      </section>

      {/* ---------------- Import ---------------- */}
      <section className="flex flex-col gap-2 rounded-lg border border-[var(--border)] p-4">
        <h2 className="text-base font-medium">Importar</h2>
        <p className="text-sm opacity-70">
          Restaura una copia. <strong className="text-red-500">Reemplaza todos los datos actuales</strong>{' '}
          — no se fusiona con lo que ya hay.
        </p>

        <input
          ref={inputArchivo}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={elegirArchivo}
        />
        <button
          type="button"
          className="self-start rounded-md border border-[var(--border)] px-4 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
          disabled={importando}
          onClick={() => inputArchivo.current?.click()}
        >
          Elegir archivo…
        </button>

        {confirmacion && (
          <div className="flex flex-col gap-3 rounded-lg border border-red-500/40 bg-red-500/5 p-3">
            <p className="text-sm font-medium text-red-500">
              Esto reemplaza todos tus datos. No se puede deshacer.
            </p>
            <dl className="flex flex-col gap-1 text-sm">
              <div className="flex flex-col">
                <dt className="text-xs uppercase tracking-wide opacity-60">Ahora tienes</dt>
                <dd>{describir(confirmacion.actual)}</dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-xs uppercase tracking-wide opacity-60">
                  {confirmacion.nombreArchivo} trae
                </dt>
                <dd>{describir(confirmacion.archivo)}</dd>
              </div>
            </dl>
            <p className="text-xs opacity-70">
              Las notas sin clasificar de la bandeja no se tocan.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-md bg-red-600 px-4 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
                disabled={importando}
                onClick={confirmarImport}
              >
                {importando ? 'Reemplazando…' : 'Sí, reemplazar todo'}
              </button>
              <button
                type="button"
                className="rounded-md border border-[var(--border)] px-4 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                disabled={importando}
                onClick={() => setConfirmacion(null)}
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {resumenImport && <p className="text-sm opacity-70">{resumenImport}</p>}
        {errorImport && (
          <p className="rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-sm text-red-500">
            {errorImport}
          </p>
        )}
      </section>
    </div>
  );
}
