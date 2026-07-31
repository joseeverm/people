import { useState } from 'react';
import type { Persona } from '../../core/esquema';
import { repo } from '../../data/dexie-repo';

interface Props {
  onCreada: (p: Persona) => void;
}

function parseLista(texto: string): string[] {
  return texto
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

export function NuevaPersonaForm({ onCreada }: Props) {
  const [nombre, setNombre] = useState('');
  const [aliases, setAliases] = useState('');
  const [contextos, setContextos] = useState('');
  const [guardando, setGuardando] = useState(false);

  async function crear() {
    const nombreLimpio = nombre.trim();
    if (!nombreLimpio) return;
    setGuardando(true);
    try {
      const persona = await repo.crearPersona({
        nombre: nombreLimpio,
        aliases: parseLista(aliases),
        contextos: parseLista(contextos),
        archivada: false,
      });
      onCreada(persona);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[var(--border)] p-4">
      <label className="flex flex-col gap-1 text-sm">
        <span className="opacity-70">Nombre</span>
        <input
          className="min-h-11 rounded border border-[var(--border)] bg-transparent px-3"
          value={nombre}
          onChange={e => setNombre(e.target.value)}
          autoFocus
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="opacity-70">Aliases (separados por coma)</span>
        <input
          className="min-h-11 rounded border border-[var(--border)] bg-transparent px-3"
          value={aliases}
          onChange={e => setAliases(e.target.value)}
          placeholder="Patri, la del camping…"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="opacity-70">Contextos (separados por coma)</span>
        <input
          className="min-h-11 rounded border border-[var(--border)] bg-transparent px-3"
          value={contextos}
          onChange={e => setContextos(e.target.value)}
          placeholder="trabajo, familia…"
        />
      </label>
      <button
        type="button"
        className="min-h-12 w-full rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto sm:self-start"
        disabled={!nombre.trim() || guardando}
        onClick={crear}
      >
        Crear
      </button>
    </div>
  );
}
