/**
 * Renderiza una sección de afirmaciones del perfil (rasgos, gustos, etc.).
 * Cada afirmación distingue su estatus epistémico con color + ícono (nunca
 * solo color, para que se reconozca de un vistazo y sea accesible), muestra
 * la confianza como indicador secundario más discreto, y expande su
 * evidencia (señales) al tocarla.
 */
import { useState } from 'react';
import type { Afirmacion, Confianza, Senal } from '../../core/esquema';
import { CERTEZA } from '../../ui/semantica';

// El estatus epistémico ya no son tres colores sueltos: es un gradiente de
// certeza (ver ui/semantica.ts). Lo que de verdad separa los tres es la FORMA
// —icono ●/◐/○ y borde sólido vs. punteado—, no el tono.

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
      {(Object.keys(CERTEZA) as Afirmacion['estatus'][]).map(estatus => (
        <span key={estatus} className="flex items-center gap-1">
          <span className={CERTEZA[estatus].punto} aria-hidden>
            {CERTEZA[estatus].icono}
          </span>
          {CERTEZA[estatus].nombre}
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
  const info = CERTEZA[afirmacion.estatus];

  return (
    // El borde ES el dato: sólido cuando la afirmación se sostiene, PUNTEADO
    // cuando es especulación. Se reconoce de reojo, sin leer ni distinguir tono.
    <div className={`rounded-lg border ${info.borde}`}>
      {/* Toda la afirmación (texto + confianza + chevron) es el área de toque:
          toque-14 y padding propio, no un renglón de 20px. */}
      <button
        type="button"
        aria-expanded={abierta}
        className="flex toque-14 w-full items-start gap-2 p-3 text-left"
        onClick={() => setAbierta(v => !v)}
      >
        <span className={`mt-0.5 shrink-0 ${info.punto}`} aria-label={info.nombre} role="img">
          {info.icono}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm">{afirmacion.texto}</span>
          <span className="mt-1 block text-xs opacity-60">{CONFIANZA_ETIQUETA[afirmacion.confianza]}</span>
        </span>
        <span
          className={`mt-0.5 shrink-0 text-xs opacity-50 transition-transform ${abierta ? 'rotate-180' : ''}`}
          aria-hidden
        >
          ▾
        </span>
      </button>

      {abierta && (
        <div className="border-t border-[var(--border)] px-3 pb-3 pl-8 pt-3">
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
  /** Descripción bajo el título, cuando la sección necesita explicarse. */
  nota?: string;
  /**
   * Qué mostrar si la lista viene vacía. SIN esta prop la sección desaparece
   * entera (lo que hace el perfil: un bloque "Gustos" vacío es ruido).
   * CON ella se muestra el título y este texto — que es lo que necesita la
   * guía de relación, donde un bloque vacío es un resultado con significado:
   * dice qué falta observar para poder llenarlo.
   */
  vacio?: string;
}

export function SeccionAfirmaciones({ titulo, afirmaciones, senales, nota, vacio }: PropsSeccion) {
  if (afirmaciones.length === 0 && !vacio) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-medium opacity-80">{titulo}</h2>
        {nota && <p className="text-xs opacity-55">{nota}</p>}
      </div>
      {afirmaciones.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[var(--border)] p-3 text-sm opacity-60">
          {vacio}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {afirmaciones.map((a, i) => (
            <AfirmacionItem key={i} afirmacion={a} senales={senales} />
          ))}
        </div>
      )}
    </div>
  );
}
