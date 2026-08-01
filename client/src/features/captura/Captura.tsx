/**
 * Vista principal: caja de texto → cola local. Nunca llama al LLM aquí
 * (eso es trabajo de la Bandeja): abrir la app y anotar debe funcionar
 * sin conexión y en <15 segundos (ver CLAUDE.md § MVP).
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { EVENTO_BASE_BLOQUEADA, repo } from '../../data/dexie-repo';

/** Si a los 6 s la escritura no ha vuelto, algo va mal de verdad: IndexedDB
 *  local tarda milisegundos. El caso típico es una subida de versión bloqueada
 *  por otra pestaña, donde la promesa NO se resuelve nunca y sin este aviso la
 *  pantalla se queda muda para siempre. */
const AVISO_TARDANZA_MS = 6000;

export function Captura() {
  const [texto, setTexto] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [sinClasificar, setSinClasificar] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [tarda, setTarda] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  async function refrescarContador() {
    const pendientes = await repo.pendientes();
    setSinClasificar(pendientes.filter(p => p.estado === 'sin_clasificar').length);
  }

  useEffect(() => {
    refrescarContador().catch(() => {
      // El contador es informativo: si falla no se rompe la captura, pero
      // tampoco se traga el fallo en silencio.
      setError('No se pudo leer la cola local. Puede que la base esté bloqueada por otra pestaña.');
    });
  }, []);

  // Lo emite dexie-repo cuando otra pestaña con el esquema viejo impide subir
  // de versión. Es exactamente el estado en que "Guardar" no hace nada.
  useEffect(() => {
    function alBloquearse() {
      setError(
        'Otra pestaña (o la app instalada) tiene abierta una versión anterior y bloquea la base. ' +
          'Ciérralas y recarga: hasta entonces no se puede guardar.'
      );
    }
    window.addEventListener(EVENTO_BASE_BLOQUEADA, alBloquearse);
    return () => window.removeEventListener(EVENTO_BASE_BLOQUEADA, alBloquearse);
  }, []);

  async function guardar() {
    const contenido = texto.trim();
    if (!contenido) return;
    setError(null);
    // Limpiar al instante: la captura no debe esperar a IndexedDB para sentirse
    // guardada. Si la escritura falla, el texto VUELVE (abajo) — la nota no se
    // pierde nunca (invariante #5).
    setTexto('');
    setGuardando(true);
    const reloj = setTimeout(() => setTarda(true), AVISO_TARDANZA_MS);
    try {
      await repo.encolarCaptura(contenido);
      await refrescarContador();
    } catch (e) {
      // Antes no había catch: la promesa se rompía, el texto ya se había
      // borrado y la pantalla no decía nada. La nota se perdía en silencio.
      setTexto(t => (t ? t : contenido));
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      clearTimeout(reloj);
      setTarda(false);
      setGuardando(false);
    }
  }

  /** El botón NO debe robar el foco al textarea.
   *
   *  Este era el fallo en móvil: al tocar "Guardar" con el teclado abierto, el
   *  textarea se desenfocaba, el teclado empezaba a cerrarse y la altura del
   *  viewport crecía de golpe. Con `min-h-[38dvh]` en la caja y un espaciador
   *  `flex-1` encima, el botón se iba varios centímetros hacia abajo ENTRE el
   *  pointerdown y el pointerup — así que el navegador no llegaba a emitir el
   *  `click` y no pasaba nada: ni error, ni guardado.
   *
   *  Con preventDefault el foco no se mueve, el teclado no se cierra, nada se
   *  recoloca y el click llega. De regalo, el teclado sigue abierto para la
   *  nota siguiente, que es justo lo que quiere una vista de captura rápida. */
  function mantenerFoco(e: React.PointerEvent) {
    e.preventDefault();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      guardar();
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 p-4 sm:p-6 md:max-w-3xl">
      {/* Solo en móvil: empuja la caja y el botón a la mitad inferior de la
          pantalla, donde llega el pulgar sin recolocar la mano. */}
      <div className="flex-1 md:hidden" />

      <textarea
        ref={areaRef}
        className="min-h-[38dvh] w-full resize-none rounded-lg border border-[var(--border)] bg-transparent p-4 text-base leading-relaxed outline-none focus:border-[var(--accent)] md:min-h-48"
        placeholder="¿Qué notaste?"
        value={texto}
        onChange={e => setTexto(e.target.value)}
        onKeyDown={onKeyDown}
        autoFocus
      />

      {error && (
        <p className="rounded-lg border border-[var(--error-borde)] bg-[var(--error-bg)] p-3 text-sm text-[var(--error)]">
          {error}
        </p>
      )}
      {tarda && !error && (
        <p className="rounded-lg border border-[var(--aviso-borde)] bg-[var(--aviso-bg)] p-3 text-sm text-[var(--aviso)]">
          Está tardando más de lo normal. Si tienes la app abierta en otra pestaña, ciérrala y
          recarga: puede estar bloqueando la base local.
        </p>
      )}
      {/* col-reverse en móvil: el botón queda pegado a la caja (zona del
          pulgar) y el enlace a la bandeja encima. En escritorio, fila. */}
      <div className="flex flex-col-reverse gap-3 md:flex-row md:items-center md:justify-between">
        <button
          type="button"
          className="toque-12 w-full rounded-md bg-[var(--accent)] px-5 text-sm font-medium text-[var(--accent-texto)] disabled:cursor-not-allowed disabled:opacity-40 md:w-auto"
          onPointerDown={mantenerFoco}
          onClick={() => {
            // El foco se quedó en el textarea a propósito (ver mantenerFoco):
            // se le devuelve explícitamente para que la nota siguiente se
            // pueda escribir sin volver a tocar la caja.
            areaRef.current?.focus();
            guardar();
          }}
          disabled={!texto.trim() || guardando}
        >
          Guardar
        </button>
        <Link
          to="/bandeja"
          className="flex toque-11 items-center justify-center text-sm text-[var(--text)] opacity-70 transition hover:opacity-100 md:justify-start"
        >
          {sinClasificar > 0
            ? `${sinClasificar} pendiente${sinClasificar === 1 ? '' : 's'} sin clasificar →`
            : 'bandeja de confirmación →'}
        </Link>
      </div>
    </div>
  );
}
