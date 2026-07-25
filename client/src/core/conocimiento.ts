/**
 * PERFILADOR — Cálculo de conocimiento v1
 * ========================================
 * Dominio puro (sin React ni IO). Convierte las señales y predicciones de una
 * persona en su EstadoConocimiento: la matriz de cobertura (dominios × capas),
 * la calibración (tasa de acierto) y el nivel derivado.
 *
 * Esta es la función que alimenta la vista de personas (nivel + radar) y la
 * priorización de huecos. NO almacena nada: se recalcula al vuelo, siempre.
 *
 * Reglas clave, ya fijadas en esquema.ts y respetadas aquí:
 *  - pesoEfectivo = peso por tipo × decaimiento exponencial por recencia/dominio.
 *  - densidad de un dominio = suma de pesos efectivos de sus señales.
 *  - capaMax = la capa más profunda ALCANZADA CON SUSTENTO (no un dato suelto).
 *  - nivel = calcularNivel() sobre el estado agregado.
 */

import type {
  Senal,
  Prediccion,
  Dominio,
  Capa,
  CoberturaDominio,
  EstadoConocimiento,
} from './esquema';
import {
  DOMINIOS,
  CAPA_VALOR,
  DENSIDAD_MINIMA,
  pesoEfectivo,
  calcularNivel,
} from './esquema';

// ------------------------------------------------------------
// Umbrales de profundidad
// ------------------------------------------------------------

/**
 * Para que una CAPA cuente como "alcanzada" en un dominio no basta UNA señal:
 * una nota aislada de capa central puede ser una interpretación tuya apresurada.
 * Exigimos una masa mínima de peso efectivo en esa capa (o más profunda).
 *
 * Nota: las capas son acumulativas — una señal 'central' también aporta a la
 * evidencia de que conoces las capas 'intermedia' y 'periferica' del dominio.
 */
const PESO_MINIMO_CAPA: Record<Capa, number> = {
  periferica: 0.5,   // casi cualquier señal vigente basta
  intermedia: 1.0,   // ~2 señales intermedias vigentes, o una fuerte
  central: 1.2,      // el núcleo cuesta: exige sustento real
};

// ------------------------------------------------------------
// Cobertura de un dominio
// ------------------------------------------------------------

interface AcumuladorDominio {
  densidad: number;                    // suma de pesos efectivos (todas las señales)
  senales: number;                     // conteo bruto
  /** Peso efectivo acumulado en cada capa Y en las más profundas (acumulativo). */
  pesoEnCapaOsuperior: Record<Capa, number>;
}

function acumuladorVacio(): AcumuladorDominio {
  return {
    densidad: 0,
    senales: 0,
    pesoEnCapaOsuperior: { periferica: 0, intermedia: 0, central: 0 },
  };
}

/**
 * Determina la capa máxima alcanzada: la más profunda cuyo peso acumulado
 * (esa capa + las más profundas) supera su umbral. Recorre de profunda a
 * superficial y devuelve la primera que califica.
 */
function capaMaxAlcanzada(acc: AcumuladorDominio): Capa | null {
  const orden: Capa[] = ['central', 'intermedia', 'periferica'];
  for (const capa of orden) {
    if (acc.pesoEnCapaOsuperior[capa] >= PESO_MINIMO_CAPA[capa]) return capa;
  }
  return null;
}

// ------------------------------------------------------------
// Construcción de la matriz de cobertura
// ------------------------------------------------------------

function construirCobertura(senales: Senal[], hoy: Date): CoberturaDominio[] {
  // Inicializa los 9 dominios en cero: la matriz SIEMPRE tiene 9 filas,
  // así la UI (radar) puede pintar los vírgenes como huecos.
  const acc = new Map<Dominio, AcumuladorDominio>();
  for (const d of DOMINIOS) acc.set(d, acumuladorVacio());

  for (const s of senales) {
    // Una señal puede tocar varios dominios/capas; cada etiqueta suma por separado.
    for (const et of s.etiquetas) {
      const a = acc.get(et.dominio);
      if (!a) continue; // etiqueta con dominio desconocido → ignorar defensivamente
      const peso = pesoEfectivo(s, et.dominio, hoy);
      a.densidad += peso;
      a.senales += 1;
      // Aporte acumulativo: una señal en capa X refuerza X y todas las más superficiales.
      const nivelSenal = CAPA_VALOR[et.capa];
      (['periferica', 'intermedia', 'central'] as Capa[]).forEach(capa => {
        if (CAPA_VALOR[capa] <= nivelSenal) a.pesoEnCapaOsuperior[capa] += peso;
      });
    }
  }

  return DOMINIOS.map(d => {
    const a = acc.get(d)!;
    return {
      dominio: d,
      capaMax: capaMaxAlcanzada(a),
      densidad: a.densidad,
      senales: a.senales,
    };
  });
}

