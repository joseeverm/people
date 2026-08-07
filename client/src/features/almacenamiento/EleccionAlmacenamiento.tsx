/**
 * Primer arranque: dónde se guardan tus datos.
 *
 * Sale una sola vez por usuario y dispositivo, entre el login y la app. Se
 * decide ANTES de dejar entrar a propósito: en cuanto la app arranca empieza a
 * escribir (y en modo nube, a subir), y una elección tomada después ya no sería
 * sobre datos que no han salido de aquí.
 *
 * Sin opción preseleccionada y sin "recomendado": las dos son legítimas y la
 * diferencia es de privacidad, no de calidad. Cada tarjeta dice también lo que
 * se pierde, no solo lo que se gana — una advertencia que solo aparece después
 * de elegir no es una advertencia.
 *
 * Todo en lenguaje llano: ni "sincronización", ni "servidor" a secas, ni
 * "cifrado". Quien usa esto no tiene por qué saber qué es un outbox.
 *
 * La elección se guarda en la CUENTA, no en el dispositivo, así que `onElegir`
 * es asíncrono y puede fallar. Si falla no se entra: una elección que no llegó
 * a la cuenta volvería a preguntarse en el siguiente dispositivo, que es el
 * fallo que este flujo existe para cerrar. Llegar hasta aquí ya implica que el
 * servidor respondió hace un momento (así se supo que nadie había elegido),
 * así que un fallo aquí es transitorio y reintentar tiene sentido.
 */
import { useState } from 'react';
import type { ModoAlmacenamiento } from '../../data/modo-almacenamiento';

interface Props {
  onElegir: (modo: ModoAlmacenamiento) => Promise<void>;
}

function IconoDispositivo() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-6 shrink-0"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="5" y="2" width="14" height="20" rx="2" />
      <path d="M12 18h.01" />
    </svg>
  );
}

function IconoNube() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-6 shrink-0"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17.5 19a4.5 4.5 0 0 0 .5-8.97 6 6 0 0 0-11.66-1.5A4 4 0 0 0 6.5 19Z" />
      <path d="M12 12v6M9.5 15.5 12 18l2.5-2.5" />
    </svg>
  );
}

export function EleccionAlmacenamiento({ onElegir }: Props) {
  const [elegido, setElegido] = useState<ModoAlmacenamiento | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmar() {
    if (!elegido) return;
    setGuardando(true);
    setError(null);
    try {
      await onElegir(elegido);
    } catch (e) {
      setError(
        'No se pudo guardar tu elección en tu cuenta: ' +
          (e instanceof Error ? e.message : String(e)) +
          ' Inténtalo otra vez.'
      );
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-medium">¿Dónde quieres guardar tus datos?</h1>
        <p className="text-sm opacity-70">
          Elige una vez. Puedes cambiarlo cuando quieras desde Ajustes.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {/* ---------------- Solo en este dispositivo ---------------- */}
        <button
          type="button"
          aria-pressed={elegido === 'local'}
          onClick={() => setElegido('local')}
          className={`flex flex-col gap-2 rounded-lg border p-4 text-left ${
            elegido === 'local'
              ? 'border-[var(--accent)] bg-[var(--accent-bg)]'
              : 'border-[var(--border)]'
          }`}
        >
          <span className="flex items-center gap-2 font-medium">
            <IconoDispositivo />
            Solo en este dispositivo
          </span>
          <span className="text-sm opacity-80">
            Tus notas se quedan aquí y no se envían a ningún lado. Nadie más puede verlas.
          </span>
          <span className="rounded-md border border-[var(--error-borde)] bg-[var(--error-bg)] p-2 text-sm text-[var(--error)]">
            Ojo: si borras la app o los datos del navegador, se pierden y no hay copia. Tampoco
            los verás en tus otros dispositivos.
          </span>
        </button>

        {/* ---------------- Sincronizar en la nube ---------------- */}
        <button
          type="button"
          aria-pressed={elegido === 'nube'}
          onClick={() => setElegido('nube')}
          className={`flex flex-col gap-2 rounded-lg border p-4 text-left ${
            elegido === 'nube'
              ? 'border-[var(--accent)] bg-[var(--accent-bg)]'
              : 'border-[var(--border)]'
          }`}
        >
          <span className="flex items-center gap-2 font-medium">
            <IconoNube />
            Guardar también en la nube
          </span>
          <span className="text-sm opacity-80">
            Tus notas aparecen en todos tus dispositivos, y si borras la app siguen ahí cuando
            vuelvas a entrar.
          </span>
          <span className="text-sm opacity-70">
            A cambio, quedan guardadas en el servidor de la app.
          </span>
        </button>
      </div>

      {/* Vale para las dos opciones, así que va fuera de las tarjetas. */}
      <p className="rounded-lg border border-[var(--border)] p-3 text-sm opacity-70">
        Elijas lo que elijas, puedes descargar todas tus notas en un archivo y volver a
        cargarlas en otro dispositivo — por ejemplo al cambiar de celular. Está en Ajustes.
      </p>

      <button
        type="button"
        className="toque-12 rounded-md bg-[var(--accent)] px-4 font-medium text-[var(--accent-texto)] disabled:cursor-not-allowed disabled:opacity-40"
        disabled={!elegido || guardando}
        onClick={confirmar}
      >
        {guardando ? 'Guardando…' : elegido ? 'Continuar' : 'Elige una opción'}
      </button>

      {error && (
        <p className="rounded-lg border border-[var(--error-borde)] bg-[var(--error-bg)] p-3 text-sm text-[var(--error)]">
          {error}
        </p>
      )}
    </div>
  );
}
