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
        className="self-start rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--accent-bg)]"
        onClick={() => setAbierto(true)}
      >
        + predicción propia
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-bg)] p-3">
      <textarea
        className="w-full resize-none rounded border border-[var(--border)] bg-transparent p-2 text-sm"
        value={texto}
        onChange={e => setTexto(e.target.value)}
        rows={2}
        autoFocus
        placeholder="hipótesis comprobable, ej. si la invitan a una fiesta grande, dirá que no"
      />
      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col gap-1 text-xs opacity-70">
          Tipo
          <select
            className="rounded border border-[var(--border)] bg-transparent p-1 text-sm"
            value={tipo}
            onChange={e => setTipo(e.target.value as TipoPrediccion)}
          >
            {TIPOS.map(t => (
              <option key={t.valor} value={t.valor}>
                {t.etiqueta}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs opacity-70">
          Dominio
          <select
            className="rounded border border-[var(--border)] bg-transparent p-1 text-sm"
            value={dominio}
            onChange={e => setDominio(e.target.value as Dominio)}
          >
            {DOMINIOS.map(d => (
              <option key={d} value={d}>
                {d.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs opacity-70">
          Confianza
          <select
            className="rounded border border-[var(--border)] bg-transparent p-1 text-sm"
            value={confianza}
            onChange={e => setConfianza(e.target.value as Confianza)}
          >
            {CONFIANZAS.map(c => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          className="rounded-md bg-[var(--accent)] px-3 py-1 text-sm font-medium text-white disabled:opacity-40"
          onClick={guardar}
          disabled={guardando || !texto.trim()}
        >
          {guardando ? 'guardando…' : 'guardar'}
        </button>
        <button type="button" className="text-sm opacity-60 hover:opacity-100" onClick={cerrar}>
          cancelar
        </button>
      </div>
    </div>
  );
}
