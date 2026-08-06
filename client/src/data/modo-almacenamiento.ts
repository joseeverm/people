/**
 * MODO DE ALMACENAMIENTO — dónde viven los datos de cada usuario.
 *
 * Dos modos, y la diferencia es una sola cosa: si el ciclo de sincronización
 * corre o no.
 *
 *  - `local`: los datos no salen del dispositivo. `sincronizar()` no se ejecuta
 *    NUNCA — ni subir ni bajar. Todo lo demás (captura, perfiles, predicciones,
 *    la IA) funciona igual, porque todo eso ya era local.
 *  - `nube`: el comportamiento de siempre.
 *
 * El login sigue siendo obligatorio en los dos: no está ahí para sincronizar,
 * sino para que el proxy de IA (`core/llm.ts` → Edge Function `llm`) no quede
 * abierto a cualquiera. Con `verify_jwt` en el server, sin sesión no hay IA.
 *
 * La elección se guarda en localStorage y NO en la base del usuario ni en el
 * servidor, por tres razones:
 *  - Se necesita ANTES de tocar nada: es la que decide si se puede hablar con
 *    el servidor, así que no puede depender de él.
 *  - Es una decisión por dispositivo, no por cuenta: el mismo usuario puede
 *    querer su portátil sincronizado y un prestado en modo local.
 *  - Guardarla en el servidor sería contradictorio en el modo cuyo sentido es
 *    justamente no mandar nada al servidor.
 */

export type ModoAlmacenamiento = 'local' | 'nube';

/** Por usuario: en un navegador compartido cada quien elige lo suyo. */
function clave(userId: string): string {
  return `perfilador:modo:${userId}`;
}

/** Se emite en `window` al cambiar el modo, para que la UI abierta reaccione
 *  sin recargar (localStorage solo avisa a las OTRAS pestañas, no a esta). */
export const EVENTO_MODO_CAMBIADO = 'almacenamiento:modo-cambiado';

/**
 * `null` = este usuario todavía no ha elegido en este dispositivo. Es lo que
 * dispara la pantalla de primer arranque; no se asume ningún valor por
 * omisión, porque elegir por él es justo lo que no se debe hacer con esto.
 */
export function leerModo(userId: string): ModoAlmacenamiento | null {
  const v = localStorage.getItem(clave(userId));
  return v === 'local' || v === 'nube' ? v : null;
}

export function guardarModo(userId: string, modo: ModoAlmacenamiento): void {
  localStorage.setItem(clave(userId), modo);
  window.dispatchEvent(new CustomEvent(EVENTO_MODO_CAMBIADO));
}
