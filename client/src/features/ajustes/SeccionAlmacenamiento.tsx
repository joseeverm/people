/**
 * Ajustes → Dónde se guardan tus datos. Muestra el modo actual y permite
 * cambiarlo.
 *
 * Los dos cambios son asimétricos y por eso no comparten flujo:
 *
 *  - **local → nube**: hay datos en el dispositivo que el servidor no tiene
 *    NUNCA ha tenido, así que hay que encolarlos explícitamente
 *    (`encolarTodoLoLocal`). Sin eso, activar el sync solo subiría lo que se
 *    escriba a partir de ahora y todo lo anterior se quedaría atrás en
 *    silencio — el mismo agujero que tiene restaurar un backup.
 *  - **nube → local**: no hay nada que mover (lo local ya está completo), pero
 *    queda una copia en el servidor y hay que PREGUNTAR qué hacer con ella.
 *    Las dos respuestas son válidas: hay quien quiere dejar de sincronizar
 *    conservando el respaldo remoto, y quien quiere que no quede rastro. No se
 *    asume ninguna, y por eso no hay botón por omisión.
 *
 * Antes de cualquiera de los dos se ofrece exportar: es un cambio en dónde
 * viven los datos, y el momento de tener una copia es antes, no después.
 *
 * ---------------------------------------------------------------------------
 * El modo es de la CUENTA, así que cambiarlo es escribir en el servidor
 * ---------------------------------------------------------------------------
 * Y el ORDEN de esas dos escrituras (servidor y caché local) es distinto en
 * cada dirección, por lo que significa fallar en cada una:
 *
 *  - **local → nube**: primero el servidor. Si no se puede avisar a la cuenta,
 *    el cambio no ha ocurrido y no se toca nada — para subir hace falta red de
 *    todos modos, así que no se pierde nada esperando.
 *  - **nube → local**: primero lo local. Lo que el usuario acaba de pedir es
 *    que sus datos DEJEN de salir de aquí, y eso tiene efecto inmediato aunque
 *    el servidor no conteste. Si el aviso a la cuenta falla, se dice claramente
 *    que los otros dispositivos seguirán sincronizando hasta que se reintente.
 */
import { useState } from 'react';
import { guardarModoRemoto } from '../../data/ajustes-usuario';
import { repo } from '../../data/dexie-repo';
import { guardarModo, type ModoAlmacenamiento } from '../../data/modo-almacenamiento';
import { exportarYDescargar } from '../../data/export';
import {
  borrarDatosDelServidor,
  ErrorFaltaMigracion,
  sincronizar,
  type ResultadoBorradoRemoto,
} from '../../data/sync';

interface Props {
  userId: string;
  modo: ModoAlmacenamiento;
}

/** En qué punto del cambio estamos. `null` = no se está cambiando nada. */
type Paso =
  | null
  | { tipo: 'confirmar-nube' }
  | { tipo: 'confirmar-local' }
  /** Ya está en local; falta decidir qué hacer con la copia del servidor. */
  | { tipo: 'preguntar-borrado' };

/** "1 persona", "3 señales" — el singular importa: este mensaje es el acuse de
 *  un borrado, y ahí una concordancia rota hace dudar de si contó bien. */
