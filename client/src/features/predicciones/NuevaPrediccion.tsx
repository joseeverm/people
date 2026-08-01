/**
 * Alta manual de una predicción (origen: 'manual'): a veces el usuario tiene
 * una hipótesis que el modelo no propuso. Texto + dominio + confianza. Sin
 * evidencia obligatoria — es una corazonada propia, y se calibra igual al
 * resolverla. Colapsado por defecto para no robar protagonismo a la lista.
 */
import { useState } from 'react';
import type { Confianza, Dominio, TipoPrediccion } from '../../core/esquema';
import { DOMINIOS } from '../../core/esquema';
import { repo } from '../../data/dexie-repo';

const CONFIANZAS: Confianza[] = ['baja', 'media', 'alta'];
const TIPOS: { valor: TipoPrediccion; etiqueta: string }[] = [
  { valor: 'extrapolada', etiqueta: 'a prueba (extrapolada, calibra)' },
  { valor: 'inferida', etiqueta: 'síntesis (inferida, no calibra)' },
];

/** Chip tocable: 44px en móvil, 32px en escritorio (`toque-11`, ver index.css).
 *  Reemplaza a los <select> nativos, incómodos en móvil. */
function Chip({
  activo,
  onClick,
  children,
}: {
  activo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={activo}
      onClick={onClick}
      className={`toque-11 rounded-full border px-3 text-sm transition ${
        activo
          ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
          : 'border-[var(--border)] bg-[var(--bg)] opacity-70 hover:opacity-100'
      }`}
    >
      {children}
    </button>
  );
}

interface Props {
  personaId: string;
  onCreada: () => void;
}

export function NuevaPrediccion({ personaId, onCreada }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState('');
  const [dominio, setDominio] = useState<Dominio>(DOMINIOS[0]);
  const [confianza, setConfianza] = useState<Confianza>('media');
  const [tipo, setTipo] = useState<TipoPrediccion>('extrapolada');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cerrar() {
    setAbierto(false);
    setTexto('');
    setDominio(DOMINIOS[0]);
    setConfianza('media');
    setTipo('extrapolada');
    setError(null);
  }

  async function guardar() {
    if (!texto.trim()) return;
    setError(null);
    setGuardando(true);
    try {
      await repo.guardarPrediccion({
        personaId,
        dominio,
        tipo,
        texto: texto.trim(),
        confianza,
        basadaEn: [],
        origen: 'manual',
        estado: 'pendiente',
      });
      onCreada();
      cerrar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar la predicción.');
    } finally {
      setGuardando(false);
    }
  }

  if (!abierto) {
    return (
      <button
        type="button"
        className="toque-12 w-full rounded-md border border-[var(--border)] px-3 text-sm hover:bg-[var(--accent-bg)] sm:w-auto sm:self-start"
        onClick={() => setAbierto(true)}
      >
        + predicción propia
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-bg)] p-4">
      <textarea
        className="min-h-24 w-full resize-none rounded border border-[var(--border)] bg-transparent p-3 text-base md:text-sm"
        value={texto}
        onChange={e => setTexto(e.target.value)}
        autoFocus
        placeholder="hipótesis comprobable, ej. si la invitan a una fiesta grande, dirá que no"
      />

      <div className="flex flex-col gap-2">
        <span className="text-xs opacity-70">Tipo</span>
        <div className="flex flex-wrap gap-2">
          {TIPOS.map(t => (
            <Chip key={t.valor} activo={tipo === t.valor} onClick={() => setTipo(t.valor)}>
              {t.etiqueta}
            </Chip>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs opacity-70">Dominio</span>
        <div className="flex flex-wrap gap-2">
          {DOMINIOS.map(d => (
            <Chip key={d} activo={dominio === d} onClick={() => setDominio(d)}>
              {d.replace(/_/g, ' ')}
            </Chip>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs opacity-70">Confianza</span>
        <div className="flex flex-wrap gap-2">
          {CONFIANZAS.map(c => (
            <Chip key={c} activo={confianza === c} onClick={() => setConfianza(c)}>
              {c}
            </Chip>
          ))}
        </div>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
        <button
          type="button"
          className="toque-12 rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white disabled:opacity-40"
          onClick={guardar}
          disabled={guardando || !texto.trim()}
        >
          {guardando ? 'guardando…' : 'guardar'}
        </button>
        <button type="button" className="toque-12 px-4 text-sm opacity-60 hover:opacity-100" onClick={cerrar}>
          cancelar
        </button>
      </div>
    </div>
  );
}
