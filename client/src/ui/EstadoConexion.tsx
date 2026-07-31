/**
 * Aviso de "sin conexión". Discreto a propósito: quedarse sin red NO impide
 * trabajar — capturar escribe en IndexedDB, la cola de captura espera y lo
 * escrito se encola en el outbox para subirse luego. Lo único que se cae es
 * clasificar y generar perfiles, que necesitan la Edge Function.
 *
 * Presentacional: quien decide si mostrarlo, y quién lo posiciona, es App —
 * que apila este aviso con el de sincronización en una sola franja fija y
 * necesita saber cuántas líneas hay para reservarles sitio en el padding.
 */
export function AvisoSinConexion() {
  return (
    <div
      role="status"
      className="border-t border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-center text-xs text-amber-600"
    >
      Sin conexión · puedes capturar, pero no clasificar
    </div>
  );
}
