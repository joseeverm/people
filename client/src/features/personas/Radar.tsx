/**
 * Radar SVG de 9 ejes (uno por Dominio). Sin librería externa: son 9 puntos
 * en coordenadas polares, nada que justifique una dependencia.
 */
import type { Dominio } from '../../core/esquema';

const INTENSIDAD_MAX = 3; // CAPA_VALOR.central

interface Props {
  datos: { dominio: Dominio; intensidad: number }[];
  size?: number;
  etiquetas?: boolean;
}

export function Radar({ datos, size = 64, etiquetas = false }: Props) {
  const centro = size / 2;
  const radioMax = size / 2 - (etiquetas ? size * 0.22 : size * 0.08);
  const n = datos.length;

  function punto(i: number, intensidad: number): [number, number] {
    const angulo = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const r = (intensidad / INTENSIDAD_MAX) * radioMax;
    return [centro + r * Math.cos(angulo), centro + r * Math.sin(angulo)];
  }

  const poligono = datos.map((d, i) => punto(i, d.intensidad).join(',')).join(' ');

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {[1, 2, 3].map(nivel => (
        <polygon
          key={nivel}
          points={datos.map((_, i) => punto(i, nivel).join(',')).join(' ')}
          fill="none"
          stroke="var(--border)"
          strokeWidth={1}
        />
      ))}
      {datos.map((_, i) => {
        const [x, y] = punto(i, INTENSIDAD_MAX);
        return <line key={i} x1={centro} y1={centro} x2={x} y2={y} stroke="var(--border)" strokeWidth={1} />;
      })}
      <polygon points={poligono} fill="var(--accent-bg)" stroke="var(--accent)" strokeWidth={1.5} />
      {etiquetas &&
        datos.map((d, i) => {
          const [x, y] = punto(i, INTENSIDAD_MAX + 0.7);
          return (
            <text key={d.dominio} x={x} y={y} fontSize={8} textAnchor="middle" fill="var(--text)" opacity={0.7}>
              {d.dominio}
            </text>
          );
        })}
    </svg>
  );
}
