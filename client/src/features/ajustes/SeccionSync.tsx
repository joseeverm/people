/**
 * Ajustes → Sincronización. Es donde vive la información que NO cabe en la
 * franja del indicador: cuándo fue la última sincronización correcta, cuánto
 * queda por subir y el botón para forzar el ciclo.
 *
 * No usa `useSync`: ese hook lo instancia App y montar un segundo duplicaría
 * sus temporizadores. Aquí se lee el estado al montar y se llama directo a
 * `sincronizar()`, que ya está protegida contra pasadas simultáneas — pulsar
 * el botón mientras corre el tic de fondo se engancha a la misma pasada en vez
 * de lanzar otra.
 */
import { useCallback, useEffect, useState } from 'react';
import { repo } from '../../data/dexie-repo';
import { leerUltimaSincronizacion, sincronizar } from '../../data/sync';

/** "hace 5 min", "hace 2 h", "el 14/07/2026". Relativo mientras es útil. */
function describirCuando(iso: string): string {
  const minutos = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutos < 1) return 'hace un momento';
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  return `el ${new Date(iso).toLocaleDateString()}`;
}

export function SeccionSync() {
  const [pendientes, setPendientes] = useState(0);
  const [ultima, setUltima] = useState<string | null>(null);
  const [corriendo, setCorriendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumen, setResumen] = useState<string | null>(null);

  const refrescar = useCallback(async () => {
    const [n, u] = await Promise.all([repo.contarPendientes(), leerUltimaSincronizacion()]);
    setPendientes(n);
    setUltima(u);
  }, []);

  useEffect(() => {
    refrescar();
  }, [refrescar]);

  /** Corre el ciclo y deja escrito el resultado. No gestiona `corriendo`: de
   *  eso se encarga quien la llama, que puede tener trabajo antes. */
  async function cicloYResumen(prefijo = '') {
    const r = await sincronizar();
    const falloSubida = r.subida.sinConexion ? null : r.subida.error;
    const falloBajada = r.bajada && !r.bajada.sinConexion ? r.bajada.error : null;
    const fallo = falloSubida ?? falloBajada;

    if (fallo) {
      setError(fallo);
    } else if (r.subida.sinConexion || r.bajada?.sinConexion || !r.bajada) {
      setError('Sin conexión: se reintentará solo cuando vuelva la red.');
    } else {
      const bajadas = r.bajada.insertadas + r.bajada.actualizadas;
      setResumen(
        `${prefijo}Subidas ${r.subida.subidas} · bajadas ${bajadas}` +
          (r.bajada.omitidas > 0 ? ` (${r.bajada.omitidas} ya estaban)` : '')
      );
    }
  }

  /** Envuelve una acción con el estado compartido de la sección. */
  async function ejecutar(accion: () => Promise<void>) {
    setCorriendo(true);
    setError(null);
    setResumen(null);
    try {
      await accion();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCorriendo(false);
      await refrescar();
    }
  }

  const ahora = () => ejecutar(() => cicloYResumen());

  /**
   * Encola todo lo local y sincroniza. Es la salida para los datos que nunca
   * pasaron por el outbox: una copia restaurada (`importar()` no encola a
   * propósito, ver su comentario) o registros anteriores a que el outbox
   * existiera. Sin esto se quedan en este dispositivo para siempre, y lo hacen
   * en silencio: la sincronización dice "0 subidas" y parece que todo está al
   * día.
   */
  const subirTodo = () =>
    ejecutar(async () => {
      const encoladas = await repo.encolarTodoLoLocal();
      if (encoladas === 0) {
        setResumen('No había nada local fuera de la cola: ya estaba todo encolado.');
        return;
      }
      await cicloYResumen(`Encoladas ${encoladas} · `);
    });

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-[var(--border)] p-4">
      <h2 className="text-base font-medium">Sincronización</h2>

      <dl className="flex flex-col gap-1 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="opacity-60">Última sincronización</dt>
          <dd className="text-right">{ultima ? describirCuando(ultima) : 'nunca'}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="opacity-60">Sin subir</dt>
          <dd className="text-right">
            {pendientes === 0
              ? 'nada'
              : `${pendientes} ${pendientes === 1 ? 'operación' : 'operaciones'}`}
          </dd>
        </div>
      </dl>

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          className="toque-12 rounded-md border border-[var(--border)] px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
          disabled={corriendo}
          onClick={ahora}
        >
          {corriendo ? 'Sincronizando…' : 'Sincronizar ahora'}
        </button>
        <button
          type="button"
          className="toque-12 rounded-md border border-[var(--border)] px-4 text-sm disabled:cursor-not-allowed disabled:opacity-40"
          disabled={corriendo}
          onClick={subirTodo}
        >
          Subir todo lo local
        </button>
      </div>

      <p className="text-xs opacity-60">
        <strong>Subir todo lo local</strong> encola de nuevo cuanto haya en este
        dispositivo. Hace falta después de restaurar una copia: al importar, los
        datos entran directos a la base local y no pasan por la cola de subida.
        Repetirlo no duplica nada.
      </p>

      {resumen && <p className="text-sm opacity-70">{resumen}</p>}
      {error && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-sm text-red-500">
          {error}
        </p>
      )}
      <p className="text-xs opacity-60">
        Los datos se guardan siempre en este dispositivo primero. Si la
        sincronización falla, se sigue trabajando igual y se reintenta sola.
      </p>
    </section>
  );
}
