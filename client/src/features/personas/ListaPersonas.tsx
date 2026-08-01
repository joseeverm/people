/**
 * Lista de personas con nivel calculado al vuelo (nunca almacenado):
 * por cada Persona se piden sus señales y predicciones y se recalcula
 * su EstadoConocimiento con calcularEstadoConocimiento().
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { EstadoConocimiento, Persona } from '../../core/esquema';
import { NOMBRE_NIVEL } from '../../core/esquema';
import { calcularEstadoConocimiento, datosRadar } from '../../core/conocimiento';
import { repo } from '../../data/dexie-repo';
import { useDatosBajados } from '../../ui/useDatosBajados';
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

  const cargar = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // El pull puede traer personas o señales del otro dispositivo mientras esta
  // lista está abierta; sin esto habría que salir y volver para verlas.
  useDatosBajados(cargar);

  function onCreada() {
    setMostrarForm(false);
    cargar();
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4 sm:p-6 md:max-w-3xl">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-medium">Personas</h1>
        <button
          type="button"
          className="toque-11 shrink-0 rounded-md bg-[var(--accent)] px-3 text-sm font-medium text-white"
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

      {/* Dos columnas en escritorio: una fila de nombre + radar de 56px no
          llena 768px, y una sola columna deja la mitad derecha vacía. */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {filas?.map(({ persona, estado }) => (
          <button
            key={persona.id}
            type="button"
            className="flex min-h-20 items-center justify-between gap-3 rounded-lg border border-[var(--border)] p-4 text-left transition hover:border-[var(--accent)] md:min-h-0 md:p-3"
            onClick={() => navigate(`/personas/${persona.id}`)}
          >
            {/* min-w-0: sin esto un nombre largo ensancha la fila y saca
                scroll horizontal en vez de partirse. */}
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="font-medium">{persona.nombre}</span>
              {/* El nivel se lee desde la lista, sin entrar al detalle. */}
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs opacity-70">
                <span className="rounded-full border border-[var(--accent-border)] bg-[var(--accent-bg)] px-2 py-0.5 font-medium text-[var(--accent)]">
                  Nivel {estado.nivel}
                </span>
                <span>{NOMBRE_NIVEL[estado.nivel]}</span>
                <span>· {estado.dominiosCubiertos}/9 dominios</span>
              </span>
            </div>
            <span className="shrink-0">
              <Radar datos={datosRadar(estado)} size={56} />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
