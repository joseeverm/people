/**
 * Paso 4 del MVP: vista de perfil de una persona.
 * Al montar, carga el último snapshot guardado (repository.ultimoPerfil) y lo
 * muestra al instante — NUNCA llama al LLM automáticamente. La regeneración
 * es siempre una acción manual del usuario (botón).
 *
 * Invariantes respetados aquí (ver CLAUDE.md):
 *  - Los perfiles nunca se editan a mano: solo se leen y se regeneran.
 *  - Cada regeneración crea un snapshot nuevo (repo.guardarPerfil hace `add`,
 *    nunca `put` sobre un id existente).
 *  - validarEvidencia() corre siempre antes de persistir; si rechaza el
 *    perfil (afirmación sin evidencia real), se descarta y se reintenta una
 *    vez automáticamente (generarPerfilConReintento).
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { EstadoConocimiento, Persona, PerfilGenerado, Senal, Prediccion } from '../../core/esquema';
import { NOMBRE_NIVEL } from '../../core/esquema';
import { calcularEstadoConocimiento } from '../../core/conocimiento';
import { generarPerfil } from '../../core/motor-inferencia';
import type { EntradaInferencia } from '../../core/motor-inferencia';
import { ErrorLLM, CASCADAS } from '../../core/llm';
import { repo } from '../../data/dexie-repo';
import { LeyendaEstatus, SeccionAfirmaciones } from './Afirmaciones';
import { SeccionContradicciones } from './Contradicciones';
import { SeccionMarcoSocial } from './MarcoSocial';
import { SeccionHuecos } from './Huecos';
import { VistaSenales } from './VistaSenales';
import { PestanaPredicciones } from '../predicciones/PestanaPredicciones';

type Pestana = 'perfil' | 'senales' | 'predicciones';

/** Texto del indicador de calibración junto al nivel. */
function textoCalibracion(estado: EstadoConocimiento): string {
  if (estado.tasaAcierto === null) {
    const faltan = Math.max(0, 3 - estado.prediccionesResueltas);
    return faltan > 0
      ? `Calibración: faltan ${faltan} verificación${faltan === 1 ? '' : 'es'} para calibrar`
      : 'Calibración: aún sin datos suficientes';
  }
  return `Acierto ${Math.round(estado.tasaAcierto * 100)}% (${estado.prediccionesResueltas} resueltas)`;
}

