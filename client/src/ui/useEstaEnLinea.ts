/**
 * Estado de conexión del navegador, para avisar de que se puede capturar pero
 * no clasificar (la Edge Function de IA es lo único que necesita red).
 *
 * En archivo propio y no junto al componente: mezclar hooks y componentes en
 * el mismo módulo rompe el Fast Refresh de React (oxlint lo señala).
 */
import { useEffect, useState } from 'react';

/** `navigator.onLine` solo garantiza "hay interfaz de red": puede dar true con
 *  un portal cautivo o sin salida real. Sirve para avisar, no para decidir si
 *  intentar una petición — eso lo resuelve el propio fallo del fetch. */
export function useEstaEnLinea(): boolean {
  const [enLinea, setEnLinea] = useState(() => navigator.onLine);

  useEffect(() => {
    const conectado = () => setEnLinea(true);
    const desconectado = () => setEnLinea(false);
    window.addEventListener('online', conectado);
    window.addEventListener('offline', desconectado);
    // El estado pudo cambiar entre el primer render y este efecto.
    setEnLinea(navigator.onLine);
    return () => {
      window.removeEventListener('online', conectado);
      window.removeEventListener('offline', desconectado);
    };
  }, []);

  return enLinea;
}
