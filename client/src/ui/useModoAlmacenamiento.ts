/**
 * Lee el modo de almacenamiento del usuario activo y se entera de los cambios,
 * vengan de esta pestaña (evento propio) o de otra (`storage`).
 *
 * Devuelve `null` mientras no haya usuario o no haya elegido: quien lo consume
 * tiene que distinguir "todavía no eligió" de los dos modos, porque es lo que
 * levanta la pantalla de primer arranque.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  EVENTO_MODO_CAMBIADO,
  guardarModo,
  leerModo,
  type ModoAlmacenamiento,
} from '../data/modo-almacenamiento';

export interface EstadoModo {
  modo: ModoAlmacenamiento | null;
  /** Guarda la elección; la relectura llega por el evento, no por este return. */
  elegir: (modo: ModoAlmacenamiento) => void;
}

export function useModoAlmacenamiento(userId: string | null): EstadoModo {
  const [modo, setModo] = useState<ModoAlmacenamiento | null>(() =>
    userId ? leerModo(userId) : null
  );

  useEffect(() => {
    if (!userId) {
      setModo(null);
      return;
    }
    // El userId pudo cambiar desde el useState inicial (cambio de sesión).
    setModo(leerModo(userId));

    const releer = () => setModo(leerModo(userId));
    window.addEventListener(EVENTO_MODO_CAMBIADO, releer);
    window.addEventListener('storage', releer);
    return () => {
      window.removeEventListener(EVENTO_MODO_CAMBIADO, releer);
      window.removeEventListener('storage', releer);
    };
  }, [userId]);

  const elegir = useCallback(
    (nuevo: ModoAlmacenamiento) => {
      if (userId) guardarModo(userId, nuevo);
    },
    [userId]
  );

  return { modo, elegir };
}