function plural(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

function describirBorrado(r: ResultadoBorradoRemoto): string {
  const total = r.personas + r.senales + r.predicciones + r.perfiles + r.guias;
  if (total === 0) return 'No había nada que borrar en el servidor.';
  return (
    'Borrado del servidor: ' +
    [
      plural(r.personas, 'persona', 'personas'),
      plural(r.senales, 'señal', 'señales'),
      plural(r.predicciones, 'predicción', 'predicciones'),
      plural(r.perfiles, 'perfil', 'perfiles'),
      plural(r.guias, 'guía', 'guías'),
    ].join(', ') +
    '.'
  );
}

export function SeccionAlmacenamiento({ userId, modo }: Props) {
  const [paso, setPaso] = useState<Paso>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** El cambio a local ya tuvo efecto aquí, pero la cuenta no se enteró. Se
   *  guarda aparte del `error` general porque tiene su propio reintento. */
  const [cuentaSinAvisar, setCuentaSinAvisar] = useState<string | null>(null);

  async function exportarAntes() {
    setError(null);
    try {
      await exportarYDescargar(repo);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /** local → nube: avisar a la cuenta, encolar todo lo de aquí y subir. */
  async function pasarANube() {
    setTrabajando(true);
    setError(null);
    setAviso(null);
    setCuentaSinAvisar(null);
    try {
      // 1. La cuenta primero: si esto falla, no se ha cambiado nada.
      await guardarModoRemoto(userId, 'nube');
      // 2. La caché local, que es lo que consulta `sincronizar()` en cada
      //    pasada. Sin esto se negaría a correr por seguir leyendo 'local'.
      guardarModo(userId, 'nube');
      // 3. Encolar lo que el servidor NUNCA ha tenido. Sin este paso solo
      //    subiría lo que se escriba de ahora en adelante.
      const encoladas = await repo.encolarTodoLoLocal();
      const r = await sincronizar();

      const falloSubida = r.subida.sinConexion
        ? ' No hay conexión ahora mismo: se subirá solo cuando vuelva.'
        : r.subida.error
          ? ` Hubo un problema al subir: ${r.subida.error}`
          : '';

      setAviso(
        `Ahora se guarda también en la nube, en esta y en tus demás sesiones. Se prepararon ` +
          `${plural(encoladas, 'elemento', 'elementos')} y se subieron ${r.subida.subidas}` +
          (r.subida.pendientes > 0
            ? `; quedan ${plural(r.subida.pendientes, 'elemento', 'elementos')} en cola ` +
              '(se suben solos, o con «Sincronizar ahora»).'
            : '.') +
          falloSubida
      );
      setPaso(null);
    } catch (e) {
      setError(
        'No se pudo cambiar el modo: ' +
          (e instanceof Error ? e.message : String(e)) +
          ' Todo sigue como estaba.'
      );
    } finally {
      setTrabajando(false);
    }
  }

  /** Avisa a la cuenta de que ya está en local. Separado porque el cambio local
   *  ya tuvo efecto y esto se puede reintentar sin repetir nada más. */
  async function avisarCuentaLocal() {
    try {
      await guardarModoRemoto(userId, 'local');
      setCuentaSinAvisar(null);
      return true;
    } catch (e) {
      setCuentaSinAvisar(
        'Este dispositivo ya no sincroniza, pero no se pudo avisar a tu cuenta (' +
          (e instanceof Error ? e.message : String(e)) +
          '). Tus otros dispositivos seguirán guardando en la nube hasta que se avise.'
      );
      return false;
    }
  }

  /** nube → local: se corta el sync AQUÍ y ya, y después se avisa a la cuenta.
   *  El corte local no espera al servidor: es lo que el usuario acaba de pedir. */
  async function pasarALocal() {
    setError(null);
    setAviso(null);
    setTrabajando(true);
    try {
      guardarModo(userId, 'local');
      await avisarCuentaLocal();
      setPaso({ tipo: 'preguntar-borrado' });
    } finally {
      setTrabajando(false);
    }
  }

  async function borrarRemoto() {
    setTrabajando(true);
    setError(null);
    try {
      const r = await borrarDatosDelServidor();
      setAviso(`Tus datos siguen en este dispositivo. ${describirBorrado(r)}`);
      setPaso(null);
    } catch (e) {
      setError(
        e instanceof ErrorFaltaMigracion
          ? e.message
          : 'No se pudieron borrar del servidor: ' +
              (e instanceof Error ? e.message : String(e)) +
              ' Ya no se sincroniza, pero la copia del servidor sigue ahí.'
      );
    } finally {
      setTrabajando(false);
    }
  }

  function conservarRemoto() {
    setAviso(
      'Listo: ya no se sincroniza. Lo que había en el servidor se queda ahí, sin ' +
        'actualizarse. Puedes borrarlo más adelante volviendo a este ajuste.'
    );
    setPaso(null);
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-[var(--border)] p-4">
      <h2 className="text-base font-medium">Dónde se guardan tus datos</h2>

      <p className="text-sm opacity-80">
        {modo === 'local'
          ? 'Solo en este dispositivo. No se envían a ningún lado.'
          : 'En este dispositivo y en la nube, para verlos desde cualquier dispositivo.'}
      </p>

      {/* --------- Estado inicial: ofrecer el cambio contrario --------- */}
      {paso === null && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            className="toque-12 rounded-md border border-[var(--border)] px-4 text-sm font-medium disabled:opacity-40"
            disabled={trabajando}
            onClick={() =>
              setPaso({ tipo: modo === 'local' ? 'confirmar-nube' : 'confirmar-local' })
            }
          >
            {modo === 'local' ? 'Guardar también en la nube' : 'Dejar solo en este dispositivo'}
          </button>
        </div>
      )}

      {/* --------- Confirmación local → nube --------- */}
      {paso?.tipo === 'confirmar-nube' && (
        <div className="flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--social-bg)] p-3">
          <p className="text-sm">
            Se subirá al servidor todo lo que tienes en este dispositivo, y a partir de ahí
            aparecerá en tus otros dispositivos.
          </p>
          <p className="text-sm opacity-70">
            Antes de cambiar, conviene descargar una copia por si acaso.
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <button
              type="button"
              className="toque-12 rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-[var(--accent-texto)] disabled:opacity-40"
              disabled={trabajando}
              onClick={() => void pasarANube()}
            >
              {trabajando ? 'Subiendo…' : 'Sí, subir a la nube'}
            </button>
            <button
              type="button"
              className="toque-12 rounded-md border border-[var(--border)] px-4 text-sm disabled:opacity-40"
              disabled={trabajando}
              onClick={exportarAntes}
            >
              Descargar copia antes
            </button>
            <button
              type="button"
              className="toque-12 rounded-md border border-[var(--border)] px-4 text-sm disabled:opacity-40"
              disabled={trabajando}
              onClick={() => setPaso(null)}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* --------- Confirmación nube → local --------- */}
      {paso?.tipo === 'confirmar-local' && (
        <div className="flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--social-bg)] p-3">
          <p className="text-sm">
            Dejarás de sincronizar. Tus datos se quedan en este dispositivo y no volverán a
            enviarse.
          </p>
          <p className="rounded-md border border-[var(--error-borde)] bg-[var(--error-bg)] p-2 text-sm text-[var(--error)]">
            Desde ese momento, si borras la app o los datos del navegador se pierden y no hay
            copia. Descarga una antes.
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <button
              type="button"
              className="toque-12 rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-[var(--accent-texto)] disabled:opacity-40"
              disabled={trabajando}
              onClick={() => void pasarALocal()}
            >
              {trabajando ? 'Cambiando…' : 'Sí, dejar solo aquí'}
            </button>
            <button
              type="button"
              className="toque-12 rounded-md border border-[var(--border)] px-4 text-sm disabled:opacity-40"
              disabled={trabajando}
              onClick={exportarAntes}
            >
              Descargar copia antes
            </button>
            <button
              type="button"
              className="toque-12 rounded-md border border-[var(--border)] px-4 text-sm disabled:opacity-40"
              disabled={trabajando}
              onClick={() => setPaso(null)}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* --------- Qué hacer con la copia del servidor --------- */}
      {paso?.tipo === 'preguntar-borrado' && (
        <div className="flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--social-bg)] p-3">
          <p className="text-sm font-medium">
            Ya no se sincroniza. ¿Qué hacemos con la copia que quedó en el servidor?
          </p>
          <p className="text-sm opacity-70">
            Tus datos de este dispositivo no se tocan en ninguno de los dos casos.
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <button
              type="button"
              className="toque-12 rounded-md bg-[var(--error)] px-4 text-sm font-medium text-white disabled:opacity-40"
              disabled={trabajando}
              onClick={borrarRemoto}
            >
              {trabajando ? 'Borrando…' : 'Borrarla del servidor'}
            </button>
            <button
              type="button"
              className="toque-12 rounded-md border border-[var(--border)] px-4 text-sm disabled:opacity-40"
              disabled={trabajando}
              onClick={conservarRemoto}
            >
              Dejarla ahí
            </button>
          </div>
        </div>
      )}

      {/* El cambio a local ya tuvo efecto aquí; lo que falta es que se entere la
          cuenta. Tiene su propio reintento porque no hay que repetir nada más. */}
      {cuentaSinAvisar && (
        <div className="flex flex-col gap-2 rounded-lg border border-[var(--aviso-borde)] bg-[var(--aviso-bg)] p-3">
          <p className="text-sm text-[var(--aviso)]">{cuentaSinAvisar}</p>
          <button
            type="button"
            className="toque-12 rounded-md border border-[var(--border)] px-4 text-sm disabled:opacity-40 sm:self-start"
            disabled={trabajando}
            onClick={() => void avisarCuentaLocal()}
          >
            Reintentar avisar a mi cuenta
          </button>
        </div>
      )}

      {aviso && <p className="text-sm opacity-70">{aviso}</p>}
      {error && (
        <p className="rounded-lg border border-[var(--error-borde)] bg-[var(--error-bg)] p-3 text-sm text-[var(--error)]">
          {error}
        </p>
      )}
    </section>
  );
}
