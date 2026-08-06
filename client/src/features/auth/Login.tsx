/**
 * Login con email y contraseña, o con Google. Es la puerta de la app: sin
 * sesión no se muestra nada más.
 *
 * No hay formulario de REGISTRO aquí, pero ya no por ser una app de un solo
 * usuario (eso cambió el 05-08-2026: se abre a más gente). Es que con Google
 * no hace falta: el alta está permitida en el panel de Supabase y el propio
 * `signInWithOAuth` crea el usuario la primera vez. Las cuentas de contraseña
 * se siguen creando a mano (Authentication → Users → Add user).
 *
 * ⚠️ El aislamiento entre usuarios lo sostiene HOY solo el RLS del servidor.
 * El almacenamiento local NO está partido por usuario: misma base de Dexie
 * para todos y `signOut` no la limpia, así que dos personas en el mismo
 * navegador se pisan. Ver § "Aislamiento entre usuarios" en server/README.md.
 */
import { useEffect, useState } from 'react';
import { supabase, urlDeRetorno } from '../../data/supabase';

/** Traduce los errores de Supabase Auth, que llegan en inglés. */
function mensajeDeError(mensaje: string): string {
  if (/invalid login credentials/i.test(mensaje)) return 'Email o contraseña incorrectos.';
  if (/email not confirmed/i.test(mensaje)) return 'Falta confirmar el email de esta cuenta.';
  if (/signups? not allowed|signup is disabled/i.test(mensaje))
    return 'Esa cuenta de Google no corresponde al usuario de la app.';
  if (/fetch|network|load failed/i.test(mensaje))
    return 'Sin conexión: no se pudo contactar con el servidor.';
  return mensaje;
}

/**
 * Lee el error que Google/Supabase dejan en la URL al volver de un intento
 * fallido y lo quita de la barra de direcciones.
 *
 * Hace falta porque `detectSessionInUrl` solo se ocupa del caso bueno: si el
 * usuario cancela o el proveedor rechaza, no hay `code` que canjear y sin esto
 * la vuelta sería un login en blanco, indistinguible de no haber pulsado nada.
 * Mira query Y fragmento: PKCE devuelve el error en la query, pero un error
 * emitido por el propio Supabase antes de llegar ahí viene en el `#`.
 */
function errorEnLaUrl(): string | null {
  const query = new URLSearchParams(window.location.search);
  const fragmento = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const codigo = query.get('error') ?? fragmento.get('error');

  if (!codigo) {
    // Con el canje bueno el cliente borra el `code` de la URL y esta pantalla
    // ni se monta. Verlo aquí significa que el canje falló en silencio: casi
    // siempre la URL de retorno no está en la lista blanca de Supabase, o el
    // verificador PKCE se quedó en otro navegador (el flujo empezó en la PWA
    // y volvió al navegador del sistema, o al revés).
    if (!query.get('code')) return null;
    window.history.replaceState({}, '', window.location.pathname);
    return (
      'Google respondió, pero no se pudo canjear la sesión. Revisa que esta ' +
      'URL esté autorizada en Supabase y vuelve a intentarlo desde el mismo navegador.'
    );
  }

  const descripcion =
    query.get('error_description') ?? fragmento.get('error_description') ?? codigo;
  // Deja la URL limpia: recargar no debe repetir el error ya mostrado.
  window.history.replaceState({}, '', window.location.pathname);
  if (/access_denied/i.test(codigo)) return 'Se canceló el acceso con Google.';
  return mensajeDeError(descripcion.replace(/\+/g, ' '));
}

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [entrando, setEntrando] = useState(false);
  const [conGoogle, setConGoogle] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Solo al montar: si estamos aquí después de volver de Google, es que algo
  // falló (con éxito nunca se llega a pintar el login, App muestra la app).
  useEffect(() => {
    const fallo = errorEnLaUrl();
    if (fallo) setError(fallo);
  }, []);

  async function entrarConGoogle() {
    setError(null);
    setConGoogle(true);
    try {
      const { error: fallo } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: urlDeRetorno() },
      });
      // Sin error el navegador ya se está yendo a Google: no se apaga el
      // "Abriendo…", que quede así hasta que la página se descargue.
      if (fallo) {
        setError(mensajeDeError(fallo.message));
        setConGoogle(false);
      }
    } catch (err) {
      setError(mensajeDeError(err instanceof Error ? err.message : String(err)));
      setConGoogle(false);
    }
  }

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setError(null);
    setEntrando(true);
    try {
      const { error: fallo } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      // Con éxito no hay que hacer nada: onAuthStateChange (useSesion) monta la app.
      if (fallo) setError(mensajeDeError(fallo.message));
    } catch (err) {
      setError(mensajeDeError(err instanceof Error ? err.message : String(err)));
    } finally {
      setEntrando(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-medium">People</h1>
        <p className="text-sm opacity-70">Entra para sincronizar tus señales.</p>
      </div>

      <form className="flex flex-col gap-4" onSubmit={entrar}>
        <label className="flex flex-col gap-1 text-sm">
          <span className="opacity-70">Email</span>
          <input
            className="toque-12 rounded-lg border border-[var(--border)] bg-transparent px-3 outline-none focus:border-[var(--accent)]"
            type="email"
            autoComplete="username"
            inputMode="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            autoFocus
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="opacity-70">Contraseña</span>
          <input
            className="toque-12 rounded-lg border border-[var(--border)] bg-transparent px-3 outline-none focus:border-[var(--accent)]"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
        </label>

        {error && (
          <p className="rounded-lg border border-[var(--error-borde)] bg-[var(--error-bg)] p-3 text-sm text-[var(--error)]">
            {error}
          </p>
        )}

        <button
          type="submit"
          className="toque-12 rounded-md bg-[var(--accent)] px-4 font-medium text-[var(--accent-texto)] disabled:cursor-not-allowed disabled:opacity-40"
          disabled={entrando || conGoogle || !email.trim() || !password}
        >
          {entrando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>

      {/* Separador: dos caminos a la misma puerta, ninguno es "el otro". */}
      <div className="flex items-center gap-3 text-xs opacity-50" aria-hidden>
        <span className="h-px flex-1 bg-[var(--border)]" />o
        <span className="h-px flex-1 bg-[var(--border)]" />
      </div>

      <button
        type="button"
        className="toque-12 flex items-center justify-center gap-3 rounded-md border border-[var(--border)] px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
        disabled={entrando || conGoogle}
        onClick={entrarConGoogle}
      >
        <LogoGoogle />
        {conGoogle ? 'Abriendo Google…' : 'Continuar con Google'}
      </button>
    </div>
  );
}

/** Logotipo oficial de Google. En color fijo a propósito: la marca es la misma
 *  en tema claro y oscuro, y recolorearla incumple sus normas de uso. */
function LogoGoogle() {
  return (
    <svg viewBox="0 0 48 48" className="size-5 shrink-0" aria-hidden>
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17Z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46Z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18c-.44-1.32-.69-2.73-.69-4.18s.25-2.86.69-4.18v-5.7H4.34A21.99 21.99 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7Z"
      />
      <path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07Z"
      />
    </svg>
  );
}
