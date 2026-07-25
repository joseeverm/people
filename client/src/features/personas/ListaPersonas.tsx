/**
 * Lista de personas con nivel calculado al vuelo (nunca almacenado):
 * por cada Persona se piden sus señales y predicciones y se recalcula
 * su EstadoConocimiento con calcularEstadoConocimiento().
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { EstadoConocimiento, Persona } from '../../core/esquema';
import { NOMBRE_NIVEL } from '../../core/esquema';
import { calcularEstadoConocimiento, datosRadar } from '../../core/conocimiento';
import { repo } from '../../data/dexie-repo';
import { NuevaPersonaForm } from './NuevaPersonaForm';
import { Radar } from './Radar';

interface Fila {
  persona: Persona;
  estado: EstadoConocimiento;
}

export function ListaPersonas() {
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [mostrarForm, setMostrarForm] = useState(false);
  const navigate = useNavigate();

  async function cargar() {
    const personas = await repo.listarPersonas();
    const conEstado = await Promise.all(
      personas.map(async persona => {
        const [senales, predicciones] = await Promise.all([
          repo.senalesDe(persona.id),
          repo.prediccionesDe(persona.id),
        ]);
        return { persona, estado: calcularEstadoConocimiento(persona.id, senales, predicciones) };
      })
    );
    setFilas(conEstado);
  }

  useEffect(() => {
    cargar();
  }, []);

  function onCreada() {
    setMostrarForm(false);
    cargar();
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">Personas</h1>
        <button
          type="button"
          className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white"
          onClick={() => setMostrarForm(v => !v)}
        >
          {mostrarForm ? 'cancelar' : '+ nueva persona'}
        </button>
      </div>

      {mostrarForm && <NuevaPersonaForm onCreada={onCreada} />}

      {filas === null && <p className="text-sm opacity-70">Cargando…</p>}
      {filas !== null && filas.length === 0 && (
        <p className="text-sm opacity-70">Todavía no registraste a nadie.</p>
      )}

      <div className="flex flex-col gap-2">
        {filas?.map(({ persona, estado }) => (
          <button
            key={persona.id}
            type="button"
            className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] p-3 text-left transition hover:border-[var(--accent)]"
            onClick={() => navigate(`/personas/${persona.id}`)}
          >
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">{persona.nombre}</span>
              <span className="text-xs opacity-70">
                Nivel {estado.nivel} · {NOMBRE_NIVEL[estado.nivel]} · {estado.dominiosCubiertos}/9 dominios
              </span>
            </div>
            <Radar datos={datosRadar(estado)} size={56} />
          </button>
        ))}
      </div>
    </div>
  );
}
