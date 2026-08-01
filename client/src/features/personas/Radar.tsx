/**
 * Radar SVG de 9 ejes (uno por Dominio). Sin librería externa: son 9 puntos en
 * coordenadas polares, nada que justifique una dependencia.
 *
 * Dos variantes:
 *  - compacta (`size` en px, sin etiquetas): la miniatura de la lista.
 *  - con etiquetas: la pieza principal del detalle, se estira a su contenedor.
 *
 * El dibujo vive en unidades propias del viewBox, con el centro en (0,0) y el
 * radio máximo en RADIO; el tamaño real lo decide quien lo monta. Los trazos
 * llevan `non-scaling-stroke` para medir 1px de verdad tanto a 56px de ancho
 * como a 500 — si no, la miniatura saldría con líneas de cuarto de pixel.
 */
import type { Capa, Dominio } from '../../core/esquema';
import { capaColor, capaColorPorNivel } from '../../ui/semantica';

const INTENSIDAD_MAX = 3; // CAPA_VALOR.central

/** Radio del anillo exterior (capa central). */
const RADIO = 100;
/** Radio donde se apoyan las etiquetas de dominio, por fuera del anillo. */
const RADIO_ETIQUETA = 116;
const FUENTE = 10.5;
const ALTO_LINEA = 12;

/**
 * viewBox de cada variante. El de las etiquetas es ASIMÉTRICO a propósito: el
 * texto más largo cae a la izquierda ("miedos inseguridades"), así que darle el
 * mismo margen a los dos lados dejaría un hueco muerto a la derecha y encogería
 * el radar sin motivo. Lo que se centra es el dibujo completo, no el centro
 * geométrico de la circunferencia.
 *
 * Los números salen de medir las etiquetas reales con getBBox(): ocupan de
 * -186,5 a +158,7 en horizontal y de -129 a +122 en vertical. El margen que
 * sobra es el colchón para que otra fuente del sistema, algo más ancha, no
 * vuelva a recortar el texto por los bordes.
 */
const VISTA_COMPACTA = { x: -104, y: -104, w: 208, h: 208 };
const VISTA_ETIQUETAS = { x: -196, y: -138, w: 364, h: 268 };

/**
 * Los tres anillos de referencia. Se distinguen por TRAZO además de por radio
 * —punteado, discontinuo, continuo— porque con tres polígonos idénticos hay
 * que contar hacia fuera para saber en cuál cae un dominio. El mismo estilo se
 * repite en la leyenda, que es lo que los ata a un nombre de capa.
 *
 * El color es `--text` y no `--border`: el borde está pensado para separar
 * bloques y sobre el fondo oscuro los anillos quedaban casi invisibles.
 */
const ANILLOS: {
  valor: number;
  capa: Capa;
  nombre: string;
  guion?: string;
  opacidad: number;
  grosor: number;
}[] = [
  { valor: 1, capa: 'periferica', nombre: 'periférica', guion: '2 6', opacidad: 0.75, grosor: 1 },
  { valor: 2, capa: 'intermedia', nombre: 'intermedia', guion: '9 5', opacidad: 0.85, grosor: 1 },
  { valor: 3, capa: 'central', nombre: 'central', opacidad: 1, grosor: 1.5 },
];

/** 'miedos_inseguridades' → ['miedos', 'inseguridades'] (una palabra por línea:
 *  apiladas ocupan mucho menos ancho y no invaden a la etiqueta vecina). */
function palabras(dominio: Dominio): string[] {
  return dominio.split('_');
}

interface Props {
  datos: { dominio: Dominio; intensidad: number }[];
  /** Ancho fijo en px para la miniatura. Sin él, ocupa el ancho del contenedor. */
  size?: number;
  etiquetas?: boolean;
}

