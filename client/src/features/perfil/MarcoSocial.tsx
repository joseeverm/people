/**
 * Sección MARCO SOCIAL del perfil: cómo cambia la persona según con quién está
 * (compañía) y bajo qué situación, incluyendo los cruces (p. ej. "cálida con
 * amigos salvo en conflicto"). Viene del motor como Record<string, string>:
 * la clave es el patrón/faceta, el valor describe cómo se comporta ahí.
 *
 * Se presentan como facetas COMPARABLES (una cuadrícula de tarjetas gemelas),
 * no como párrafos sueltos, para que se lean unas contra otras de un vistazo.
 */
import type { PerfilGenerado } from '../../core/esquema';

interface Props {
  /** PerfilGenerado.porMarcoSocial — patrón → cómo se comporta en él. */
  porMarcoSocial: PerfilGenerado['porMarcoSocial'];
}

export function SeccionMarcoSocial({ porMarcoSocial }: Props) {
  const entradas = Object.entries(porMarcoSocial ?? {});
  if (entradas.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-medium opacity-80">Marco social</h2>
      <p className="text-xs opacity-60">Cómo cambia según con quién está y en qué situación.</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {entradas.map(([marco, descripcion]) => (
          <div key={marco} className="flex flex-col gap-1 rounded-lg border border-[var(--border)] p-3">
            <span className="text-xs font-medium uppercase tracking-wide opacity-70">{marco}</span>
            <span className="text-sm">{descripcion}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
