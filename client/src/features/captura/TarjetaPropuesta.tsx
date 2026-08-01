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

/** 'valores_creencias' → 'valores creencias' para leerlo en un chip. */
function humanizar(slug: string): string {
  return slug.replace(/_/g, ' ');
}

/** Botón-chip tocable. `toque-11` mide 44px en móvil (el mínimo cómodo para el
 *  pulgar) y 32px en escritorio, donde 44px se ven enormes; ver index.css.
 *  Sustituye a los <select> nativos, incómodos en el celular. */
function Chip({
  activo,
  onClick,
  children,
}: {
  activo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={activo}
      onClick={onClick}
      className={`toque-11 rounded-full border px-3 text-sm transition ${
        activo
          ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
          : 'border-[var(--border)] opacity-70 hover:opacity-100'
      }`}
    >
      {children}
    </button>
  );
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
    <div className="flex flex-col gap-2">
      <span className="text-xs opacity-70">{etiqueta}</span>
      <div className="flex flex-wrap gap-2">
        {opciones.map(o => {
          const n = normalizar(o);
          return (
            <Chip key={n} activo={seleccionados.includes(n)} onClick={() => alternar(n)}>
              {n}
            </Chip>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <input
          className="toque-11 flex-1 rounded border border-[var(--border)] bg-transparent px-3 text-sm"
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
        <button
          type="button"
          className="toque-caja shrink-0 rounded border border-[var(--border)] text-lg"
          aria-label={`Agregar a ${etiqueta}`}
          onClick={agregarNuevo}
        >
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
    /* Móvil y tablet: una columna, se recorre de arriba abajo. A partir de lg
       la tarjeta se parte en dos — a la izquierda lo que describe la nota
       (texto, tipo, con quién, en qué situación) y a la derecha las etiquetas —
       porque en una sola columna ancha la tarjeta mide varias pantallas de alto
       y obliga a bajar hasta el fondo para confirmar. */
    <div className="flex flex-col gap-5 rounded-lg border border-[var(--border)] p-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-6">
      <div className="flex flex-col gap-5">
        <textarea
          className="min-h-24 w-full resize-none rounded border border-[var(--border)] bg-transparent p-3 text-base md:text-sm"
          value={contenido}
          onChange={e => setContenido(e.target.value)}
        />

        <span className="text-left text-xs opacity-70">{personasDeLaNota.map(p => p.nombre).join(', ')}</span>

        {pistasAclaracion.length > 0 && (
          <p className="text-xs text-amber-600">El clasificador pide revisar: {pistasAclaracion.join(', ')}.</p>
        )}

        <div className="flex flex-col gap-2">
          <span className="text-xs opacity-70">Tipo</span>
          <div className="flex flex-wrap gap-2">
            {Object.entries(NOMBRE_TIPO).map(([valor, nombre]) => (
              <Chip key={valor} activo={tipo === valor} onClick={() => setTipo(valor as TipoSenal)}>
                {nombre}
              </Chip>
            ))}
          </div>
        </div>

        {/* Apilados en móvil: dos columnas de chips en 375px son ilegibles.
            En lg vuelven a apilarse: ahí la tarjeta ya está partida en dos y
            estos selectores viven dentro de media tarjeta. */}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-1">
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
      </div>

      <div className="flex flex-col gap-3">
        <span className="text-xs opacity-70">Etiquetas</span>

        {/* Cada etiqueta puesta es un bloque propio: dominio + su capa como
            chips, en vez de un <select> diminuto dentro de una píldora. */}
        {etiquetas.map((e, i) => (
          <div
            key={`${e.dominio}-${i}`}
            className="flex flex-col gap-2 rounded-lg border border-[var(--border)] p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm capitalize">{humanizar(e.dominio)}</span>
              <button
                type="button"
                className="flex toque-caja shrink-0 items-center justify-center rounded-full text-lg opacity-60 hover:opacity-100"
                aria-label={`Quitar ${humanizar(e.dominio)}`}
                onClick={() => quitarEtiqueta(i)}
              >
                ×
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {CAPAS.map(c => (
                <Chip key={c} activo={e.capa === c} onClick={() => cambiarCapaEtiqueta(i, c)}>
                  {c}
                </Chip>
              ))}
            </div>
          </div>
        ))}

        <div className="flex flex-col gap-3 rounded-lg border border-dashed border-[var(--border)] p-3">
          <span className="text-xs opacity-70">Agregar etiqueta</span>
          <div className="flex flex-wrap gap-2">
            {DOMINIOS.map(d => (
              <Chip key={d} activo={nuevoDominio === d} onClick={() => setNuevoDominio(d)}>
                {humanizar(d)}
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {CAPAS.map(c => (
              <Chip key={c} activo={nuevaCapa === c} onClick={() => setNuevaCapa(c)}>
                {c}
              </Chip>
            ))}
          </div>
          <button
            type="button"
            className="toque-11 rounded-md border border-[var(--border)] px-3 text-sm"
            onClick={agregarEtiqueta}
          >
            + etiqueta
          </button>
        </div>
      </div>

      {/* Error y confirmación cruzan las dos columnas: cierran la tarjeta. */}
      {error && <p className="text-sm text-red-500 lg:col-span-2">{error}</p>}

      <button
        type="button"
        className="toque-12 w-full rounded-md bg-[var(--accent)] px-4 text-base font-medium text-white md:text-sm lg:col-span-2"
        onClick={confirmar}
      >
        Confirmar
      </button>
    </div>
  );
}