// ------------------------------------------------------------
// Calibración (tasa de acierto)
// ------------------------------------------------------------

/**
 * Mide qué tan bueno es el modelo, no cuántos datos tiene.
 *
 * SOLO cuentan las predicciones de tipo 'extrapolada' (extienden un patrón a
 * una situación no observada). Las 'inferidas' se resuelven igual, pero NO
 * entran ni en tasaAcierto ni en prediccionesResueltas: como se siguen
 * directamente de las señales ya registradas, son casi imposibles de fallar;
 * incluirlas inflaría artificialmente la calibración y haría que el sistema
 * mienta sobre cuánto conoce realmente a la persona. La calibración debe medir
 * capacidad predictiva real, no capacidad de sintetizar lo ya visto.
 *
 * 'parcial' cuenta como medio acierto. Con <3 extrapoladas resueltas devolvemos
 * null: no hay evidencia suficiente para hablar de calibración.
 */
const MINIMO_PARA_CALIBRAR = 3;

function calcularCalibracion(predicciones: Prediccion[]): {
  tasaAcierto: number | null;
  prediccionesResueltas: number;
} {
  const resueltas = predicciones.filter(p =>
    p.tipo === 'extrapolada' &&
    (p.estado === 'acertada' || p.estado === 'parcial' || p.estado === 'fallida')
  );
  const n = resueltas.length;
  if (n < MINIMO_PARA_CALIBRAR) {
    return { tasaAcierto: null, prediccionesResueltas: n };
  }
  const puntos = resueltas.reduce((s, p) => {
    if (p.estado === 'acertada') return s + 1;
    if (p.estado === 'parcial') return s + 0.5;
    return s;
  }, 0);
  return { tasaAcierto: puntos / n, prediccionesResueltas: n };
}

// ------------------------------------------------------------
// Entrada principal
// ------------------------------------------------------------

/**
 * Construye el EstadoConocimiento completo de una persona.
 * @param senales   TODAS las señales de la persona (donde es protagonista o aparece).
 * @param predicciones  TODAS sus predicciones (para calibración).
 * @param hoy       Inyectable para tests deterministas; por defecto ahora.
 */
export function calcularEstadoConocimiento(
  personaId: string,
  senales: Senal[],
  predicciones: Prediccion[],
  hoy: Date = new Date()
): EstadoConocimiento {
  const cobertura = construirCobertura(senales, hoy);

  const dominiosCubiertos = cobertura.filter(
    c => c.capaMax !== null && c.densidad >= DENSIDAD_MINIMA
  ).length;

  const dominiosCentrales = cobertura.filter(c => c.capaMax === 'central').length;

  const { tasaAcierto, prediccionesResueltas } = calcularCalibracion(predicciones);

  const parcial: Omit<EstadoConocimiento, 'nivel'> = {
    personaId,
    cobertura,
    dominiosCubiertos,
    dominiosCentrales,
    tasaAcierto,
    prediccionesResueltas,
  };

  return { ...parcial, nivel: calcularNivel(parcial) };
}

// ------------------------------------------------------------
// Ayudas para la UI (derivadas, baratas)
// ------------------------------------------------------------

/** Datos listos para un radar de 9 ejes: intensidad 0-3 por dominio. */
export function datosRadar(estado: EstadoConocimiento): { dominio: Dominio; intensidad: number }[] {
  return estado.cobertura.map(c => ({
    dominio: c.dominio,
    intensidad: c.capaMax ? CAPA_VALOR[c.capaMax] : 0,
  }));
}

/** Los dominios vírgenes o apenas periféricos, en orden de mayor vacío primero.
 *  Insumo para priorizar qué huecos pedirle al motor de inferencia. */
export function dominiosMasVacios(estado: EstadoConocimiento): Dominio[] {
  return [...estado.cobertura]
    .sort((a, b) => {
      const ia = a.capaMax ? CAPA_VALOR[a.capaMax] : 0;
      const ib = b.capaMax ? CAPA_VALOR[b.capaMax] : 0;
      if (ia !== ib) return ia - ib;      // menos profundo primero
      return a.densidad - b.densidad;     // desempata por menos evidencia
    })
    .map(c => c.dominio);
}
