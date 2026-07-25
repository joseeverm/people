/**
 * Tarjeta de una predicción. Dos modos:
 *  - PENDIENTE: texto, dominio, confianza, cuándo se creó, evidencia (basadaEn)
 *    expandible como en las afirmaciones del perfil, y tres botones para
 *    resolverla (acertó / parcial / falló). Al pulsar uno, pide el texto de qué
 *    pasó (obligatorio: es la evidencia de la verificación) y resuelve.
 *  - RESUELTA: estado con color propio + el texto de la señal de verificación.
 */
import { useState } from 'react';
import type { Confianza, Prediccion, Senal } from '../../core/esquema';
import { repo } from '../../data/dexie-repo';
import { ListaEvidencia } from '../perfil/Afirmaciones';
import { ETIQUETA_ESTADO, ETIQUETA_TIPO, resolverPrediccion, type EstadoResolucion } from './resolver';

const CONFIANZA_ETIQUETA: Record<Confianza, string> = {
  baja: 'confianza baja',
  media: 'confianza media',
  alta: 'confianza alta',
};

const ESTADO_INFO: Record<EstadoResolucion, { etiqueta: string; clasesCard: string; clasesBadge: string }> = {
  acertada: {
    etiqueta: 'acertó',
    clasesCard: 'border-emerald-500/40 bg-emerald-500/5',
    clasesBadge: 'bg-emerald-500/15 text-emerald-600',
  },
  parcial: {
    etiqueta: 'parcial',
    clasesCard: 'border-amber-500/40 bg-amber-500/5',
    clasesBadge: 'bg-amber-500/15 text-amber-600',
  },
  fallida: {
    etiqueta: 'falló',
    clasesCard: 'border-red-500/40 bg-red-500/5',
    clasesBadge: 'bg-red-500/15 text-red-600',
  },
};

function humanizar(slug: string): string {
  return slug.replace(/_/g, ' ');
}

function formatearFechaCorta(iso: string): string {
  return new Date(iso).toLocaleDateString('es', { year: 'numeric', month: 'short', day: 'numeric' });
}

interface Props {
  prediccion: Prediccion;
  /** Señales de la persona (o todas): para resolver evidencia y verificación. */
  senales: Senal[];
  /** Se llama tras resolver con éxito, para que el contenedor recargue. */
  onResuelta: () => void;
  /** Mostrar el nombre de la persona (útil en la vista global). */
  nombrePersona?: string;
}

export function TarjetaPrediccion({ prediccion, senales, onResuelta, nombrePersona }: Props) {
  const [verEvidencia, setVerEvidencia] = useState(false);
  const [resolviendo, setResolviendo] = useState<EstadoResolucion | null>(null);
  const [texto, setTexto] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- Modo RESUELTA ----
  if (prediccion.estado !== 'pendiente') {
    if (prediccion.estado === 'descartada') {
      return (
        <div className="rounded-lg border border-[var(--border)] p-3 text-sm opacity-60">
          <span className="text-xs uppercase tracking-wide">descartada</span>
          <p className="mt-1 line-through">{prediccion.texto}</p>
        </div>
      );
    }
    const info = ESTADO_INFO[prediccion.estado];
    const verificacion = prediccion.resueltaPor
      ? senales.find(s => s.id === prediccion.resueltaPor)
      : undefined;
    return (
      <div className={`flex flex-col gap-2 rounded-lg border p-3 ${info.clasesCard}`}>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={`rounded-full px-2 py-0.5 font-medium ${info.clasesBadge}`}>{info.etiqueta}</span>
          <span className="rounded-full border border-[var(--border)] px-1.5 py-0.5 opacity-60">
            {ETIQUETA_TIPO[prediccion.tipo] ?? ETIQUETA_TIPO.extrapolada}
          </span>
          <span className="capitalize opacity-60">{humanizar(prediccion.dominio)}</span>
          {nombrePersona && <span className="opacity-60">· {nombrePersona}</span>}
        </div>
        <p className="text-sm">{prediccion.texto}</p>
        {verificacion && (
          <p className="border-t border-[var(--border)] pt-2 text-xs opacity-70">
            <span className="opacity-60">Qué pasó: </span>
            {verificacion.contenido}
          </p>
        )}
      </div>
    );
  }

  // ---- Modo PENDIENTE ----
  async function confirmarResolucion() {
    if (!resolviendo) return;
    setError(null);
    setGuardando(true);
    try {
      await resolverPrediccion(repo, prediccion, resolviendo, texto);
      onResuelta();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo resolver la predicción.');
      setGuardando(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[var(--border)] p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs opacity-60">
        <span className="rounded-full border border-[var(--border)] px-1.5 py-0.5 opacity-80">
          {ETIQUETA_TIPO[prediccion.tipo] ?? ETIQUETA_TIPO.extrapolada}
        </span>
        <span className="capitalize">{humanizar(prediccion.dominio)}</span>
        <span>· {CONFIANZA_ETIQUETA[prediccion.confianza]}</span>
        {nombrePersona && <span>· {nombrePersona}</span>}
        <span>· {formatearFechaCorta(prediccion.creadaEn)}</span>
        {prediccion.origen === 'manual' && (
          <span className="rounded-full border border-[var(--border)] px-1.5 py-0.5">tuya</span>
        )}
      </div>

      <p className="text-sm">{prediccion.texto}</p>

      {prediccion.basadaEn.length > 0 && (
        <div>
          <button
            type="button"
            className="text-xs underline opacity-60 hover:opacity-100"
            onClick={() => setVerEvidencia(v => !v)}
          >
            {verEvidencia ? 'ocultar evidencia' : `ver evidencia (${prediccion.basadaEn.length})`}
          </button>
          {verEvidencia && (
            <div className="mt-2 border-t border-[var(--border)] pt-2">
              <ListaEvidencia ids={prediccion.basadaEn} senales={senales} />
            </div>
          )}
        </div>
      )}

      {resolviendo ? (
        <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-2">
          <label className="text-xs opacity-70">
            ¿Qué pasó realmente? ({ETIQUETA_ESTADO[resolviendo]}) — se guarda como verificación
          </label>
          <textarea
            className="w-full resize-none rounded border border-[var(--border)] bg-transparent p-2 text-sm"
            value={texto}
            onChange={e => setTexto(e.target.value)}
            rows={2}
            autoFocus
            placeholder="ej. la invité al asado y aceptó sin dudar"
          />
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-md bg-[var(--accent)] px-3 py-1 text-sm font-medium text-white disabled:opacity-40"
              onClick={confirmarResolucion}
              disabled={guardando || !texto.trim()}
            >
              {guardando ? 'guardando…' : 'confirmar'}
            </button>
            <button
              type="button"
              className="text-sm opacity-60 hover:opacity-100"
              onClick={() => {
                setResolviendo(null);
                setTexto('');
                setError(null);
              }}
            >
              cancelar
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          {(['acertada', 'parcial', 'fallida'] as EstadoResolucion[]).map(estado => (
            <button
              key={estado}
              type="button"
              className="rounded-md border border-[var(--border)] px-3 py-1 text-sm hover:bg-[var(--accent-bg)]"
              onClick={() => setResolviendo(estado)}
            >
              {ETIQUETA_ESTADO[estado]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
