/**
 * Placeholder del paso 4: por ahora solo encabezado (nombre, nivel, radar).
 * Señales, perfil generado y huecos llegan en el próximo paso del MVP.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { EstadoConocimiento, Persona } from '../../core/esquema';
import { NOMBRE_NIVEL } from '../../core/esquema';
import { calcularEstadoConocimiento, datosRadar } from '../../core/conocimiento';
import { repo } from '../../data/dexie-repo';
import { Radar } from './Radar';

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
        <Link to="/personas" className="flex min-h-11 items-center text-sm opacity-70 hover:opacity-100">
          ← personas
        </Link>
        <p className="text-sm">No se encontró esta persona.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 p-4 sm:p-6">
      <div className="flex w-full">
        <Link to="/personas" className="flex min-h-11 items-center text-sm opacity-70 hover:opacity-100">
          ← personas
        </Link>
      </div>
      <h1 className="text-center text-xl font-medium">{persona.nombre}</h1>
      {estado && (
        <>
          <p className="text-center text-sm opacity-70">
            Nivel {estado.nivel} · {NOMBRE_NIVEL[estado.nivel]} · {estado.dominiosCubiertos}/9 dominios
          </p>
          {/* El radar es un SVG de lado fijo: se deja encoger para que no
              saque scroll horizontal en pantallas muy estrechas. */}
          <div className="w-full max-w-[240px]">
            <Radar datos={datosRadar(estado)} size={240} etiquetas />
          </div>
          <Link
            to={`/personas/${persona.id}/perfil`}
            className="flex min-h-12 w-full items-center justify-center rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white sm:w-auto"
          >
            Ver perfil →
          </Link>
        </>
      )}
    </div>
  );
}
