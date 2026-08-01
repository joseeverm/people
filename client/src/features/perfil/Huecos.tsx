/**
 * Sección HUECOS del perfil — la que convierte la app de archivo pasivo en
 * herramienta activa: qué falta por conocer y QUÉ PREGUNTAR para llenarlo.
 * El motor ya los entrega priorizados; se renderizan en ese orden. Las
 * preguntas sugeridas se pueden copiar (una a una o todas) para tenerlas a
 * mano antes de ver a la persona.
 */
import { useState } from 'react';
import type { Capa, Dominio, HuecoInfo } from '../../core/esquema';

/** 'valores_creencias' → 'valores creencias' para lectura humana. */
function humanizar(slug: string): string {
  return slug.replace(/_/g, ' ');
}

const NOMBRE_CAPA: Record<Capa, string> = {
  periferica: 'periférica',
  intermedia: 'intermedia',
  central: 'central',
};

/** Botón de copiar con feedback breve ("copiado ✓") tras el clic. */
function BotonCopiar({ texto, etiqueta }: { texto: string; etiqueta: string }) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      // clipboard no disponible (contexto no seguro): no rompemos la vista.
      setCopiado(false);
    }
  }

  return (
    <button
      type="button"
      onClick={copiar}
      className="toque-11 shrink-0 rounded border border-[var(--border)] px-3 text-xs opacity-70 hover:opacity-100"
      aria-label={`Copiar ${etiqueta}`}
    >
      {copiado ? 'copiado ✓' : 'copiar'}
    </button>
  );
}

function HuecoItem({ hueco }: { hueco: HuecoInfo }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-bg)] p-4">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm font-medium capitalize">{humanizar(hueco.dominio as Dominio)}</span>
        <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs opacity-70">
          capa {NOMBRE_CAPA[hueco.capaObjetivo]}
        </span>
      </div>

      <p className="text-sm opacity-80">{hueco.razon}</p>

      {hueco.preguntasSugeridas.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide opacity-60">Preguntas sugeridas</span>
            {hueco.preguntasSugeridas.length > 1 && (
              <BotonCopiar texto={hueco.preguntasSugeridas.join('\n')} etiqueta="todas las preguntas" />
            )}
          </div>
          <ul className="flex flex-col gap-2">
            {hueco.preguntasSugeridas.map((pregunta, i) => (
              <li
                key={i}
                className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg)] p-2 pl-3"
              >
                <span className="min-w-0 flex-1 text-sm">{pregunta}</span>
                <BotonCopiar texto={pregunta} etiqueta="la pregunta" />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

interface Props {
  huecos: HuecoInfo[];
}

export function SeccionHuecos({ huecos }: Props) {
  if (huecos.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-medium">Huecos por llenar</h2>
        <p className="text-xs opacity-60">
          Priorizados: lo que más reduciría la incertidumbre sobre quién es. Lleva estas preguntas a la próxima charla.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        {huecos.map((h, i) => (
          <HuecoItem key={i} hueco={h} />
        ))}
      </div>
    </div>
  );
}
