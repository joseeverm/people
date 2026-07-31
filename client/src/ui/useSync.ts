/**
 * Disparadores del ciclo de sincronización. La lógica vive en data/sync.ts;
 * esto solo decide CUÁNDO llamarla y expone el estado para el indicador:
 *
 *  - al arrancar la app (con sesión ya resuelta),
 *  - cuando vuelve la conexión (evento `online`),
 *  - cada pocos minutos —siempre, no solo si hay pendientes: desde que existe
 *    el pull también hay que ENTERARSE de lo que escribió el otro dispositivo,
 *  - cuando crece el contador local de pendientes (una captura recién
 *    confirmada sube enseguida, sin esperar al siguiente tic),
 *  - a mano, desde el indicador o desde Ajustes.
 */
import { useCallback, useEffect, useState } from 'react';
import { repo } from '../data/dexie-repo';
import {
  leerUltimaSincronizacion,
  sincronizar,
  type ProgresoBajada,
} from '../data/sync';

/** Cada cuánto se sincroniza en segundo plano. */
const INTERVALO_MS = 3 * 60 * 1000;
/** Cada cuánto se refresca el contador que ve la UI. */
const SONDEO_CONTADOR_MS = 5 * 1000;

export interface EstadoSync {
  pendientes: number;
  subiendo: boolean;
  bajando: boolean;
  error: string | null;
  /** ISO de la última sincronización completa correcta; null si nunca hubo. */
  ultima: string | null;
  /** Solo durante la primera carga de un dispositivo nuevo, que sí tarda. */
  progreso: ProgresoBajada | null;
  /** ¿Hay algo que contar? Con todo al día el indicador no se muestra: el
   *  estado normal no necesita anuncio. App lo usa además para reservarle
   *  sitio en el padding del contenido. */
  mostrar: boolean;
  /** Fuerza un ciclo completo (lo usan el indicador y Ajustes). */
  sincronizar: () => void;
}

export function useSync(activo: boolean): EstadoSync {
  const [pendientes, setPendientes] = useState(0);
  const [subiendo, setSubiendo] = useState(false);
  const [bajando, setBajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ultima, setUltima] = useState<string | null>(null);
  const [progreso, setProgreso] = useState<ProgresoBajada | null>(null);

  const correr = useCallback(async () => {
    if (!activo) return;
    try {
      const r = await sincronizar({
        alCambiarFase: fase => {
          setSubiendo(fase === 'subiendo');
          setBajando(fase === 'bajando');
        },
        // La barra solo tiene sentido en la primera carga; un pull incremental
        // trae cuatro filas y parpadearía.
        alProgresar: p => setProgreso(p.primeraCarga ? p : null),
      });

      setPendientes(r.subida.pendientes);

      // Quedarse sin red no es un error que mostrar: ya lo dice el aviso de
      // conexión, y la cola simplemente espera. Un fallo del PULL sí se
      // muestra, pero no bloquea nada — se sigue trabajando en local.
      const falloSubida = r.subida.sinConexion ? null : r.subida.error;
      const falloBajada = r.bajada && !r.bajada.sinConexion ? r.bajada.error : null;
      setError(falloSubida ?? falloBajada);

      if (r.bajada && !r.bajada.error && !r.bajada.sinConexion) {
        setUltima(await leerUltimaSincronizacion());
      }
    } finally {
      setSubiendo(false);
      setBajando(false);
      setProgreso(null);
    }
  }, [activo]);

  // Arranque + vuelta de la conexión + tic periódico.
  useEffect(() => {
    if (!activo) return;

    leerUltimaSincronizacion().then(setUltima);
    correr();

    const alVolverLaRed = () => correr();
    window.addEventListener('online', alVolverLaRed);
    const periodico = setInterval(correr, INTERVALO_MS);

    return () => {
      window.removeEventListener('online', alVolverLaRed);
      clearInterval(periodico);
    };
  }, [activo, correr]);

  // Contador para la UI. Sondeo simple: Dexie no avisa de cambios sin
  // liveQuery, y una escritura puede venir de cualquier vista.
  useEffect(() => {
    if (!activo) return;
    let vivo = true;
    let anterior = -1;

    const mirar = async () => {
      const n = await repo.contarPendientes();
      if (!vivo) return;
      setPendientes(n);
      // Se encoló algo nuevo desde la última mirada: no esperes al tic de 3 min.
      if (anterior >= 0 && n > anterior) correr();
      anterior = n;
    };

    mirar();
    const t = setInterval(mirar, SONDEO_CONTADOR_MS);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [activo, correr]);

  return {
    pendientes,
    subiendo,
    bajando,
    error,
    ultima,
    progreso,
    // `bajando` a secas NO enciende el indicador: si no, la franja parpadearía
    // cada tres minutos para no decir nada. Solo se muestra la bajada cuando es
    // la primera carga (progreso), que sí tarda y conviene explicar.
    mostrar: pendientes > 0 || subiendo || progreso !== null || error !== null,
    sincronizar: () => void correr(),
  };
}