export function Radar({ datos, size, etiquetas = false }: Props) {
  const n = datos.length;
  const vista = etiquetas ? VISTA_ETIQUETAS : VISTA_COMPACTA;

  function angulo(i: number): number {
    return -Math.PI / 2 + (i * 2 * Math.PI) / n;
  }

  function punto(i: number, intensidad: number): [number, number] {
    const a = angulo(i);
    const r = (intensidad / INTENSIDAD_MAX) * RADIO;
    return [r * Math.cos(a), r * Math.sin(a)];
  }

  const poligono = datos.map((d, i) => punto(i, d.intensidad).join(',')).join(' ');

  return (
    <svg
      viewBox={`${vista.x} ${vista.y} ${vista.w} ${vista.h}`}
      className="h-auto max-w-full"
      style={{ width: size ?? '100%' }}
      role="img"
      aria-label={`Cobertura por dominio: ${datos
        .map(d => `${palabras(d.dominio).join(' ')} ${d.intensidad} de ${INTENSIDAD_MAX}`)
        .join(', ')}`}
    >
      {/* Ejes primero: quedan por debajo de los anillos, que son la referencia
          que hay que leer. */}
      {datos.map((_, i) => {
        const [x, y] = punto(i, INTENSIDAD_MAX);
        return (
          <line
            key={i}
            x1={0}
            y1={0}
            x2={x}
            y2={y}
            stroke="var(--text)"
            strokeWidth={1}
            opacity={0.16}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}

      {ANILLOS.map(anillo => (
        <polygon
          key={anillo.valor}
          points={datos.map((_, i) => punto(i, anillo.valor).join(',')).join(' ')}
          fill="none"
          stroke={capaColor(anillo.capa)}
          strokeWidth={anillo.grosor}
          strokeDasharray={anillo.guion}
          opacity={anillo.opacidad}
          vectorEffect="non-scaling-stroke"
        />
      ))}

      {/* El polígono es DATO, así que no lleva acento: el morado está
          reservado a la interacción. Va en el tono de las capas, que es el eje
          que este gráfico mide. */}
      <polygon
        points={poligono}
        fill="var(--capa-1-bg)"
        stroke={capaColor('intermedia')}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />

      {/* Un punto por dominio alcanzado: marca a qué anillo llega cada eje sin
          tener que seguir el borde del polígono. Los dominios vírgenes (0) caen
          en el centro y no se marcan, que si no serían nueve puntos apilados. */}
      {etiquetas &&
        datos.map((d, i) => {
          if (d.intensidad <= 0) return null;
          const [x, y] = punto(i, d.intensidad);
          // Cada vértice con el color de la capa a la que llega ese dominio:
          // el punto dice la profundidad sin tener que contar anillos.
          return (
            <circle
              key={`p-${d.dominio}`}
              cx={x}
              cy={y}
              r={3.5}
              fill={capaColorPorNivel(d.intensidad)}
            />
          );
        })}

      {etiquetas &&
        datos.map((d, i) => {
          const a = angulo(i);
          const x = RADIO_ETIQUETA * Math.cos(a);
          const y = RADIO_ETIQUETA * Math.sin(a);
          // Las etiquetas crecen HACIA AFUERA: ancladas al centro, las de los
          // extremos izquierdo y derecho se salían del viewBox por la mitad de
          // su ancho (era el recorte de "…iedos_inseguridades").
          const cos = Math.cos(a);
          const anclaje = cos > 0.25 ? 'start' : cos < -0.25 ? 'end' : 'middle';
          const lineas = palabras(d.dominio);
          return (
            <text
              key={`t-${d.dominio}`}
              x={x}
              y={y}
              textAnchor={anclaje}
              dominantBaseline="central"
              fontSize={FUENTE}
              fill="var(--text)"
              opacity={0.8}
            >
              {lineas.map((palabra, k) => (
                <tspan
                  key={palabra}
                  x={x}
                  // El bloque de líneas queda centrado en el punto del eje.
                  dy={k === 0 ? (-(lineas.length - 1) * ALTO_LINEA) / 2 : ALTO_LINEA}
                >
                  {palabra}
                </tspan>
              ))}
            </text>
          );
        })}
    </svg>
  );
}

/** Qué significa cada anillo. Repite el trazo del radar, que es lo que permite
 *  mirar el gráfico y decir "esto llega a intermedia" sin contar anillos. */
export function LeyendaRadar() {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium uppercase tracking-wide opacity-60">Profundidad</span>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {[...ANILLOS].reverse().map(anillo => (
          <span key={anillo.capa} className="flex items-center gap-1.5 text-xs opacity-80">
            <svg width={20} height={8} aria-hidden className="shrink-0">
              <line
                x1={0}
                y1={4}
                x2={20}
                y2={4}
                stroke={capaColor(anillo.capa)}
                strokeWidth={anillo.grosor * 1.6}
                strokeDasharray={anillo.guion}
                opacity={anillo.opacidad}
              />
            </svg>
            {anillo.nombre}
          </span>
        ))}
      </div>
    </div>
  );
}
