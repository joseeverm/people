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
import { capaChip, capaMarcas, familiaChip, NOMBRE_CAPA } from '../../ui/semantica';

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

/**
 * VOCABULARIO DE CHIPS — tres estados, tres tratamientos.
 *
 * La regla que lo ordena todo: **el relleno de acento significa "esto ya forma
 * parte de la señal", y nada más.** Antes lo compartían el valor aplicado y el
 * meramente enfocado en el formulario de "agregar etiqueta", así que un dominio
 * que todavía no habías añadido se veía idéntico a uno ya puesto.
 *
 *  - APLICADO       relleno de acento + texto de alto contraste + ×. Está dentro.
 *  - BORRADOR       contorno discontinuo + fondo teñido. Elegido en el formulario,
 *                   todavía fuera de la señal hasta pulsar «+ etiqueta».
 *  - DISPONIBLE     solo contorno, apagado. Se puede añadir; al pasar el cursor
 *                   sube de opacidad y marca el borde, nunca acento.
 *
 * Todos miden `toque-11`: 44px en móvil (el mínimo cómodo para el pulgar) y
 * 32px en escritorio, donde 44px se ven enormes (ver index.css).
 */

/** Clases del estado apagado. Compartidas por los chips que se pueden añadir y
 *  por las opciones no elegidas de una selección única. */
const CHIP_DISPONIBLE =
  'border-[var(--border)] text-[var(--text)] opacity-70 hover:border-[var(--text)] hover:bg-[var(--social-bg)] hover:opacity-100';

const CHIP_BASE = 'toque-11 rounded-full border px-3 text-sm transition';

/** Ya forma parte de la señal. Todo el chip es el botón de quitar: el × es la
 *  pista visual, pero el objetivo táctil es el chip entero. */
function ChipAplicado({
  nombre,
  onQuitar,
  children,
}: {
  /** Para el aria-label — el texto visible puede llevar formato. */
  nombre: string;
  onQuitar: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onQuitar}
      aria-label={`Quitar ${nombre}`}
      className={`${CHIP_BASE} flex items-center gap-1.5 border-[var(--accent)] bg-[var(--accent)] font-medium text-[var(--accent-texto)] hover:opacity-85`}
    >
      {children}
      <span aria-hidden className="text-base leading-none opacity-70">
        ×
      </span>
    </button>
  );
}

/** Selección única donde la opción activa SÍ está aplicada (el tipo de la
 *  señal, la capa de una etiqueta ya puesta): no se puede quitar, solo cambiar
 *  por otra, así que va rellena pero sin ×. */
function ChipSeleccionUnica({
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
      className={`${CHIP_BASE} ${
        activo
          ? 'border-[var(--accent)] bg-[var(--accent)] font-medium text-[var(--accent-texto)]'
          : CHIP_DISPONIBLE
      }`}
    >
      {children}
    </button>
  );
}

/** Elección dentro del formulario de "agregar": todavía NO está aplicada.
 *  Contorno discontinuo y fondo teñido — reconocible como elegido, pero
 *  claramente distinto de un chip que ya forma parte de la señal. */
function ChipBorrador({
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
      className={`${CHIP_BASE} ${
        activo
          ? 'border-dashed border-[var(--accent)] bg-[var(--accent-bg)] font-medium text-[var(--accent)]'
          : CHIP_DISPONIBLE
      }`}
    >
      {children}
    </button>
  );
}

/** Se puede añadir. Un toque lo mueve a la zona de aplicados. */
function ChipDisponible({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`${CHIP_BASE} ${CHIP_DISPONIBLE}`}>
      + {children}
    </button>
  );
}

/** Rótulo de zona. Lo que separa "esto ya está puesto" de "esto se puede poner". */
function RotuloZona({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium uppercase tracking-wide opacity-50">{children}</span>
  );
}

