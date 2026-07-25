/**
 * Una tarjeta = una CapturaPendiente con persona ya asignada y ya clasificada
 * (PropuestaSenal). El clasificador propone; el usuario ajusta si hace falta.
 * Contenido, tipo, compañía, situación y etiquetas SIEMPRE son editables (haya
 * o no aclaraciones) — pero si la propuesta ya viene completa, un solo toque
 * en "Confirmar" basta: no hay pasos obligatorios adicionales.
 */
import { useState } from 'react';
import type { Capa, CapturaPendiente, Dominio, EtiquetaDominio, Senal, TipoSenal } from '../../core/esquema';
import { CAPAS, COMPANIA_SUGERIDA, DOMINIOS, SITUACION_SUGERIDA } from '../../core/esquema';
import type { ConfirmacionUsuario, EntradaClasificacion, PropuestaSenal } from '../../core/clasificador';
import { materializarSenal } from '../../core/clasificador';

/** minúsculas + sin tildes + sin espacios sobrantes, para comparar sin crear duplicados.
 *  Defensivo: si el valor no es un string (undefined en datos legados, número suelto…),
 *  devuelve '' en vez de reventar al llamar .normalize() sobre undefined. */
function normalizar(s: unknown): string {
  if (typeof s !== 'string') return '';
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita diacriticos (tildes) tras la descomposicion NFD
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Normaliza una lista de valores y descarta duplicados y no-strings.
 *  Acepta undefined/null (datos legados sin el campo) tratándolos como lista vacía. */
function normalizarLista(valores: string[] | undefined | null): string[] {
  const vistos = new Set<string>();
  const resultado: string[] = [];
  for (const v of valores ?? []) {
    const n = normalizar(v);
    if (!n || vistos.has(n)) continue;
    vistos.add(n);
    resultado.push(n);
  }
  return resultado;
}

const NOMBRE_TIPO: Record<TipoSenal, string> = {
  observacion: 'observación',
  cita: 'cita',
  respuesta: 'respuesta',
  comportamiento: 'comportamiento',
  dato_conocido: 'dato conocido',
  verificacion: 'verificación',
};

/** Texto corto para el aviso "el clasificador pide revisar: …" — informativo,
 *  no gatilla ningún control (todos los campos ya son editables siempre). */
const PISTA_ACLARACION: Record<PropuestaSenal['aclaraciones'][number]['tipo'], string> = {
  elegir_compania: 'compañía',
  elegir_situacion: 'situación',
  confirmar_tipo: 'tipo de señal',
  revisar_etiquetas: 'etiquetas',
};

interface Props {
  captura: CapturaPendiente;
  entrada: EntradaClasificacion;
  propuesta: PropuestaSenal;
  /** Todas las señales ya guardadas, para sugerir valores de compañía/situación
   *  ya usados antes en vez de que el usuario los reescriba cada vez. */
  senales: Senal[];
  onConfirmar: (idLocal: string, senal: Omit<Senal, 'id'>) => void;
}

/** Selector de valores múltiples con vocabulario sugerido + ya usados + campo
 *  para agregar uno nuevo. Reutilizado para compañía y para situación. */
function SelectorMultiple({
  etiqueta,
  seleccionados,
  sugeridos,
  usados,
  onCambiar,
}: {
  etiqueta: string;
  seleccionados: string[];
  sugeridos: readonly string[];
  usados: string[];
  onCambiar: (valores: string[]) => void;
}) {
  const [nuevo, setNuevo] = useState('');

  const opciones = Array.from(new Set([...sugeridos, ...usados]));

  function alternar(valor: string) {
    const n = normalizar(valor);
    if (seleccionados.includes(n)) {
      onCambiar(seleccionados.filter(v => v !== n));
    } else {
      onCambiar([...seleccionados, n]);
    }
  }

  function agregarNuevo() {
    const n = normalizar(nuevo);
    if (!n) return;
    if (!seleccionados.includes(n)) onCambiar([...seleccionados, n]);
    setNuevo('');
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs opacity-70">{etiqueta}</span>
      <div className="flex flex-wrap gap-1">
        {opciones.map(o => {
          const n = normalizar(o);
          const activo = seleccionados.includes(n);
          return (
            <button
              key={n}
              type="button"
              onClick={() => alternar(n)}
              className={`rounded-full border px-2 py-0.5 text-xs ${
                activo
                  ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                  : 'border-[var(--border)] opacity-70 hover:opacity-100'
              }`}
            >
              {n}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-1">
        <input
          className="flex-1 rounded border border-[var(--border)] bg-transparent p-1 text-xs"
          value={nuevo}
          onChange={e => setNuevo(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              agregarNuevo();
            }
          }}
          placeholder="agregar otro…"
        />
        <button type="button" className="rounded border border-[var(--border)] px-2 py-1 text-xs" onClick={agregarNuevo}>
          +
        </button>
      </div>
    </div>
  );
}

export function TarjetaPropuesta({ captura, entrada, propuesta, senales, onConfirmar }: Props) {
  const [contenido, setContenido] = useState(propuesta.contenido);
  const [tipo, setTipo] = useState<TipoSenal>(propuesta.tipo);
  const [compania, setCompania] = useState<string[]>(normalizarLista(propuesta.compania));
  const [situacion, setSituacion] = useState<string[]>(normalizarLista(propuesta.situacion));
  const [etiquetas, setEtiquetas] = useState<EtiquetaDominio[]>(propuesta.etiquetas);
  const [nuevoDominio, setNuevoDominio] = useState<Dominio>(DOMINIOS[0]);
  const [nuevaCapa, setNuevaCapa] = useState<Capa>(CAPAS[0]);
  const [error, setError] = useState<string | null>(null);

  const personasDeLaNota = [entrada.persona, ...(entrada.personasSecundarias ?? [])];

  const companiaUsada = normalizarLista(senales.flatMap(s => s.compania ?? []));
  const situacionUsada = normalizarLista(senales.flatMap(s => s.situacion ?? []));

  const pistasAclaracion = propuesta.aclaraciones.map(a => PISTA_ACLARACION[a.tipo]);

  function agregarEtiqueta() {
    if (etiquetas.some(e => e.dominio === nuevoDominio && e.capa === nuevaCapa)) return;
    setEtiquetas(prev => [...prev, { dominio: nuevoDominio, capa: nuevaCapa }]);
  }

  function quitarEtiqueta(i: number) {
    setEtiquetas(prev => prev.filter((_, idx) => idx !== i));
  }

  function cambiarCapaEtiqueta(i: number, capa: Capa) {
    setEtiquetas(prev => prev.map((e, idx) => (idx === i ? { ...e, capa } : e)));
  }

  async function confirmar() {
    setError(null);
    const confirmacion: ConfirmacionUsuario = {
      compania: normalizarLista(compania),
      situacion: normalizarLista(situacion),
      tipo,
      etiquetas,
      contenido,
      fecha: new Date().toISOString(),
    };
    try {
      const senal = materializarSenal(entrada, confirmacion);
      onConfirmar(captura.idLocal, senal);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo confirmar la señal.');
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[var(--border)] p-4">
      <textarea
        className="w-full resize-none rounded border border-[var(--border)] bg-transparent p-2 text-sm"
        value={contenido}
        onChange={e => setContenido(e.target.value)}
        rows={2}
      />

      <span className="text-left text-xs opacity-70">{personasDeLaNota.map(p => p.nombre).join(', ')}</span>

      {pistasAclaracion.length > 0 && (
        <p className="text-xs text-amber-600">El clasificador pide revisar: {pistasAclaracion.join(', ')}.</p>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span className="opacity-70">Tipo</span>
        <select
          className="rounded border border-[var(--border)] bg-transparent p-2"
          value={tipo}
          onChange={e => setTipo(e.target.value as TipoSenal)}
        >
          {Object.entries(NOMBRE_TIPO).map(([valor, nombre]) => (
            <option key={valor} value={valor}>
              {nombre}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <SelectorMultiple
          etiqueta="¿Con quién?"
          seleccionados={compania}
          sugeridos={COMPANIA_SUGERIDA}
          usados={companiaUsada}
          onCambiar={setCompania}
        />
        <SelectorMultiple
          etiqueta="¿En qué situación?"
          seleccionados={situacion}
          sugeridos={SITUACION_SUGERIDA}
          usados={situacionUsada}
          onCambiar={setSituacion}
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs opacity-70">Etiquetas</span>

        <div className="flex flex-wrap gap-1">
          {etiquetas.map((e, i) => (
            <span
              key={`${e.dominio}-${i}`}
              className="flex items-center gap-1 rounded-full border border-[var(--border)] py-0.5 pl-2 pr-1 text-xs"
            >
              {e.dominio}/
              <select
                className="rounded bg-transparent"
                value={e.capa}
                onChange={ev => cambiarCapaEtiqueta(i, ev.target.value as Capa)}
              >
                {CAPAS.map(c => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <button type="button" className="opacity-60 hover:opacity-100" onClick={() => quitarEtiqueta(i)}>
                ×
              </button>
            </span>
          ))}
        </div>

        <div className="flex items-center gap-2 text-xs">
          <select
            className="rounded border border-[var(--border)] bg-transparent p-1"
            value={nuevoDominio}
            onChange={e => setNuevoDominio(e.target.value as Dominio)}
          >
            {DOMINIOS.map(d => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <select
            className="rounded border border-[var(--border)] bg-transparent p-1"
            value={nuevaCapa}
            onChange={e => setNuevaCapa(e.target.value as Capa)}
          >
            {CAPAS.map(c => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button type="button" className="rounded border border-[var(--border)] px-2 py-1" onClick={agregarEtiqueta}>
            + etiqueta
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <button
        type="button"
        className="self-start rounded-md bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white"
        onClick={confirmar}
      >
        Confirmar
      </button>
    </div>
  );
}
