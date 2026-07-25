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
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 p-6">
      <textarea
        className="min-h-48 w-full resize-none rounded-lg border border-[var(--border)] bg-transparent p-4 text-base leading-relaxed outline-none focus:border-[var(--accent)]"
        placeholder="¿Qué notaste?"
        value={texto}
        onChange={e => setTexto(e.target.value)}
        onKeyDown={onKeyDown}
        autoFocus
      />
      <div className="flex items-center justify-between">
        <button
          type="button"
          className="rounded-md bg-[var(--accent)] px-5 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
          onClick={guardar}
          disabled={!texto.trim() || guardando}
        >
          Guardar
        </button>
        <Link
          to="/bandeja"
          className="text-sm text-[var(--text)] opacity-70 transition hover:opacity-100"
        >
          {sinClasificar > 0
            ? `${sinClasificar} pendiente${sinClasificar === 1 ? '' : 's'} sin clasificar →`
            : 'bandeja de confirmación →'}
        </Link>
      </div>
    </div>
  );
}
