/**
 * Pestaña "Señales" de la vista de perfil: todas las señales de una persona,
 * en orden cronológico inverso. Solo lectura — las señales son inmutables
 * (invariante #1, ver CLAUDE.md), así que aquí no hay edición ni borrado.
 */
import type { Senal, TipoSenal } from '../../core/esquema';

const NOMBRE_TIPO: Record<TipoSenal, string> = {
  observacion: 'observación',
  cita: 'cita',
  respuesta: 'respuesta',
  comportamiento: 'comportamiento',
  dato_conocido: 'dato conocido',
  verificacion: 'verificación',
};

function formatearFecha(iso: string): string {
  return new Date(iso).toLocaleDateString('es', { year: 'numeric', month: 'short', day: 'numeric' });
}

interface Props {
  senales: Senal[];
}

export function VistaSenales({ senales }: Props) {
  if (senales.length === 0) {
    return <p className="text-sm opacity-70">Todavía no hay señales registradas para esta persona.</p>;
  }

  const ordenadas = [...senales].sort(
    (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()
  );

  return (
    <div className="flex flex-col gap-2">
      {ordenadas.map(s => {
        // Señales legadas (previas al cambio) no traen estos campos: ?? [].
        const compania = s.compania ?? [];
        const situacion = s.situacion ?? [];
        const sinMarcoSocial = compania.length === 0 && situacion.length === 0;
        return (
          <div key={s.id} className="rounded-lg border border-[var(--border)] p-3 text-sm">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs opacity-70">
              <span>{formatearFecha(s.fecha)}</span>
              <span>{NOMBRE_TIPO[s.tipo]}</span>
              {sinMarcoSocial ? (
                <span className="italic opacity-60">sin ámbito concreto</span>
              ) : (
                <>
                  {compania.map(c => (
                    <span key={`c-${c}`} className="rounded-full border border-[var(--border)] px-2 py-0.5">
                      {c}
                    </span>
                  ))}
                  {situacion.map(sit => (
                    <span key={`s-${sit}`} className="rounded-full border border-[var(--border)] px-2 py-0.5 italic">
                      {sit}
                    </span>
                  ))}
                </>
              )}
            </div>

            <p className="mt-1">{s.contenido}</p>

            {s.etiquetas.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {s.etiquetas.map((e, i) => (
                  <span
                    key={i}
                    className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs opacity-80"
                  >
                    {e.dominio}/{e.capa}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
