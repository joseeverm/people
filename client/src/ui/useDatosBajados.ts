/**
 * Recarga una vista cuando el pull acaba de traer filas nuevas.
 *
 * Las vistas leen del repo al montar, así que sin esto lo que baja del
 * servidor no se ve hasta navegar a otro sitio y volver — que en una prueba
 * entre dos dispositivos parece que la sincronización no funciona.
 *
 * Un evento de `window` y no un contexto: el aviso nace en `data/sync.ts`, que
 * es un módulo suelto sin árbol de React encima, y las vistas interesadas son
 * pocas y no están emparentadas.
 */
import { useEffect } from 'react';
import { EVENTO_DATOS_BAJADOS } from '../data/sync';

export function useDatosBajados(recargar: () => void) {
  useEffect(() => {
    window.addEventListener(EVENTO_DATOS_BAJADOS, recargar);
    return () => window.removeEventListener(EVENTO_DATOS_BAJADOS, recargar);
  }, [recargar]);
}
