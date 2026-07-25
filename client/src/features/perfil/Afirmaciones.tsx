/**
 * Renderiza una sección de afirmaciones del perfil (rasgos, gustos, etc.).
 * Cada afirmación distingue su estatus epistémico con color + ícono (nunca
 * solo color, para que se reconozca de un vistazo y sea accesible), muestra
 * la confianza como indicador secundario más discreto, y expande su
 * evidencia (señales) al tocarla.
 */
import { useState } from 'react';
import type { Afirmacion, Confianza, Senal } from '../../core/esquema';

const ESTATUS_INFO: Record<Afirmacion['estatus'], { icono: string; color: string; etiqueta: string }> = {
  hecho: { icono: '●', color: 'text-emerald-500', etiqueta: 'hecho' },
  inferencia: { icono: '◐', color: 'text-sky-500', etiqueta: 'inferencia' },
  especulacion: { icono: '○', color: 'text-amber-500', etiqueta: 'especulación' },
};

const CONFIANZA_ETIQUETA: Record<Confianza, string> = {
  baja: 'confianza baja',
  media: 'confianza media',
  alta: 'confianza alta',
};

function formatearFechaCorta(iso: string): string {
  return new Date(iso).toLocaleDateString('es', { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Resuelve una lista de IDs de señal contra las señales ya cargadas y las
 * muestra (fecha · tipo · contenido). Compartido por las afirmaciones y por
 * las contradicciones, para que la evidencia se lea igual en ambos sitios.
 */
export function ListaEvidencia({ ids, senales }: { ids: string[]; senales: Senal[] }) {
  return (
    <div className="flex flex-col gap-2">
      {ids.map(id => {
        const senal = senales.find(s => s.id === id);
        if (!senal) {
          return (
            <p key={id} className="text-xs italic opacity-50">
              señal no encontrada ({id})
            </p>
          );
        }
        return (
          <div key={id} className="text-xs">
            <div className="opacity-60">
              {formatearFechaCorta(senal.fecha)} · {senal.tipo}
            </div>
            <div>{senal.contenido}</div>
          </div>
        );
      })}
    </div>
  );
}

/** Leyenda fija: qué significa cada estatus, para no depender de leerlo cada vez. */
export function LeyendaEstatus() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs opacity-70">
      {(Object.keys(ESTATUS_INFO) as Afirmacion['estatus'][]).map(estatus => (
        <span key={estatus} className="flex items-center gap-1">
          <span className={ESTATUS_INFO[estatus].color} aria-hidden>
            {ESTATUS_INFO[estatus].icono}
          </span>
          {ESTATUS_INFO[estatus].etiqueta}
        </span>
      ))}
    </div>
  );
}

interface PropsAfirmacion {
  afirmacion: Afirmacion;
  senales: Senal[];
}

function AfirmacionItem({ afirmacion, senales }: PropsAfirmacion) {
  const [abierta, setAbierta] = useState(false);
  const info = ESTATUS_INFO[afirmacion.estatus];

  return (
    <div className="rounded-lg border border-[var(--border)] p-3">
      <button type="button" className="flex w-full items-start gap-2 text-left" onClick={() => setAbierta(v => !v)}>
        <span className={`mt-0.5 shrink-0 ${info.color}`} aria-hidden>
          {info.icono}
        </span>
        <span className="flex-1 text-sm">{afirmacion.texto}</span>
      </button>
      <div className="mt-1 pl-5 text-xs opacity-60">{CONFIANZA_ETIQUETA[afirmacion.confianza]}</div>

      {abierta && (
        <div className="mt-2 border-t border-[var(--border)] pl-5 pt-2">
          <ListaEvidencia ids={afirmacion.evidencia} senales={senales} />
        </div>
      )}
    </div>
  );
}

interface PropsSeccion {
  titulo: string;
  afirmaciones: Afirmacion[];
  senales: Senal[];
}

export function SeccionAfirmaciones({ titulo, afirmaciones, senales }: PropsSeccion) {
  if (afirmaciones.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-medium opacity-80">{titulo}</h2>
      <div className="flex flex-col gap-2">
        {afirmaciones.map((a, i) => (
          <AfirmacionItem key={i} afirmacion={a} senales={senales} />
        ))}
      </div>
    </div>
  );
}
