/**
 * Aviso de "sin conexión". Discreto a propósito: quedarse sin red NO impide
 * trabajar — capturar escribe en IndexedDB y la cola espera (invariante #5).
 * Lo único que se cae es clasificar y generar perfiles, que necesitan la Edge
 * Function. El aviso existe para que eso no se lea como un fallo de la app.
 *
 * Presentacional: quien decide si mostrarlo es App, que necesita el mismo dato
 * (useEstaEnLinea) para reservarle sitio en el padding del contenido y que la
 * franja no tape el final de una lista.
 */

/** Franja fija sobre la barra de navegación inferior (o abajo del todo en
 *  escritorio, donde el nav va arriba). */
export function AvisoSinConexion() {
  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-[calc(var(--nav-inferior)+var(--safe-abajo))] z-30 border-t border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-center text-xs text-amber-600 backdrop-blur md:bottom-0"
    >
      Sin conexión · puedes capturar, pero no clasificar
    </div>
  );
}
