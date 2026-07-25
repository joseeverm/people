/**
 * Lógica compartida para resolver una predicción, reutilizada por la pestaña
 * del perfil y por la vista global de pendientes.
 *
 * Resolver = registrar qué pasó realmente. Eso crea una Senal de tipo
 * 'verificacion' (la de mayor peso del sistema, ver PESO_TIPO) que es la
 * evidencia inmutable de la resolución, y marca la predicción con su estado
 * final. Ambas cosas ocurren de forma atómica en el repo, que además impide
 * resolver dos veces la misma predicción (invariante).
 */
import type { Prediccion, TipoPrediccion, Senal } from '../../core/esquema';
import type { Repository } from '../../data/repository';

export type EstadoResolucion = Extract<Prediccion['estado'], 'acertada' | 'parcial' | 'fallida'>;

export const ETIQUETA_ESTADO: Record<EstadoResolucion, string> = {
  acertada: 'acertó',
  parcial: 'parcial',
  fallida: 'falló',
};

/** Etiqueta corta del tipo de predicción (para badges). */
export const ETIQUETA_TIPO: Record<TipoPrediccion, string> = {
  inferida: 'síntesis',
  extrapolada: 'a prueba',
};

/** Título y subtítulo de cada sección de la vista de predicciones. */
export const SECCION_TIPO: Record<TipoPrediccion, { titulo: string; nota: string }> = {
  inferida: {
    titulo: 'Se sigue de lo que sabes',
    nota: 'Síntesis de las señales — no cuentan para la calibración.',
  },
  extrapolada: {
    titulo: 'Puestas a prueba',
    nota: 'Extienden un patrón a algo no observado — solo estas calibran el modelo.',
  },
};

/**
 * Capa por defecto de la etiqueta de dominio de la señal de verificación.
 * La predicción solo lleva `dominio` (no capa); una verificación es evidencia
 * conductual fuerte pero no asumimos que toque el núcleo íntimo del tema, así
 * que la ubicamos en la capa 'intermedia' (neutral). El peso alto lo aporta el
 * tipo 'verificacion', no la capa.
 */
const CAPA_VERIFICACION = 'intermedia' as const;

/** Construye (sin persistir) la señal de verificación que resuelve una predicción. */
export function construirSenalVerificacion(prediccion: Prediccion, textoQuePaso: string): Omit<Senal, 'id'> {
  const ahora = new Date().toISOString();
  return {
    personaIds: [prediccion.personaId],
    fecha: ahora,
    registradaEn: ahora,
    tipo: 'verificacion',
    contenido: textoQuePaso,
    etiquetas: [{ dominio: prediccion.dominio, capa: CAPA_VERIFICACION }],
    prediccionId: prediccion.id,
  };
}

/**
 * Resuelve la predicción: crea la señal de verificación y marca el estado, de
 * forma atómica. Devuelve la señal creada. Lanza si `textoQuePaso` viene vacío
 * (la verificación necesita su evidencia) o si la predicción ya estaba resuelta.
 */
export async function resolverPrediccion(
  repo: Repository,
  prediccion: Prediccion,
  estado: EstadoResolucion,
  textoQuePaso: string
): Promise<Senal> {
  const texto = textoQuePaso.trim();
  if (!texto) throw new Error('Describe qué pasó: es la evidencia de la verificación.');
  const senal = construirSenalVerificacion(prediccion, texto);
  return repo.resolverPrediccionConVerificacion(prediccion.id, estado, senal);
}
