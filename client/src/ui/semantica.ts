/**
 * PALETA SEMÁNTICA — traducción de "qué significa" a "cómo se pinta".
 *
 * Único sitio donde un eje de datos se convierte en clases. Los componentes
 * piden `CERTEZA[a.estatus]` o `capaChip(capa)`; no escriben colores. Los
 * valores viven en index.css (variables CSS, un juego por tema); aquí solo se
 * componen las clases que los usan.
 *
 * DOS REGLAS QUE NO SE AFLOJAN
 *
 * 1. El acento (morado) es de INTERACCIÓN: botón, chip aplicado, pestaña
 *    activa, foco. Nada de aquí lo usa. Si un dato se pintara de morado, el
 *    morado dejaría de significar "esto responde al toque".
 *
 * 2. El color NUNCA va solo. Cada eje trae además forma, icono o texto, y por
 *    eso cada entrada de abajo lleva `icono`/`nombre` junto a las clases: no
 *    son un extra decorativo, son el portador de significado para quien no
 *    distingue estos tonos (o mira la pantalla al sol).
 */
import type { CSSProperties } from 'react';
import type { Afirmacion, Capa, Dominio, Familia } from '../core/esquema';
import { CAPA_VALOR, FAMILIA_DOMINIO } from '../core/esquema';

// ---------------------------------------------------------------------------
// 1. Certeza epistémica — gradiente, no tres categorías
// ---------------------------------------------------------------------------

type Estatus = Afirmacion['estatus'];

/**
 * Escala de firmeza. Lo que la codifica es la FORMA: círculo lleno → medio →
 * vacío, y borde sólido → sólido tenue → PUNTEADO. El color solo acompaña
 * (una rampa de tinta, sin tinte propio) para no añadir un sexto tono a una
 * interfaz que ya distingue capas, predicciones, contradicciones y familias.
 */
export const CERTEZA: Record<
  Estatus,
  { icono: string; nombre: string; texto: string; borde: string; punto: string }
> = {
  hecho: {
    icono: '●',
    nombre: 'hecho',
    texto: 'text-[var(--certeza-alta)]',
    borde: 'border-[var(--certeza-media)]',
    punto: 'text-[var(--certeza-alta)]',
  },
  inferencia: {
    icono: '◐',
    nombre: 'inferencia',
    texto: 'text-[var(--certeza-media)]',
    borde: 'border-[var(--border)]',
    punto: 'text-[var(--certeza-media)]',
  },
  especulacion: {
    icono: '○',
    nombre: 'especulación',
    // Punteado: es la única de las tres que se reconoce sin ver el color ni
    // el icono, con solo mirar el contorno de la tarjeta de reojo.
    borde: 'border-dashed border-[var(--certeza-baja)]',
    texto: 'text-[var(--certeza-baja)]',
    punto: 'text-[var(--certeza-baja)]',
  },
};

// ---------------------------------------------------------------------------
// 2. Capas — un tono, intensidad creciente (están ordenadas)
// ---------------------------------------------------------------------------

const CAPA_TOKEN: Record<Capa, { color: string; bg: string; nombre: string }> = {
  periferica: { color: 'var(--capa-1)', bg: 'var(--capa-1-bg)', nombre: 'periférica' },
  intermedia: { color: 'var(--capa-2)', bg: 'var(--capa-2-bg)', nombre: 'intermedia' },
  central: { color: 'var(--capa-3)', bg: 'var(--capa-3-bg)', nombre: 'central' },
};

export const NOMBRE_CAPA: Record<Capa, string> = {
  periferica: 'periférica',
  intermedia: 'intermedia',
  central: 'central',
};

/** Color plano de una capa, para SVG y para puntos de medidor. */
export function capaColor(capa: Capa): string {
  return CAPA_TOKEN[capa].color;
}

/** Color por nivel numérico (1..3), que es como lo pide el radar. */
export function capaColorPorNivel(nivel: number): string {
  const capa = (Object.keys(CAPA_TOKEN) as Capa[]).find(c => CAPA_VALOR[c] === nivel);
  return capa ? CAPA_TOKEN[capa].color : 'var(--border)';
}

