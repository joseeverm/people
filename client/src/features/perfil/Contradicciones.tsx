/**
 * Sección de CONTRADICCIONES del perfil — el hallazgo más valioso del sistema:
 * dónde lo que la persona dice choca con lo que hace, o cómo cambia entre
 * marcos. Va visualmente destacada (borde/acento propios) para que no se
 * confunda con las afirmaciones normales. Cada contradicción muestra la
 * tensión, su interpretación tentativa (si la hay), la confianza, y expande
 * las señales en tensión igual que la evidencia de las afirmaciones.
 */
import { useState } from 'react';
import type { Confianza, Contradiccion, Senal } from '../../core/esquema';
import { ListaEvidencia } from './Afirmaciones';

const CONFIANZA_ETIQUETA: Record<Confianza, string> = {
  baja: 'confianza baja',
  media: 'confianza media',
  alta: 'confianza alta',
};

function ContradiccionItem({ contradiccion, senales }: { contradiccion: Contradiccion; senales: Senal[] }) {
  const [abierta, setAbierta] = useState(false);

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 text-amber-500" aria-hidden>
          ⚡
        </span>
        <p className="flex-1 text-sm">{contradiccion.descripcion}</p>
      </div>

      {contradiccion.interpretacion && (
        <p className="mt-2 pl-6 text-sm italic opacity-80">
          <span className="not-italic opacity-60">Hipótesis: </span>
          {contradiccion.interpretacion}
        </p>
      )}

      <div className="mt-1 flex flex-wrap items-center gap-x-3 pl-6 text-xs opacity-60">
        <span>{CONFIANZA_ETIQUETA[contradiccion.confianza]}</span>
        {contradiccion.senalesEnTension.length > 0 && (
          <button
            type="button"
            aria-expanded={abierta}
            className="flex toque-11 items-center underline hover:opacity-100"
            onClick={() => setAbierta(v => !v)}
          >
            {abierta ? 'ocultar' : `ver señales en tensión (${contradiccion.senalesEnTension.length})`}
          </button>
        )}
      </div>

      {abierta && (
        <div className="mt-2 border-t border-amber-500/30 pl-6 pt-2">
          <ListaEvidencia ids={contradiccion.senalesEnTension} senales={senales} />
        </div>
      )}
    </div>
  );
}

interface Props {
  contradicciones: Contradiccion[];
  senales: Senal[];
}

export function SeccionContradicciones({ contradicciones, senales }: Props) {
  if (contradicciones.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h2 className="flex items-center gap-2 text-sm font-medium text-amber-600">
        <span aria-hidden>⚡</span> Contradicciones
      </h2>
      <div className="flex flex-col gap-2">
        {contradicciones.map((c, i) => (
          <ContradiccionItem key={i} contradiccion={c} senales={senales} />
        ))}
      </div>
    </div>
  );
}
