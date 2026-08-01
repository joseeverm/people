/**
 * Pestaña "Guía de relación" del perfil de una persona.
 *
 * El perfil dice quién es; esta pestaña dice cómo tratarla. Se genera SIEMPRE a
 * mano (nunca al montar) y EXIGE un perfil previo: la guía razona sobre el
 * retrato ya construido, así que sin perfil el botón no se habilita y se dice
 * por qué.
 *
 * Los cinco bloques se muestran aunque vengan vacíos, y ahí está la gracia: un
 * bloque vacío no es un fallo de la generación, es el motor diciendo "no hay
 * material para esto todavía" (ver core/guia-relacion.ts). Cada bloque vacío
 * explica qué habría que observar para poder llenarlo.
 */
import { useCallback, useEffect, useState } from 'react';
import type {
  EstadoConocimiento,
  GuiaRelacion,
  PerfilGenerado,
  Persona,
  Senal,
} from '../../core/esquema';
import { generarGuia, progresionDeCapas } from '../../core/guia-relacion';
import { CASCADAS, ErrorLLM } from '../../core/llm';
import { repo } from '../../data/dexie-repo';
import { LeyendaEstatus, SeccionAfirmaciones } from './Afirmaciones';

/** Título, subtítulo y texto de vacío de cada bloque, en orden de lectura. */
const BLOQUES: {
  clave: keyof Pick<
    GuiaRelacion,
    'terrenoFertil' | 'terrenoMinado' | 'comoSeAbre' | 'queValoraEnLaGente' | 'siguientePaso'
  >;
  titulo: string;
  nota: string;
  vacio: string;
}[] = [
  {
    clave: 'terrenoFertil',
    titulo: 'Terreno fértil',
    nota: 'De qué habla con ganas, y por qué le interesa.',
    vacio:
      'Sin material todavía. Falta registrar de qué temas habla por iniciativa propia y cómo cambia su energía al hacerlo.',
  },
  {
    clave: 'terrenoMinado',
    titulo: 'Terreno minado',
    nota: 'Qué evitar, cómo notar que estás entrando ahí y cómo salir.',
    vacio:
      'Sin material todavía. Falta observar qué temas la ponen incómoda o defensiva, y con qué gesto o cambio de tono lo avisa.',
  },
  {
    clave: 'comoSeAbre',
    titulo: 'Cómo se abre',
    nota: 'Por qué vía y a qué ritmo se revela, según cuándo ganó profundidad la relación.',
    vacio:
      'Sin material todavía. Hace falta que la relación haya ganado profundidad en algún dominio (capa intermedia o central) para poder ver qué la produjo.',
  },
  {
    clave: 'queValoraEnLaGente',
    titulo: 'Qué valora en la gente',
    nota: 'Qué admira y qué desprecia en terceros.',
    vacio:
      'Sin material todavía. Falta registrar comentarios suyos sobre otras personas: a quién admira, de quién reniega y con qué argumento.',
  },
  {
    clave: 'siguientePaso',
    titulo: 'Siguiente paso',
    nota: 'Un movimiento concreto para la próxima conversación.',
    vacio:
      'Sin material todavía. Con más señales sobre los huecos del perfil se puede proponer un movimiento concreto.',
  },
];

function formatearFecha(iso: string): string {
  return new Date(iso).toLocaleDateString('es', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatearError(e: unknown): string {
  if (e instanceof ErrorLLM) return `${e.message} (status ${e.status})${e.detalle ? `\n${e.detalle}` : ''}`;
  return e instanceof Error ? e.message : String(e);
}

interface Props {
  persona: Persona;
  /** null = esta persona todavía no tiene perfil generado. */
  perfil: PerfilGenerado | null;
  estado: EstadoConocimiento;
  senales: Senal[];
}

export function PestanaGuia({ persona, perfil, estado, senales }: Props) {
  // undefined = todavía leyendo de Dexie; null = no hay ninguna guardada.
  const [guia, setGuia] = useState<GuiaRelacion | null | undefined>(undefined);
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setGuia(await repo.ultimaGuia(persona.id));
  }, [persona.id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // La guía queda "atrás" cuando hay señales posteriores a la última incluida.
  // No se regenera sola por eso: solo se avisa (generar cuesta una llamada al LLM).
  const senalesNuevas = guia
    ? senales.slice(senales.findIndex(s => s.id === guia.ultimaSenalIncluida) + 1).length
    : 0;

  async function generar() {
    if (!perfil || senales.length === 0) return;
    setError(null);
    setGenerando(true);
    try {
      // La progresión de capas se deriva AQUÍ, de las señales: es la entrada que
      // no existe ni en el perfil ni en el EstadoConocimiento (ambos guardan la
      // foto actual, no el camino) y sin ella "cómo se abre" no es derivable.
      const generada = await generarGuia({
        persona,
        perfil,
        estado,
        senales,
        progresion: progresionDeCapas(senales),
      });
      const nueva = await repo.guardarGuia({
        ...generada,
        personaId: persona.id,
        generadaEn: new Date().toISOString(),
        ultimaSenalIncluida: senales[senales.length - 1].id,
        modelo: CASCADAS.inferencia[0].modelo,
      });
      setGuia(nueva);
    } catch (e) {
      setError(formatearError(e));
    } finally {
      setGenerando(false);
    }
  }

  if (guia === undefined) {
    return <p className="text-sm opacity-70">Cargando…</p>;
  }

  const sinPerfil = !perfil;
  const sinSenales = senales.length === 0;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col items-stretch gap-2 sm:items-start">
        <button
          type="button"
          className="toque-12 rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-[var(--accent-texto)] disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
          onClick={generar}
          disabled={generando || sinPerfil || sinSenales}
        >
          {generando ? 'generando…' : guia ? 'Regenerar guía' : 'Generar guía'}
        </button>

        {/* El requisito del perfil se explica siempre que falte, no solo al
            pulsar: el botón deshabilitado sin motivo es una pared muda. */}
        {sinPerfil && (
          <p className="text-xs opacity-60">
            La guía se construye sobre el perfil. Genera primero el perfil de {persona.nombre} en la
            pestaña «Perfil» y vuelve aquí.
          </p>
        )}
        {!sinPerfil && sinSenales && (
          <p className="text-xs opacity-60">Todavía no hay señales registradas para esta persona.</p>
        )}
        {guia && (
          <p className="text-xs opacity-60">
            Generada el {formatearFecha(guia.generadaEn)}
            {senalesNuevas > 0 &&
              ` · hay ${senalesNuevas} señal${senalesNuevas === 1 ? '' : 'es'} posterior${
                senalesNuevas === 1 ? '' : 'es'
              } sin incluir`}
          </p>
        )}
      </div>

      {error && (
        <p className="whitespace-pre-wrap rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-sm text-red-500">
          {error}
        </p>
      )}

      {guia ? (
        <div className="flex flex-col gap-6">
          <LeyendaEstatus />
          {BLOQUES.map(b => (
            <SeccionAfirmaciones
              key={b.clave}
              titulo={b.titulo}
              nota={b.nota}
              vacio={b.vacio}
              afirmaciones={guia[b.clave]}
              senales={senales}
            />
          ))}
        </div>
      ) : (
        !generando &&
        !sinPerfil && (
          <p className="text-sm opacity-70">
            Genera la guía para ver en qué terreno moverte con {persona.nombre}, cómo se abre y qué
            hacer en la próxima conversación.
          </p>
        )
      )}
    </div>
  );
}
