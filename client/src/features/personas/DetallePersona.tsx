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
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4 p-6">
        <Link to="/personas" className="text-sm opacity-70 hover:opacity-100">
          ← personas
        </Link>
        <p className="text-sm">No se encontró esta persona.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-3 p-6">
      <div className="flex w-full">
        <Link to="/personas" className="text-sm opacity-70 hover:opacity-100">
          ← personas
        </Link>
      </div>
      <h1 className="text-xl font-medium">{persona.nombre}</h1>
      {estado && (
        <>
          <p className="text-sm opacity-70">
            Nivel {estado.nivel} · {NOMBRE_NIVEL[estado.nivel]} · {estado.dominiosCubiertos}/9 dominios
          </p>
          <Radar datos={datosRadar(estado)} size={240} etiquetas />
          <Link
            to={`/personas/${persona.id}/perfil`}
            className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
          >
            Ver perfil →
          </Link>
        </>
      )}
    </div>
  );
}
