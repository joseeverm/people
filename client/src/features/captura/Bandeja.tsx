/**
 * Vista aparte, se entra manualmente. Dos etapas por nota:
 *  A) SIN IA: el usuario asigna a mano de quién es la nota (AsignarPersona) —
 *     ahorra tokens y hace la asignación infalible; no depende de que el
 *     LLM adivine identidades.
 *  B) CON IA: solo cuando ya tiene persona asignada se habilita clasificarla
 *     (core/clasificador.ts) y confirmar la propuesta como Senal a través
 *     del Repository. Nunca toca Dexie directo.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CapturaPendiente, Persona, Senal } from '../../core/esquema';
import { clasificar } from '../../core/clasificador';
import type { EntradaClasificacion, PropuestaSenal } from '../../core/clasificador';
import { ErrorLLM } from '../../core/llm';
import { repo } from '../../data/dexie-repo';
import { AsignarPersona } from './AsignarPersona';
import { TarjetaPropuesta } from './TarjetaPropuesta';

/** Gemini limita peticiones por minuto: entre nota y nota, para no gatillar 429. */
const PAUSA_ENTRE_PETICIONES_MS = 4000;
/** Antes del único reintento de una nota que dio 429. */
const ESPERA_REINTENTO_429_MS = 10000;

function esperar(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatearErrorClasificacion(e: unknown): string {
  if (e instanceof ErrorLLM) return `${e.message} (status ${e.status})`;
  return e instanceof Error ? e.message : String(e);
}

async function clasificarConReintento(entrada: EntradaClasificacion): Promise<PropuestaSenal> {
  try {
    return await clasificar(entrada);
  } catch (e) {
    if (e instanceof ErrorLLM && e.status === 429) {
      await esperar(ESPERA_REINTENTO_429_MS);
      return await clasificar(entrada);
    }
    throw e;
  }
}

/** Reconstruye la EntradaClasificacion de una captura que ya tiene persona(s) asignada(s). */
function entradaDe(c: CapturaPendiente, personas: Persona[]): EntradaClasificacion | null {
  if (!c.personaId) return null;
  const persona = personas.find(p => p.id === c.personaId);
  if (!persona) return null;
  const personasSecundarias = (c.personaIdsSecundarios ?? [])
    .map(id => personas.find(p => p.id === id))
    .filter((p): p is Persona => !!p);
  return { textoCrudo: c.textoCrudo, persona, personasSecundarias };
}

export function Bandeja() {
  const [pendientes, setPendientes] = useState<CapturaPendiente[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [senales, setSenales] = useState<Senal[]>([]);
  const [propuestas, setPropuestas] = useState<Record<string, PropuestaSenal>>({});
  const [progreso, setProgreso] = useState<{ actual: number; total: number } | null>(null);
  const [errores, setErrores] = useState<string[]>([]);

  async function cargar() {
    const [todasPendientes, todasPersonas, todasSenales] = await Promise.all([
      repo.pendientes(),
      repo.listarPersonas(),
      repo.todasLasSenales(),
    ]);
    setPendientes(todasPendientes.filter(c => c.estado === 'sin_clasificar'));
    setPersonas(todasPersonas);
    setSenales(todasSenales);
  }

  useEffect(() => {
    cargar();
  }, []);

  // Solo las notas que YA tienen persona asignada y no tienen propuesta todavía.
  const listasParaClasificar = pendientes.filter(c => c.personaId && !propuestas[c.idLocal]);

  async function clasificarPendientes() {
    setErrores([]);
    const objetivo = listasParaClasificar
      .map(c => ({ c, entrada: entradaDe(c, personas) }))
      .filter((x): x is { c: CapturaPendiente; entrada: EntradaClasificacion } => !!x.entrada);
    const nuevosErrores: string[] = [];
    try {
      for (let i = 0; i < objetivo.length; i++) {
        const { c, entrada } = objetivo[i];
        setProgreso({ actual: i + 1, total: objetivo.length });
        try {
          // Nota queda con estado 'sin_clasificar' en el repo hasta confirmarse;
          // si esto falla, simplemente no entra a `propuestas` y se puede reintentar.
          const propuesta = await clasificarConReintento(entrada);
          setPropuestas(prev => ({ ...prev, [c.idLocal]: propuesta }));
        } catch (e) {
          nuevosErrores.push(formatearErrorClasificacion(e));
        }
        if (i < objetivo.length - 1) await esperar(PAUSA_ENTRE_PETICIONES_MS);
      }
      setErrores(nuevosErrores);
    } finally {
      setProgreso(null);
    }
  }

  function onPersonaCreada(p: Persona) {
    setPersonas(prev => [...prev, p]);
  }

  /** Refleja en memoria la asignación que AsignarPersona ya persistió en el repo. */
  function onAsignada(idLocal: string, personaId: string, personaIdsSecundarios: string[]) {
    setPendientes(prev =>
      prev.map(c => (c.idLocal === idLocal ? { ...c, personaId, personaIdsSecundarios } : c))
    );
  }

  async function onConfirmar(idLocal: string, senal: Omit<Senal, 'id'>) {
    await repo.resolverCaptura(idLocal, senal);
    setPendientes(prev => prev.filter(p => p.idLocal !== idLocal));
    setPropuestas(prev => {
      const { [idLocal]: _descartada, ...resto } = prev;
      return resto;
    });
    // Deja compania/situacion nuevos disponibles como sugerencia para las
    // próximas tarjetas de esta misma sesión, sin esperar a recargar.
    setSenales(prev => [...prev, { ...senal, id: crypto.randomUUID() }]);
  }

  return (
    // Más ancha que el resto: la tarjeta de propuesta se reparte en dos
    // columnas a partir de lg y necesita el sitio (ver TarjetaPropuesta).
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4 sm:p-6 md:max-w-3xl lg:max-w-4xl">
      <div className="flex items-center justify-between gap-3">
        <Link to="/" className="flex toque-11 items-center text-sm opacity-70 hover:opacity-100">
          ← captura
        </Link>
        {listasParaClasificar.length > 0 && (
          <button
            type="button"
            className="toque-11 rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-[var(--accent-texto)] disabled:cursor-not-allowed disabled:opacity-40"
            onClick={clasificarPendientes}
            disabled={progreso !== null}
          >
            {progreso
              ? `clasificando ${progreso.actual} de ${progreso.total}…`
              : `clasificar (${listasParaClasificar.length})`}
          </button>
        )}
      </div>

      {errores.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg border border-[var(--error-borde)] bg-[var(--error-bg)] p-3 text-left text-sm text-[var(--error)]">
          {errores.map((mensaje, i) => (
            <p key={i} className="whitespace-pre-wrap">
              {mensaje}
            </p>
          ))}
        </div>
      )}

      {pendientes.length === 0 && <p className="text-sm opacity-70">No hay capturas pendientes.</p>}

      <div className="flex flex-col gap-4">
        {pendientes.map(c => {
          const entrada = entradaDe(c, personas);

          if (!entrada) {
            return (
              <AsignarPersona
                key={c.idLocal}
                captura={c}
                personas={personas}
                onAsignada={onAsignada}
                onPersonaCreada={onPersonaCreada}
              />
            );
          }

          if (propuestas[c.idLocal]) {
            return (
              <TarjetaPropuesta
                key={c.idLocal}
                captura={c}
                entrada={entrada}
                propuesta={propuestas[c.idLocal]}
                senales={senales}
                onConfirmar={onConfirmar}
              />
            );
          }

          const nombres = [entrada.persona, ...(entrada.personasSecundarias ?? [])]
            .map(p => p.nombre)
            .join(', ');
          return (
            <div
              key={c.idLocal}
              className="rounded-lg border border-dashed border-[var(--border)] p-4 text-left text-sm opacity-70"
            >
              <p>{c.textoCrudo}</p>
              <div className="mt-1 text-xs opacity-60">asignada a {nombres}, lista para clasificar</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
