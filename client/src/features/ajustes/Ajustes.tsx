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
import { useEffect, useRef, useState } from 'react';
import type { ExportBundle } from '../../core/esquema';
import { repo } from '../../data/dexie-repo';
import { supabase } from '../../data/supabase';
import { useSesion } from '../../ui/useSesion';
import { SeccionSync } from './SeccionSync';
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

/**
 * Cuenta y cierre de sesión. Avisa si quedan operaciones sin subir: al salir
 * se quedan en el outbox local, y sincronizarían contra la cuenta que entre
 * después — que en esta app siempre debería ser la misma, pero conviene verlo
 * antes de salir, no después.
 */
function SeccionCuenta() {
  const { sesion } = useSesion();
  const [pendientes, setPendientes] = useState(0);
  const [saliendo, setSaliendo] = useState(false);

  useEffect(() => {
    repo.contarPendientes().then(setPendientes);
  }, []);

  async function salir() {
    setSaliendo(true);
    try {
      // 'local': cierra solo esta sesión y no invalida el refresh token en el
      // resto de dispositivos. Además funciona sin red.
      await supabase.auth.signOut({ scope: 'local' });
    } finally {
      setSaliendo(false);
    }
  }

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-[var(--border)] p-4">
      <h2 className="text-base font-medium">Cuenta</h2>
      <p className="text-sm opacity-70">
        {sesion?.user.email ?? 'Sin sesión'}
      </p>
      {pendientes > 0 && (
        <p className="text-sm text-amber-600">
          Quedan {pendientes} {pendientes === 1 ? 'operación' : 'operaciones'} sin subir. Se
          mantienen en este dispositivo hasta que vuelvas a entrar.
        </p>
      )}
      <button
        type="button"
        className="min-h-12 w-full rounded-md border border-[var(--border)] px-4 text-sm font-medium disabled:opacity-40 sm:w-auto sm:self-start"
        disabled={saliendo}
        onClick={salir}
      >
        {saliendo ? 'Cerrando…' : 'Cerrar sesión'}
      </button>
    </section>
  );
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
      // El import escribe directo en las tablas, sin pasar por el outbox (ver
      // repo.importar): sin este aviso la sincronización diría "0 subidas" y
      // parecería que ya está todo arriba.
      setResumenImport(
        `Importadas ${describir(confirmacion.archivo)}. Están solo en este ` +
          'dispositivo: para llevarlas al servidor usa «Subir todo lo local» en Sincronización.'
      );
      setConfirmacion(null);
    } catch (e) {
      setErrorImport(mensajeError(e));
    } finally {
      setImportando(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 p-4 sm:p-6">
      <h1 className="text-lg font-medium">Ajustes</h1>

      <SeccionCuenta />

      <SeccionSync />

      {/* ---------------- Export ---------------- */}
      <section className="flex flex-col gap-2 rounded-lg border border-[var(--border)] p-4">
        <h2 className="text-base font-medium">Exportar</h2>
        <p className="text-sm opacity-70">
          Descarga un JSON con todo: personas, señales, predicciones y todos los
          snapshots de perfiles.
        </p>
        <button
          type="button"
          className="min-h-12 w-full rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto sm:self-start"
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
          className="min-h-12 w-full rounded-md border border-[var(--border)] px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto sm:self-start"
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
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <button
                type="button"
                className="min-h-12 rounded-md bg-red-600 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
                disabled={importando}
                onClick={confirmarImport}
              >
                {importando ? 'Reemplazando…' : 'Sí, reemplazar todo'}
              </button>
              <button
                type="button"
                className="min-h-12 rounded-md border border-[var(--border)] px-4 text-sm disabled:cursor-not-allowed disabled:opacity-40"
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
