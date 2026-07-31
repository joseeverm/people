/**
 * Sesión de Supabase Auth.
 *
 * Clave para una app offline-first: `getSession()` LEE DE localStorage y no
 * necesita red. Si hay una sesión guardada se entra, aunque el token esté
 * vencido y no se pueda refrescar por falta de cobertura — lo único que se
 * degrada entonces es la subida, que espera en el outbox. Pedir credenciales
 * a alguien sin señal, con los datos ya en su IndexedDB, sería absurdo.
 */
import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { haySupabase, supabase } from '../data/supabase';

export interface EstadoSesion {
  sesion: Session | null;
  /** true mientras se lee la sesión guardada (evita parpadear el login). */
  cargando: boolean;
}

export function useSesion(): EstadoSesion {
  const [sesion, setSesion] = useState<Session | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    if (!haySupabase) {
      setCargando(false);
      return;
    }

    let vivo = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!vivo) return;
      setSesion(data.session);
      setCargando(false);
    });

    // Cubre login, logout y refresco de token en otra pestaña.
    const { data: sub } = supabase.auth.onAuthStateChange((_evento, s) => {
      if (!vivo) return;
      setSesion(s);
      setCargando(false);
    });

    return () => {
      vivo = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { sesion, cargando };
}