/**
 * Chip que MUESTRA una capa (no uno que la selecciona: ese es un control y
 * lleva el tratamiento de interacción, en morado).
 *
 * Devuelve `style` y no clases de Tailwind porque Tailwind escanea el fuente
 * en BUSCA DE LITERALES: una clase compuesta en tiempo de ejecución
 * (`[color:${x}]`) no aparece en el fuente y no se generaría nunca. Las
 * variables CSS sí resuelven por tema desde el atributo style.
 */
export function capaChip(capa: Capa): { className: string; style: CSSProperties } {
  const t = CAPA_TOKEN[capa];
  return {
    className: 'rounded-full border px-2 py-0.5 text-xs',
    style: { borderColor: t.color, background: t.bg, color: t.color },
  };
}

/**
 * La profundidad también se lee sin color: tres marcas, llenas hasta donde
 * llega. Es el mismo lenguaje que el medidor de dominios del detalle.
 */
export function capaMarcas(capa: Capa): string {
  return '●'.repeat(CAPA_VALOR[capa]) + '○'.repeat(3 - CAPA_VALOR[capa]);
}

// ---------------------------------------------------------------------------
// 3. Estados de predicción — verde / ámbar / rojo
// ---------------------------------------------------------------------------

export type EstadoPrediccion = 'acertada' | 'parcial' | 'fallida';

export const PREDICCION: Record<
  EstadoPrediccion,
  { icono: string; nombre: string; tarjeta: string; insignia: string }
> = {
  acertada: {
    icono: '✓',
    nombre: 'acertó',
    tarjeta: 'border-[var(--pred-acierto-borde)] bg-[var(--pred-acierto-bg)]',
    insignia: 'bg-[var(--pred-acierto-bg)] text-[var(--pred-acierto)]',
  },
  parcial: {
    icono: '≈',
    nombre: 'parcial',
    tarjeta: 'border-[var(--pred-parcial-borde)] bg-[var(--pred-parcial-bg)]',
    insignia: 'bg-[var(--pred-parcial-bg)] text-[var(--pred-parcial)]',
  },
  fallida: {
    icono: '✕',
    nombre: 'falló',
    tarjeta: 'border-[var(--pred-fallo-borde)] bg-[var(--pred-fallo-bg)]',
    insignia: 'bg-[var(--pred-fallo-bg)] text-[var(--pred-fallo)]',
  },
};

// ---------------------------------------------------------------------------
// 4. Contradicciones — acento propio, y ruidoso a propósito
// ---------------------------------------------------------------------------

/** La barra lateral gruesa es lo que la hace saltar al recorrer la columna;
 *  el color y el ⚡ confirman, no informan. */
export const CONTRADICCION = {
  icono: '⚡',
  tarjeta:
    'rounded-lg border border-l-4 border-[var(--contradiccion-borde)] border-l-[var(--contradiccion)] bg-[var(--contradiccion-bg)]',
  texto: 'text-[var(--contradiccion)]',
  separador: 'border-[var(--contradiccion-borde)]',
};

// ---------------------------------------------------------------------------
// 5. Familias de dominio — tres grupos, no nueve tonos
// ---------------------------------------------------------------------------

const FAMILIA_TOKEN: Record<Familia, { color: string; bg: string }> = {
  superficie: { color: 'var(--fam-superficie)', bg: 'var(--fam-superficie-bg)' },
  estructura: { color: 'var(--fam-estructura)', bg: 'var(--fam-estructura-bg)' },
  profundidad: { color: 'var(--fam-profundidad)', bg: 'var(--fam-profundidad-bg)' },
};

export function familiaDe(dominio: Dominio): Familia {
  return FAMILIA_DOMINIO[dominio];
}

/** Insignia de dominio, teñida por su familia. Siempre se renderiza CON el
 *  nombre del dominio: el tono agrupa, no identifica. `style` y no clases por
 *  lo mismo que en capaChip (Tailwind no ve las clases construidas). */
export function familiaChip(dominio: Dominio): { className: string; style: CSSProperties } {
  const t = FAMILIA_TOKEN[FAMILIA_DOMINIO[dominio]];
  return {
    className: 'rounded-full border px-2 py-0.5 text-xs',
    style: { borderColor: t.color, background: t.bg, color: t.color },
  };
}

export function familiaColor(familia: Familia): string {
  return FAMILIA_TOKEN[familia].color;
}
