/**
 * Etapa A del flujo de clasificación (sin IA): el usuario asigna a mano de
 * quién es la nota ANTES de llamar al clasificador. Ahorra tokens (no hay
 * que mandarle el catálogo completo a la IA) y hace la asignación infalible.
 * La asignación se persiste de inmediato en la CapturaPendiente para no
 * perderla si el usuario sale de la bandeja antes de clasificar.
 */
import { useState } from 'react';
import type { CapturaPendiente, Persona } from '../../core/esquema';
import { repo } from '../../data/dexie-repo';

const OPCION_NUEVA = '__nueva__';

interface Props {
  captura: CapturaPendiente;
  personas: Persona[];
  onAsignada: (idLocal: string, personaId: string, personaIdsSecundarios: string[]) => void;
  onPersonaCreada: (p: Persona) => void;
}

export function AsignarPersona({ captura, personas, onAsignada, onPersonaCreada }: Props) {
  const [principal, setPrincipal] = useState(captura.personaId ?? '');
  const [conSecundaria, setConSecundaria] = useState((captura.personaIdsSecundarios?.length ?? 0) > 0);
  const [secundaria, setSecundaria] = useState(captura.personaIdsSecundarios?.[0] ?? '');
  const [creandoPara, setCreandoPara] = useState<'principal' | 'secundaria' | null>(null);
  const [nombreNueva, setNombreNueva] = useState('');
  const [guardando, setGuardando] = useState(false);

  async function persistir(nuevoPrincipal: string, nuevaSecundaria: string) {
    if (!nuevoPrincipal) return;
    setGuardando(true);
    try {
      const secundarios = nuevaSecundaria ? [nuevaSecundaria] : [];
      await repo.asignarPersonasCaptura(captura.idLocal, nuevoPrincipal, secundarios);
      onAsignada(captura.idLocal, nuevoPrincipal, secundarios);
    } finally {
      setGuardando(false);
    }
  }

  function cambiarPrincipal(id: string) {
    setPrincipal(id);
    persistir(id, conSecundaria ? secundaria : '');
  }

  function cambiarSecundaria(id: string) {
    setSecundaria(id);
    persistir(principal, id);
  }

  function alternarSecundaria(activo: boolean) {
    setConSecundaria(activo);
    setSecundaria('');
    if (!activo) persistir(principal, '');
  }

  async function crearPersona() {
    const nombre = nombreNueva.trim();
    if (!nombre) return;
    const persona = await repo.crearPersona({ nombre, aliases: [], contextos: [], archivada: false });
    onPersonaCreada(persona);
    setNombreNueva('');
    const destino = creandoPara;
    setCreandoPara(null);
    if (destino === 'principal') cambiarPrincipal(persona.id);
    else if (destino === 'secundaria') cambiarSecundaria(persona.id);
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-dashed border-[var(--border)] p-4">
      <p className="text-left text-sm opacity-80">{captura.textoCrudo}</p>

      <label className="flex flex-col gap-1 text-sm">
        <span className="opacity-70">¿De quién es esta nota?</span>
        {/* Sigue siendo un <select> nativo a propósito: la lista de personas
            crece sin techo y como chips se volvería inmanejable. */}
        <select
          className="toque-11 rounded border border-[var(--border)] bg-transparent px-2 md:max-w-xs"
          value={principal}
          onChange={e =>
            e.target.value === OPCION_NUEVA ? setCreandoPara('principal') : cambiarPrincipal(e.target.value)
          }
        >
          <option value="" disabled>
            elegir…
          </option>
          {personas.map(p => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
          <option value={OPCION_NUEVA}>+ nueva persona…</option>
        </select>
      </label>

      {creandoPara && (
        <div className="flex flex-col gap-2 text-sm">
          <input
            className="toque-11 rounded border border-[var(--border)] bg-transparent px-3 md:max-w-xs"
            placeholder="nombre"
            value={nombreNueva}
            onChange={e => setNombreNueva(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2 md:max-w-xs">
            <button
              type="button"
              className="toque-11 flex-1 rounded border border-[var(--border)] px-3"
              onClick={crearPersona}
            >
              crear
            </button>
            <button
              type="button"
              className="toque-11 px-3 opacity-60 hover:opacity-100"
              onClick={() => setCreandoPara(null)}
            >
              cancelar
            </button>
          </div>
        </div>
      )}

      <label className="flex toque-11 items-center gap-3 text-sm">
        <input
          type="checkbox"
          className="size-5 shrink-0 accent-[var(--accent)]"
          checked={conSecundaria}
          onChange={e => alternarSecundaria(e.target.checked)}
        />
        <span className="opacity-70">involucra a alguien más</span>
      </label>

      {conSecundaria && (
        <select
          className="toque-11 rounded border border-[var(--border)] bg-transparent px-2 text-sm md:max-w-xs"
          value={secundaria}
          onChange={e =>
            e.target.value === OPCION_NUEVA ? setCreandoPara('secundaria') : cambiarSecundaria(e.target.value)
          }
        >
          <option value="" disabled>
            elegir…
          </option>
          {personas
            .filter(p => p.id !== principal)
            .map(p => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          <option value={OPCION_NUEVA}>+ nueva persona…</option>
        </select>
      )}

      {guardando && <span className="text-xs opacity-50">guardando…</span>}
    </div>
  );
}
