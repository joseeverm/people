/**
 * Placeholder del paso 4: por ahora solo encabezado (nombre, nivel, radar).
 * Señales, perfil generado y huecos llegan en el próximo paso del MVP.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { CoberturaDominio, EstadoConocimiento, Persona } from '../../core/esquema';
import { CAPA_VALOR, NOMBRE_NIVEL } from '../../core/esquema';
import { calcularEstadoConocimiento, datosRadar } from '../../core/conocimiento';
import { repo } from '../../data/dexie-repo';
import { LeyendaRadar, Radar } from './Radar';

const NOMBRE_CAPA = { periferica: 'periférica', intermedia: 'intermedia', central: 'central' } as const;

/**
 * Los nueve dominios con la capa a la que llega cada uno. Es la lectura exacta
 * de lo que el radar dibuja: el gráfico da la forma de un vistazo y esta lista
 * el dato concreto, sin tener que estimar a ojo a qué anillo toca cada punta.
 */
function ListaDominios({ cobertura }: { cobertura: CoberturaDominio[] }) {
  return (
    <ul className="flex flex-col">
      {cobertura.map(c => {
        const alcanzado = c.capaMax ? CAPA_VALOR[c.capaMax] : 0;
        return (
          <li
            key={c.dominio}
            className="flex items-center justify-between gap-3 border-b border-[var(--border)] py-1.5 text-sm last:border-b-0"
          >
            {/* first-letter y no `capitalize`: este último pone mayúscula en
                CADA palabra ("Miedos Inseguridades", que parece un título). */}
            <span
              className={`min-w-0 truncate first-letter:uppercase ${alcanzado === 0 ? 'opacity-40' : ''}`}
            >
              {c.dominio.replace(/_/g, ' ')}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="text-xs opacity-60">{c.capaMax ? NOMBRE_CAPA[c.capaMax] : 'sin señales'}</span>
              {/* Tres puntos = los tres anillos del radar, rellenos hasta donde llega. */}
              <span className="flex gap-0.5" aria-hidden>
                {[1, 2, 3].map(nivel => (
                  <span
                    key={nivel}
                    className={`size-1.5 rounded-full ${
                      nivel <= alcanzado ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'
                    }`}
                  />
                ))}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function DetallePersona() {
  const { id } = useParams<{ id: string }>();
  // undefined = cargando; null = no existe.
  const [persona, setPersona] = useState<Persona | null | undefined>(undefined);
  const [estado, setEstado] = useState<EstadoConocimiento | null>(null);

  useEffect(() => {
    if (!id) return;
    setPersona(undefined);
    (async () => {
      const [personas, senales, predicciones] = await Promise.all([
        repo.listarPersonas(),
        repo.senalesDe(id),
        repo.prediccionesDe(id),
      ]);
      const encontrada = personas.find(p => p.id === id) ?? null;
      setPersona(encontrada);
      setEstado(encontrada ? calcularEstadoConocimiento(id, senales, predicciones) : null);
    })();
  }, [id]);

  if (persona === undefined) {
    return <div className="p-6 text-sm opacity-70">Cargando…</div>;
  }

  if (persona === null) {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4 sm:p-6">
        <Link to="/personas" className="flex toque-11 items-center text-sm opacity-70 hover:opacity-100">
          ← personas
        </Link>
        <p className="text-sm">No se encontró esta persona.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 p-4 sm:p-6 md:max-w-4xl">
      <Link
        to="/personas"
        className="flex toque-11 w-fit items-center text-sm opacity-70 hover:opacity-100"
      >
        ← personas
      </Link>

      {/* Encabezado a todo el ancho: el nombre y el acceso al perfil no compiten
          con el radar por el sitio, y así el radar se queda la fila entera. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-xl font-medium">{persona.nombre}</h1>
          {estado && (
            <p className="text-sm opacity-70">
              Nivel {estado.nivel} · {NOMBRE_NIVEL[estado.nivel]} · {estado.dominiosCubiertos}/9 dominios
            </p>
          )}
        </div>
        <Link
          to={`/personas/${persona.id}/perfil`}
          className="flex toque-12 shrink-0 items-center justify-center rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-[var(--accent-texto)] sm:w-auto"
        >
          Ver perfil →
        </Link>
      </div>

      {estado && (
        /* El radar manda: se lleva la columna ancha, y el hueco que antes
           quedaba a su derecha lo ocupa la lectura dominio a dominio. Hasta lg
           van apilados, con el radar limitado para que no crezca sin freno. */
        <div className="flex flex-col items-center gap-6 lg:grid lg:grid-cols-[1.5fr_1fr] lg:items-center lg:gap-8">
          <div className="w-full max-w-[540px] lg:max-w-none">
            <Radar datos={datosRadar(estado)} etiquetas />
          </div>
          <div className="flex w-full flex-col gap-4">
            <LeyendaRadar />
            <ListaDominios cobertura={estado.cobertura} />
          </div>
        </div>
      )}
    </div>
  );
}
