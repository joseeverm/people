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
 * ---------------------------------------------------------------------------
 * DÓNDE VIVE LA ELECCIÓN (cambió el 07-08-2026)
 * ---------------------------------------------------------------------------
 * La fuente de verdad es la CUENTA: la tabla `ajustes_usuario` del servidor
 * (ver `data/ajustes-usuario.ts`). Antes vivía solo aquí, en localStorage, y
 * era un fallo: al entrar con la misma cuenta en otro dispositivo la app
 * volvía a preguntar, y si ahí se contestaba otra cosa el usuario se quedaba
 * sin sus datos sin que nada diera error.
 *
 * Lo que queda en localStorage es una CACHÉ de esa decisión, y sigue haciendo
 * falta por dos motivos que no son negociables:
 *
 *  - `puedeSincronizar()` (sync.ts) la consulta en cada pasada. Si preguntara
 *    al servidor, la guarda del modo local dependería de una petición de red
 *    —y una guarda que falla abierta cuando no hay respuesta no es una guarda—.
 *    Leer de localStorage es síncrono y no puede fallar a medias.
 *  - La app es offline-first: un dispositivo ya configurado tiene que arrancar
 *    y funcionar sin red, y para eso necesita recordar qué se decidió.
 *
 * La caché se refresca al entrar, cuando `useModoAlmacenamiento` resuelve el
 * modo contra el servidor. Mientras no haya red manda lo cacheado.
 */

export type ModoAlmacenamiento = 'local' | 'nube';

/** Por usuario: en un navegador compartido cada quien tiene su cuenta y su
 *  caché, igual que tiene su propia base de Dexie. */
function clave(userId: string): string {
  return `perfilador:modo:${userId}`;
}

/** Marca de que a este dispositivo le tocó entrar en una cuenta que ya estaba
 *  en modo local. Ver `avisoLocalPendiente`. */
function claveAviso(userId: string): string {
  return `perfilador:aviso-local:${userId}`;
}

/** Se emite en `window` al cambiar el modo, para que la UI abierta reaccione
 *  sin recargar (localStorage solo avisa a las OTRAS pestañas, no a esta). */
export const EVENTO_MODO_CAMBIADO = 'almacenamiento:modo-cambiado';

/**
 * Lo último que se supo del modo de esta cuenta en este dispositivo.
 *
 * `null` = este dispositivo todavía no lo sabe. Ojo: eso YA NO significa "hay
 * que preguntar" — significa "hay que consultarle al servidor". Quien pregunta
 * es `useModoAlmacenamiento`, y solo cuando el servidor confirma que la cuenta
 * no ha elegido nunca.
 */
export function leerModo(userId: string): ModoAlmacenamiento | null {
  const v = localStorage.getItem(clave(userId));
  return v === 'local' || v === 'nube' ? v : null;
}

/** Refresca la caché local. NO habla con el servidor: quien cambia el modo de
 *  la cuenta es `guardarModoRemoto`, y esto solo anota el resultado. */
export function guardarModo(userId: string, modo: ModoAlmacenamiento): void {
  localStorage.setItem(clave(userId), modo);
  window.dispatchEvent(new CustomEvent(EVENTO_MODO_CAMBIADO));
}

// ---------------------------------------------------------------------------
// Aviso de dispositivo nuevo en una cuenta en modo local
// ---------------------------------------------------------------------------
// En modo nube, un dispositivo nuevo se puebla solo con el primer pull. En modo
// local no: los datos, por definición, no han salido del otro dispositivo. Así
// que aquí se empieza vacío, y hay que DECIRLO — si no, la app parece haber
// perdido todo. El respaldo JSON es la única vía que existe para traérselos, y
// se ofrece en el mismo sitio donde se da la mala noticia.

export function marcarAvisoLocalPendiente(userId: string): void {
  localStorage.setItem(claveAviso(userId), 'pendiente');
}

export function avisoLocalPendiente(userId: string): boolean {
  return localStorage.getItem(claveAviso(userId)) === 'pendiente';
}

/** Lo llama la propia pantalla del aviso al cerrarse (se importó un respaldo o
 *  se decidió empezar de cero). Que sea explícito y no automático evita que un
 *  recargar a destiempo se lleve por delante el aviso sin haberlo leído. */
export function descartarAvisoLocal(userId: string): void {
  localStorage.removeItem(claveAviso(userId));
  window.dispatchEvent(new CustomEvent(EVENTO_MODO_CAMBIADO));
}
