/**
 * Vista principal: caja de texto → cola local. Nunca llama al LLM aquí
 * (eso es trabajo de la Bandeja): abrir la app y anotar debe funcionar
 * sin conexión y en <15 segundos (ver CLAUDE.md § MVP).
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { repo } from '../../data/dexie-repo';

export function Captura() {
  const [texto, setTexto] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [sinClasificar, setSinClasificar] = useState(0);

  async function refrescarContador() {
    const pendientes = await repo.pendientes();
    setSinClasificar(pendientes.filter(p => p.estado === 'sin_clasificar').length);
  }

  useEffect(() => {
    refrescarContador();
  }, []);

  async function guardar() {
    const contenido = texto.trim();
    if (!contenido) return;
    // Limpiar al instante: la captura no debe esperar a IndexedDB para sentirse guardada.
    setTexto('');
    setGuardando(true);
    try {
      await repo.encolarCaptura(contenido);
      await refrescarContador();
    } finally {
      setGuardando(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      guardar();
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 p-4 sm:p-6">
      {/* Solo en móvil: empuja la caja y el botón a la mitad inferior de la
          pantalla, donde llega el pulgar sin recolocar la mano. */}
      <div className="flex-1 md:hidden" />

      <textarea
        className="min-h-[38dvh] w-full resize-none rounded-lg border border-[var(--border)] bg-transparent p-4 text-base leading-relaxed outline-none focus:border-[var(--accent)] md:min-h-48"
        placeholder="¿Qué notaste?"
        value={texto}
        onChange={e => setTexto(e.target.value)}
        onKeyDown={onKeyDown}
        autoFocus
      />
      {/* col-reverse en móvil: el botón queda pegado a la caja (zona del
          pulgar) y el enlace a la bandeja encima. En escritorio, fila. */}
      <div className="flex flex-col-reverse gap-3 md:flex-row md:items-center md:justify-between">
        <button
          type="button"
          className="min-h-12 w-full rounded-md bg-[var(--accent)] px-5 font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 md:w-auto md:py-2"
          onClick={guardar}
          disabled={!texto.trim() || guardando}
        >
          Guardar
        </button>
        <Link
          to="/bandeja"
          className="flex min-h-11 items-center justify-center text-sm text-[var(--text)] opacity-70 transition hover:opacity-100 md:min-h-0 md:justify-start"
        >
          {sinClasificar > 0
            ? `${sinClasificar} pendiente${sinClasificar === 1 ? '' : 's'} sin clasificar →`
            : 'bandeja de confirmación →'}
        </Link>
      </div>
    </div>
  );
}
