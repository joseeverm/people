/**
 * El modo de almacenamiento del usuario activo, en dos hooks con papeles
 * distintos:
 *
 *  - `useResolverModo` — lo RESUELVE contra el servidor al entrar. Lo usa App,
 *    una sola vez, como puerta antes de montar nada.
 *  - `useModoAlmacenamiento` — solo LEE la caché y se entera de los cambios.
 *    Lo usa Ajustes, que se monta y se desmonta y no debe volver a preguntarle
 *    al servidor cada vez.
 *
 * Están separados a propósito: si el hook de lectura resolviera, cada visita a
 * Ajustes dispararía una consulta, y peor, un fallo de red ahí podría dejar la
 * pantalla en un estado de "no sé" que en Ajustes no significa nada.
 */
import { useCallback, useEffect, useState } from 'react';
import { guardarModoRemoto, leerModoRemoto } from '../data/ajustes-usuario';
import { repo } from '../data/dexie-repo';
import {
  avisoLocalPendiente,
  descartarAvisoLocal,
  EVENTO_MODO_CAMBIADO,
  guardarModo,
  leerModo,
  marcarAvisoLocalPendiente,
  type ModoAlmacenamiento,
} from '../data/modo-almacenamiento';

// ---------------------------------------------------------------------------
// Lectura simple (Ajustes)
// ---------------------------------------------------------------------------

/**
 * Lee la caché del modo y se entera de los cambios, vengan de esta pestaña
 * (evento propio) o de otra (`storage`). Nunca consulta al servidor.
 */
export function useModoAlmacenamiento(userId: string | null): ModoAlmacenamiento | null {
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

  return modo;
}

// ---------------------------------------------------------------------------
// Resolución contra la cuenta (App)
// ---------------------------------------------------------------------------

export type EstadoResolucion =
  /** Preguntándole al servidor. No se muestra nada todavía. */
  | { estado: 'resolviendo' }
  /** La cuenta ya decidió (o este dispositivo lo recuerda y no hubo red). */
  | { estado: 'listo'; modo: ModoAlmacenamiento }
  /** La cuenta no ha decidido NUNCA: toca preguntar. */
  | { estado: 'sin-elegir' }
  /** No se pudo saber y este dispositivo tampoco lo recordaba. */
  | { estado: 'inalcanzable'; mensaje: string };

export interface Resolucion {
  estado: EstadoResolucion;
  /** Este dispositivo entró en una cuenta que ya estaba en local: empieza
   *  vacío y hay que avisarlo antes de dejar ver la app. */
  avisoLocal: boolean;
  descartarAviso: () => void;
  /** Guarda la primera elección (servidor y caché). Lanza si el servidor falla:
   *  una elección que no llega a la cuenta es exactamente el fallo que este
   *  rediseño cierra, así que no puede darse por buena. */
  elegir: (modo: ModoAlmacenamiento) => Promise<void>;
  reintentar: () => void;
}

/** ¿Está la base de este dispositivo realmente vacía? El aviso de "empiezas de
 *  cero" solo tiene sentido si es verdad — alguien puede haber limpiado el
 *  localStorage con los datos de Dexie intactos, y ahí decirle que no tiene
 *  nada sería mentira y un susto. Se mira personas primero para no cargar el
 *  historial de señales de un dispositivo que sí tiene datos. */
async function baseVacia(): Promise<boolean> {
  const personas = await repo.listarPersonas();
  if (personas.length > 0) return false;
  const senales = await repo.todasLasSenales();
  return senales.length === 0;
}

export function useResolverModo(userId: string | null): Resolucion {
  const [estado, setEstado] = useState<EstadoResolucion>({ estado: 'resolviendo' });
  const [avisoLocal, setAvisoLocal] = useState(false);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    if (!userId) {
      setEstado({ estado: 'resolviendo' });
      setAvisoLocal(false);
      return;
    }

    let vivo = true;

    async function resolver(id: string) {
      setEstado({ estado: 'resolviendo' });

      const cache = leerModo(id);
      const remoto = await leerModoRemoto(id);
      if (!vivo) return;

      if (remoto.estado === 'encontrado') {
        // Este dispositivo no sabía nada y la cuenta dice "local": aquí no va a
        // llegar ningún dato solo, porque en local no viaja nada. Se marca para
        // avisarlo, pero solo si la base está de verdad vacía.
        if (cache === null && remoto.modo === 'local' && (await baseVacia())) {
          marcarAvisoLocalPendiente(id);
        }
        if (!vivo) return;
        // La caché se refresca SIEMPRE, también cuando ya coincidía: es lo que
        // hace que el próximo arranque sin red use el valor bueno.
        guardarModo(id, remoto.modo);
        setAvisoLocal(avisoLocalPendiente(id));
        setEstado({ estado: 'listo', modo: remoto.modo });
        return;
      }

      if (remoto.estado === 'sin-fila') {
        // Nadie ha elegido nunca en esta cuenta. Este es el ÚNICO caso que
        // justifica preguntar.
        setAvisoLocal(false);
        setEstado({ estado: 'sin-elegir' });
        return;
      }

      // No se pudo saber. Si este dispositivo lo recordaba, manda lo cacheado:
      // la app es offline-first y un dispositivo ya configurado tiene que
      // arrancar sin red. Si no lo recordaba, NO se pregunta — contestar por su
      // cuenta lo que no se pudo consultar es el fallo original con otra cara.
      if (cache !== null) {
        setAvisoLocal(avisoLocalPendiente(id));
        setEstado({ estado: 'listo', modo: cache });
        return;
      }
      setEstado({ estado: 'inalcanzable', mensaje: remoto.mensaje });
    }

    void resolver(userId);
    return () => {
      vivo = false;
    };
  }, [userId, intento]);

  const elegir = useCallback(
    async (modo: ModoAlmacenamiento) => {
      if (!userId) return;
      // El servidor primero: si esto falla, la elección no ha ocurrido y hay
      // que decirlo, no entrar en la app con un modo que la cuenta no conoce.
      await guardarModoRemoto(userId, modo);
      guardarModo(userId, modo);
      setEstado({ estado: 'listo', modo });
    },
    [userId]
  );

  const descartarAviso = useCallback(() => {
    if (!userId) return;
    descartarAvisoLocal(userId);
    setAvisoLocal(false);
  }, [userId]);

  return {
    estado,
    avisoLocal,
    descartarAviso,
    elegir,
    reintentar: () => setIntento(n => n + 1),
  };
}
