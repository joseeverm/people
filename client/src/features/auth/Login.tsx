/**
 * Login con email y contraseña. Es la puerta de la app: sin sesión no se
 * muestra nada más.
 *
 * NO hay alta de cuenta aquí a propósito. Esta es una app de un solo usuario
 * (ver CLAUDE.md): un formulario de registro en una URL pública dejaría que
 * cualquiera se cree una cuenta. El usuario se crea a mano una vez, desde el
 * panel de Supabase (Authentication → Users → Add user).
 */
import { useState } from 'react';
import { supabase } from '../../data/supabase';

/** Traduce los errores de Supabase Auth, que llegan en inglés. */
function mensajeDeError(mensaje: string): string {
  if (/invalid login credentials/i.test(mensaje)) return 'Email o contraseña incorrectos.';
  if (/email not confirmed/i.test(mensaje)) return 'Falta confirmar el email de esta cuenta.';
  if (/fetch|network|load failed/i.test(mensaje))
    return 'Sin conexión: no se pudo contactar con el servidor.';
  return mensaje;
}

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [entrando, setEntrando] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          <p className="rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-sm text-red-500">
            {error}
          </p>
        )}

        <button
          type="submit"
          className="toque-12 rounded-md bg-[var(--accent)] px-4 font-medium text-[var(--accent-texto)] disabled:cursor-not-allowed disabled:opacity-40"
          disabled={entrando || !email.trim() || !password}
        >
          {entrando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
