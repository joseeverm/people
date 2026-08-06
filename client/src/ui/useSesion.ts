/**
 * Sesión de Supabase Auth.
 *
 * Clave para una app offline-first: `getSession()` LEE DE localStorage y no
 * necesita red. Si hay una sesión guardada se entra, aunque el token esté
 * vencido y no se pueda refrescar por falta de cobertura — lo único que se
 * degrada entonces es la subida, que espera en el outbox. Pedir credenciales
 * a alguien sin señal, con los datos ya en su IndexedDB, sería absurdo.
 *
 * Además es el ÚNICO sitio que abre y cierra la base local, y tiene que serlo:
 * cada usuario tiene la suya (ver `dexie-repo.ts`), así que la sesión y la base
 * abierta no pueden desincronizarse ni por un render. Por eso `abrirRepo` se
 * espera ANTES de publicar la sesión — en cuanto `sesion` deja de ser null,
 * App monta las vistas y sus efectos leen datos de inmediato (los efectos de
 * los hijos corren antes que los del padre, así que no valdría abrirla en un
 * `useEffect` de App: llegaría tarde).
 */
import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { abrirRepo, cerrarRepo } from '../data/dexie-repo';
import { haySupabase, supabase } from '../data/supabase';

export interface EstadoSesion {
  sesion: Session | null;
  /** true mientras se lee la sesión guardada (evita parpadear el login). */
  cargando: boolean;
  /** La base local no se pudo abrir. Sin ella no hay app: no se puede ni leer
   *  ni escribir, así que se muestra en vez de entrar. */
  error: string | null;
}

export function useSesion(): EstadoSesion {
  const [sesion, setSesion] = useState<Session | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!haySupabase) {
      setCargando(false);
      return;
    }

    let vivo = true;

    /** Deja la base local acorde a la sesión y solo entonces la publica. */
    async function aplicar(s: Session | null) {
      try {
        if (s) await abrirRepo(s.user.id);
        else cerrarRepo();
        if (!vivo) return;
        setError(null);
      } catch (err) {
        if (!vivo) return;
        setError(
          'No se pudo abrir la base de datos local: ' +
            (err instanceof Error ? err.message : String(err))
        );
        setCargando(false);
        return;
      }
      setSesion(s);
      setCargando(false);
    }

    supabase.auth.getSession().then(({ data }) => {
      void aplicar(data.session);
    });

    // Cubre login, logout y refresco de token en otra pestaña.
    const { data: sub } = supabase.auth.onAuthStateChange((_evento, s) => {
      void aplicar(s);
    });

    return () => {
      vivo = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { sesion, cargando, error };
}