function formatearFecha(iso: string): string {
  return new Date(iso).toLocaleDateString('es', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatearError(e: unknown): string {
  if (e instanceof ErrorLLM) return `${e.message} (status ${e.status})${e.detalle ? `\n${e.detalle}` : ''}`;
  return e instanceof Error ? e.message : String(e);
}

/** Invariante: si validarEvidencia() rechaza el perfil, se descarta y se reintenta una vez. */
async function generarPerfilConReintento(entrada: EntradaInferencia) {
  try {
    return await generarPerfil(entrada);
  } catch (e) {
    if (e instanceof ErrorLLM) throw e; // fallo de red/API: no tiene sentido reintentar solo
    return await generarPerfil(entrada); // rechazo de validarEvidencia: un reintento
  }
}

export function VistaPerfil() {
  const { id } = useParams<{ id: string }>();
  // undefined = cargando; null = no existe.
  const [persona, setPersona] = useState<Persona | null | undefined>(undefined);
  const [senales, setSenales] = useState<Senal[]>([]);
  const [predicciones, setPredicciones] = useState<Prediccion[]>([]);
  const [perfil, setPerfil] = useState<PerfilGenerado | null>(null);
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pestana, setPestana] = useState<Pestana>('perfil');

  useEffect(() => {
    if (!id) return;
    setPersona(undefined);
    (async () => {
      const [personas, todasSenales, todasPredicciones, ultimoPerfil] = await Promise.all([
        repo.listarPersonas(),
        repo.senalesDe(id),
        repo.prediccionesDe(id),
        repo.ultimoPerfil(id),
      ]);
      setPersona(personas.find(p => p.id === id) ?? null);
      setSenales(todasSenales);
      setPredicciones(todasPredicciones);
      setPerfil(ultimoPerfil);
    })();
  }, [id]);

  /** Recarga señales + predicciones tras resolver/crear una predicción, sin
   *  parpadear "Cargando" (no toca `persona`). Recalcula el estado (calibración). */
  async function recargarPredicciones() {
    if (!id) return;
    const [todasSenales, todasPredicciones] = await Promise.all([
      repo.senalesDe(id),
      repo.prediccionesDe(id),
    ]);
    setSenales(todasSenales);
    setPredicciones(todasPredicciones);
  }

  const estado: EstadoConocimiento | null = persona
    ? calcularEstadoConocimiento(persona.id, senales, predicciones)
    : null;

  const senalesNuevas = perfil
    ? senales.slice(senales.findIndex(s => s.id === perfil.ultimaSenalIncluida) + 1)
    : senales;
  const sinSenalesNuevas = !!perfil && senalesNuevas.length === 0;

  async function regenerar() {
    if (!persona || !estado || senales.length === 0) return;
    setError(null);
    setGenerando(true);
    try {
      const entrada: EntradaInferencia = {
        persona,
        senales: perfil ? senalesNuevas : senales,
        estado,
        predicciones,
        perfilPrevio: perfil ?? undefined,
      };
      const resultado = await generarPerfilConReintento(entrada);
      const nuevo = await repo.guardarPerfil({
        ...resultado,
        personaId: persona.id,
        generadoEn: new Date().toISOString(),
        ultimaSenalIncluida: senales[senales.length - 1].id,
        numSenales: senales.length,
        modelo: CASCADAS.inferencia[0].modelo,
      });
      for (const propuesta of resultado.prediccionesPropuestas) {
        await repo.guardarPrediccion({ ...propuesta, personaId: persona.id, estado: 'pendiente' });
      }
      setPerfil(nuevo);
      // Las predicciones recién persistidas no están en el estado local: recárgalas
      // para que aparezcan en la pestaña de predicciones sin refrescar la página.
      await recargarPredicciones();
    } catch (e) {
      setError(formatearError(e));
    } finally {
      setGenerando(false);
    }
  }

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
    // Más ancha que el resto: la pestaña "Perfil" se reparte en dos columnas
    // a partir de lg (afirmaciones | hallazgos y huecos).
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 p-4 sm:p-6 md:max-w-3xl lg:max-w-4xl">
      <Link
        to={`/personas/${persona.id}`}
        className="flex toque-11 items-center text-sm opacity-70 hover:opacity-100"
      >
        ← {persona.nombre}
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-medium">Perfil de {persona.nombre}</h1>
        {estado && (
          <p className="flex flex-wrap items-center gap-x-2 text-sm opacity-70">
            <span>
              Nivel {estado.nivel} · {NOMBRE_NIVEL[estado.nivel]}
            </span>
            <span aria-hidden>·</span>
            <span className={estado.tasaAcierto === null ? 'italic opacity-70' : ''}>
              {textoCalibracion(estado)}
            </span>
          </p>
        )}
        <p className="text-xs opacity-60">
          {perfil
            ? `Generado el ${formatearFecha(perfil.generadoEn)}, sobre ${perfil.numSenales} señales`
            : 'Sin perfil generado todavía.'}
        </p>
      </div>

      {/* Cada pestaña ocupa un tercio del ancho en móvil (objetivo táctil ancho
          y de 48px de alto). La cuenta va en su propia línea: "Predicciones (3)"
          en una sola no entra a 375px sin encoger la letra. */}
      <div className="flex border-b border-[var(--border)]">
        {(
          [
            { id: 'perfil', titulo: 'Perfil', cuenta: null },
            { id: 'senales', titulo: 'Señales', cuenta: senales.length },
            {
              id: 'predicciones',
              titulo: 'Predicciones',
              cuenta: predicciones.filter(pr => pr.estado === 'pendiente').length,
            },
          ] as const
        ).map(({ id, titulo, cuenta }) => (
          <button
            key={id}
            type="button"
            aria-pressed={pestana === id}
            className={`flex toque-12 flex-1 flex-col items-center justify-center gap-0.5 px-2 text-sm sm:flex-none sm:flex-row sm:gap-1.5 sm:px-4 ${
              pestana === id
                ? 'border-b-2 border-[var(--accent)] font-medium'
                : 'opacity-60 hover:opacity-100'
            }`}
            onClick={() => setPestana(id)}
          >
            <span>{titulo}</span>
            {cuenta !== null && <span className="text-xs opacity-70">({cuenta})</span>}
          </button>
        ))}
      </div>

      {pestana === 'senales' ? (
        <VistaSenales senales={senales} />
      ) : pestana === 'predicciones' ? (
        <PestanaPredicciones
          personaId={persona.id}
          predicciones={predicciones}
          senales={senales}
          onCambio={recargarPredicciones}
        />
      ) : (
        <>
          {error && (
            <p className="whitespace-pre-wrap rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-sm text-red-500">
              {error}
            </p>
          )}

          <div className="flex flex-col items-stretch gap-2 sm:items-start">
            <button
              type="button"
              className="toque-12 rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
              onClick={regenerar}
              disabled={generando || senales.length === 0 || sinSenalesNuevas}
            >
              {generando ? 'generando…' : perfil ? 'Regenerar perfil' : 'Generar perfil'}
            </button>
            {senales.length === 0 && (
              <p className="text-xs opacity-60">Todavía no hay señales registradas para esta persona.</p>
            )}
            {sinSenalesNuevas && senales.length > 0 && (
              <p className="text-xs opacity-60">No hay señales nuevas desde el último perfil.</p>
            )}
          </div>

          {perfil ? (
            <div className="flex flex-col gap-6">
              {/* El resumen cruza el ancho entero: es el encabezado del perfil. */}
              <p className="rounded-lg border border-[var(--accent-border)] bg-[var(--accent-bg)] p-4 text-sm">
                {perfil.resumen}
              </p>

              {/* En escritorio ancho, dos columnas con una división que ya
                  existía en el contenido: a la izquierda lo que la persona ES
                  (afirmaciones por categoría), a la derecha lo que hay que
                  MIRAR (contradicciones, marco social, huecos por llenar).
                  `items-start` para que cada columna mida lo suyo y no se
                  estiren a la altura de la más larga. */}
              <div className="flex flex-col gap-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-8">
                <div className="flex flex-col gap-6">
                  <LeyendaEstatus />

                  <SeccionAfirmaciones titulo="Rasgos" afirmaciones={perfil.rasgos} senales={senales} />
                  <SeccionAfirmaciones titulo="Gustos" afirmaciones={perfil.gustos} senales={senales} />
                  <SeccionAfirmaciones titulo="Disgustos" afirmaciones={perfil.disgustos} senales={senales} />
                  <SeccionAfirmaciones titulo="Motivaciones" afirmaciones={perfil.motivaciones} senales={senales} />
                  <SeccionAfirmaciones
                    titulo="Temas sensibles"
                    afirmaciones={perfil.temasSensibles}
                    senales={senales}
                  />
                </div>

                <div className="flex flex-col gap-6">
                  <SeccionContradicciones contradicciones={perfil.contradicciones} senales={senales} />
                  <SeccionMarcoSocial porMarcoSocial={perfil.porMarcoSocial} />
                  <SeccionHuecos huecos={perfil.huecos} />
                </div>
              </div>
            </div>
          ) : (
            !generando && (
              <p className="text-sm opacity-70">
                Genera el primer perfil para ver rasgos, gustos, disgustos, motivaciones y temas sensibles.
              </p>
            )
          )}
        </>
      )}
    </div>
  );
}