/** Línea que parte las dos zonas de un selector. */
function SeparadorZona() {
  return <div className="border-t border-dashed border-[var(--border)]" />;
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

/**
 * Una DECISIÓN de la clasificación: tipo, con quién, en qué situación,
 * etiquetas. Cada una es un bloque cerrado —número, título, descripción corta,
 * fondo y borde propios— en vez de otro apartado de un formulario continuo.
 *
 * Existe porque las cuatro se leían como una sola pared de chips: al recorrer
 * la tarjeta no había forma de ver dónde terminaba una decisión y empezaba la
 * siguiente. El número y el título son lo que permite saltar directamente a la
 * que interesa revisar cuando el clasificador pide confirmar solo una.
 */
function Bloque({
  n,
  titulo,
  descripcion,
  children,
}: {
  n: number;
  titulo: string;
  descripcion: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--social-bg)] p-4">
      <div className="flex items-baseline gap-2">
        <span
          aria-hidden
          className="flex size-5 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg)] text-[11px] font-medium tabular-nums opacity-70"
        >
          {n}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="text-sm font-medium text-[var(--certeza-alta)]">{titulo}</h3>
          <p className="text-xs opacity-55">{descripcion}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

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

  // Se normaliza ANTES de deduplicar: si no, "Solo conmigo" y "solo_conmigo"
  // sobreviven las dos al Set y aparecen como dos opciones que hacen lo mismo.
  const opciones = normalizarLista([...sugeridos, ...usados]);
  // Lo aplicado sale de la lista de abajo: un chip está en una zona o en la
  // otra, nunca en las dos. Es lo que hace la separación legible de un vistazo.
  const disponibles = opciones.filter(o => !seleccionados.includes(o));

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
    <div className="flex flex-col gap-3">
      {/* ---- Zona 1: lo que ya forma parte de la señal ---- */}
      <div className="flex flex-col gap-1.5">
        <RotuloZona>En esta señal</RotuloZona>
        {seleccionados.length === 0 ? (
          <p className="text-xs italic opacity-40">nada todavía — toca una opción de abajo</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {seleccionados.map(v => (
              <ChipAplicado key={v} nombre={v} onQuitar={() => alternar(v)}>
                {v}
              </ChipAplicado>
            ))}
          </div>
        )}
      </div>

      <SeparadorZona />

      {/* ---- Zona 2: lo que se puede añadir ---- */}
      <div className="flex flex-col gap-1.5">
        <RotuloZona>Agregar</RotuloZona>
        {disponibles.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {disponibles.map(o => (
              <ChipDisponible key={o} onClick={() => alternar(o)}>
                {o}
              </ChipDisponible>
            ))}
          </div>
        )}
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
            placeholder="otro…"
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

  // El borrador ya existe arriba. Antes «+ etiqueta» simplemente no hacía nada
  // y parecía que el botón estaba roto; ahora se deshabilita y se dice por qué.
  const etiquetaYaPuesta = etiquetas.some(
    e => e.dominio === nuevoDominio && e.capa === nuevaCapa
  );

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
    <div className="flex flex-col gap-6 rounded-lg border border-[var(--border)] p-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-6">
      <div className="flex flex-col gap-6">
        <textarea
          className="min-h-24 w-full resize-none rounded border border-[var(--border)] bg-transparent p-3 text-base md:text-sm"
          value={contenido}
          onChange={e => setContenido(e.target.value)}
        />

        <span className="text-left text-xs opacity-70">{personasDeLaNota.map(p => p.nombre).join(', ')}</span>

        {pistasAclaracion.length > 0 && (
          <p className="text-xs text-[var(--aviso)]">El clasificador pide revisar: {pistasAclaracion.join(', ')}.</p>
        )}

        {/* El tipo es selección única y SIEMPRE hay uno aplicado: relleno de
            acento para el vigente, contorno apagado para el resto. No lleva ×
            porque no se puede quitar, solo cambiar por otro. */}
        <Bloque n={1} titulo="Tipo de señal" descripcion="Qué clase de observación es. Pesa en el perfil.">
          <div className="flex flex-wrap gap-2">
            {Object.entries(NOMBRE_TIPO).map(([valor, nombre]) => (
              <ChipSeleccionUnica
                key={valor}
                activo={tipo === valor}
                onClick={() => setTipo(valor as TipoSenal)}
              >
                {nombre}
              </ChipSeleccionUnica>
            ))}
          </div>
        </Bloque>

        {/* Apilados en móvil: dos columnas de chips en 375px son ilegibles.
            En lg vuelven a apilarse: ahí la tarjeta ya está partida en dos y
            estos selectores viven dentro de media tarjeta. */}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-1">
          <Bloque n={2} titulo="¿Con quién?" descripcion="Ante quién ocurrió. Puede quedar vacío.">
            <SelectorMultiple
              etiqueta="¿Con quién?"
              seleccionados={compania}
              sugeridos={COMPANIA_SUGERIDA}
              usados={companiaUsada}
              onCambiar={setCompania}
            />
          </Bloque>
          <Bloque n={3} titulo="¿En qué situación?" descripcion="Bajo qué marco. También puede quedar vacío.">
            <SelectorMultiple
              etiqueta="¿En qué situación?"
              seleccionados={situacion}
              sugeridos={SITUACION_SUGERIDA}
              usados={situacionUsada}
              onCambiar={setSituacion}
            />
          </Bloque>
        </div>
      </div>

      <Bloque
        n={4}
        titulo="Etiquetas"
        descripcion="Qué dominios toca y a qué profundidad. Es lo que mueve el nivel."
      >
        {/* ---- Zona 1: las etiquetas que ya lleva la señal ---- */}
        <div className="flex flex-col gap-2">
          <RotuloZona>En esta señal</RotuloZona>
          {etiquetas.length === 0 ? (
            <p className="text-xs italic opacity-40">ninguna todavía — arma una abajo</p>
          ) : (
            // Cada etiqueta puesta es un bloque propio: dominio + su capa como
            // chips, en vez de un <select> diminuto dentro de una píldora. El
            // fondo de acento del bloque repite el mensaje de sus chips: esto
            // ya está dentro.
            etiquetas.map((e, i) => (
              <div
                key={`${e.dominio}-${i}`}
                className="flex flex-col gap-2 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-bg)] p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  {/* El dominio se tiñe por FAMILIA y la capa lleva su marca en
                      la rampa de profundidad: son datos, y se leen en la misma
                      paleta que la vista de señales y el radar. Los chips de
                      abajo siguen en morado porque ahí sí son un control. */}
                  <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span {...familiaChip(e.dominio)}>{humanizar(e.dominio)}</span>
                    <span {...capaChip(e.capa)}>
                      <span aria-hidden>{capaMarcas(e.capa)}</span> {NOMBRE_CAPA[e.capa]}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="flex toque-caja shrink-0 items-center justify-center rounded-full text-lg opacity-60 hover:bg-[var(--bg)] hover:opacity-100"
                    aria-label={`Quitar ${humanizar(e.dominio)}`}
                    onClick={() => quitarEtiqueta(i)}
                  >
                    ×
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {CAPAS.map(c => (
                    <ChipSeleccionUnica
                      key={c}
                      activo={e.capa === c}
                      onClick={() => cambiarCapaEtiqueta(i, c)}
                    >
                      {c}
                    </ChipSeleccionUnica>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        <SeparadorZona />

        {/* ---- Zona 2: armar una etiqueta nueva ----
            Todo lo de aquí dentro es BORRADOR hasta pulsar «+ etiqueta»: por
            eso el dominio y la capa elegidos van con contorno discontinuo y no
            con el relleno de acento de los de arriba. */}
        <div className="flex flex-col gap-3 rounded-lg border border-dashed border-[var(--border)] p-3">
          <div className="flex flex-col gap-0.5">
            <RotuloZona>Agregar etiqueta</RotuloZona>
            <span className="text-xs opacity-55">
              Elige dominio y capa, y confirma con «+ etiqueta».
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {DOMINIOS.map(d => (
              <ChipBorrador key={d} activo={nuevoDominio === d} onClick={() => setNuevoDominio(d)}>
                {humanizar(d)}
              </ChipBorrador>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {CAPAS.map(c => (
              <ChipBorrador key={c} activo={nuevaCapa === c} onClick={() => setNuevaCapa(c)}>
                {c}
              </ChipBorrador>
            ))}
          </div>
          {/* rounded-md y no rounded-full: es un botón de acción, no un chip.
              La forma ya lo separa del vocabulario de chips de alrededor. */}
          <button
            type="button"
            className="toque-11 self-start rounded-md border border-[var(--accent-border)] px-3 text-sm font-medium text-[var(--accent)] transition hover:bg-[var(--accent-bg)] disabled:cursor-not-allowed disabled:border-[var(--border)] disabled:text-[var(--text)] disabled:opacity-40"
            onClick={agregarEtiqueta}
            disabled={etiquetaYaPuesta}
          >
            + etiqueta
          </button>
          {etiquetaYaPuesta && (
            <span className="text-xs opacity-55">
              Esa combinación ya está arriba. Cambia el dominio o la capa.
            </span>
          )}
        </div>
      </Bloque>

      {/* Error y confirmación cruzan las dos columnas: cierran la tarjeta. */}
      {error && <p className="text-sm text-[var(--error)] lg:col-span-2">{error}</p>}

      <button
        type="button"
        className="toque-12 w-full rounded-md bg-[var(--accent)] px-4 text-base font-medium text-[var(--accent-texto)] md:text-sm lg:col-span-2"
        onClick={confirmar}
      >
        Confirmar
      </button>
    </div>
  );
}
