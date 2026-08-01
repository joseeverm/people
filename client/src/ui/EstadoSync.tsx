/**
 * Indicador de sincronización. Discreto: solo aparece cuando hay algo que
 * decir (pendientes por subir, subida en curso, primera carga o error). Con
 * todo al día no ocupa ni un pixel — el estado normal no necesita anuncio, y
 * la bajada periódica en segundo plano no se anuncia por no parpadear.
 *
 * "Última sincronización" NO se muestra aquí: no cabe legible en una franja de
 * una línea en móvil. Vive en Ajustes → Sincronización, junto al botón manual.
 *
 * Presentacional, como AvisoSinConexion: quien decide si mostrarlo es App, que
 * necesita el mismo dato para reservarle sitio en el padding.
 */
import type { ProgresoBajada } from '../data/sync';

/** Cómo se lee cada entidad en la barra de progreso. */
const NOMBRE_ENTIDAD: Record<ProgresoBajada['entidad'], string> = {
  persona: 'personas',
  senal: 'señales',
  prediccion: 'predicciones',
  perfil: 'perfiles',
  guia: 'guías',
};

interface Props {
  pendientes: number;
  subiendo: boolean;
  progreso: ProgresoBajada | null;
  error: string | null;
  onReintentar: () => void;
}

function textoProgreso(p: ProgresoBajada): string {
  const cuantas = p.total === null ? `${p.descargadas}` : `${p.descargadas} de ${p.total}`;
  return `Descargando ${NOMBRE_ENTIDAD[p.entidad]}… ${cuantas}`;
}

export function EstadoSync({ pendientes, subiendo, progreso, error, onReintentar }: Props) {
  const texto = error
    ? `No se pudo sincronizar: ${error}`
    : progreso
      ? textoProgreso(progreso)
      : subiendo
        ? 'Subiendo…'
        : `${pendientes} sin subir`;

  // Solo hay barra si el servidor dijo cuántas filas hay; si el conteo falló
  // se descarga igual, con el contador suelto.
  const porcentaje =
    progreso && progreso.total ? Math.min(100, (progreso.descargadas / progreso.total) * 100) : null;

  return (
    <button
      type="button"
      onClick={onReintentar}
      title={error ?? undefined}
      className={`relative block w-full border-t px-4 py-1.5 text-center text-xs ${
        error
          ? 'border-[var(--error-borde)] bg-[var(--error-bg)] text-[var(--error)]'
          : 'border-[var(--border)] bg-[var(--social-bg)] opacity-70'
      }`}
    >
      <span className="line-clamp-1">{texto}</span>
      {porcentaje !== null && (
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 block h-0.5 bg-[var(--accent)] transition-[width] duration-300"
          style={{ width: `${porcentaje}%` }}
        />
      )}
    </button>
  );
}
