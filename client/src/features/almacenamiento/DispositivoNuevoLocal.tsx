/**
 * Este dispositivo acaba de entrar en una cuenta que está en modo
 * "solo en este dispositivo" — y el dispositivo del que habla ese modo es OTRO.
 *
 * O sea: aquí no hay nada y no va a llegar nada solo. En modo nube un teléfono
 * nuevo se puebla con el primer pull; en local no viaja nada por definición, así
 * que la app arrancaría vacía y parecería que se perdió todo. Eso hay que
 * decirlo antes de dejar ver la app vacía, no después.
 *
 * Y decirlo a secas no basta: el respaldo JSON es la ÚNICA vía que existe para
 * traerse los datos del otro dispositivo, así que se ofrece aquí mismo. Es la
 * misma importación de Ajustes (`repo.importar`, destructiva y con validación
 * previa), solo que aquí no hay nada que destruir — se comprobó que la base
 * está vacía antes de llegar a esta pantalla.
 *
 * Sale una sola vez por dispositivo: la marca la lleva `modo-almacenamiento.ts`
 * y se borra al salir por cualquiera de las dos puertas.
 */
import { useRef, useState } from 'react';
import { repo } from '../../data/dexie-repo';
import { ErrorImport, leerArchivoBundle } from '../../data/export';

interface Props {
  /** Cierra el aviso: importó un respaldo o decidió empezar de cero. */
  onListo: () => void;
}

function mensajeError(e: unknown): string {
  if (e instanceof ErrorImport) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

export function DispositivoNuevoLocal({ onListo }: Props) {
  const [importando, setImportando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputArchivo = useRef<HTMLInputElement>(null);

  async function elegirArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    // Se limpia el input para que volver a elegir el MISMO archivo dispare change.
    e.target.value = '';
    if (!archivo) return;

    setImportando(true);
    setError(null);
    try {
      // Valida antes de tocar la base: si el archivo no sirve, lanza y aquí no
      // se ha escrito nada (ver export.ts).
      const bundle = await leerArchivoBundle(archivo);
      await repo.importar(bundle);
      // Sin resumen en pantalla: al salir de aquí la app ya muestra las
      // personas importadas, que es mejor acuse que un número.
      onListo();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setImportando(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-5 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-medium">Este dispositivo empieza vacío</h1>
        <p className="text-sm opacity-80">
          Tienes tus datos guardados <strong>solo en el otro dispositivo</strong>, que es lo que
          elegiste para esta cuenta. Por eso no se han descargado aquí: no se envían a ningún
          lado, ni siquiera entre tus propios dispositivos.
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-[var(--border)] p-4">
        <h2 className="text-base font-medium">Si quieres traértelos</h2>
        <p className="text-sm opacity-80">
          En el otro dispositivo entra en <strong>Ajustes → Descargar copia</strong>, pásate el
          archivo (por correo, cable, lo que uses) y cárgalo aquí.
        </p>
        <button
          type="button"
          className="toque-12 rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-[var(--accent-texto)] disabled:opacity-40 sm:self-start"
          disabled={importando}
          onClick={() => inputArchivo.current?.click()}
        >
          {importando ? 'Cargando…' : 'Cargar un respaldo'}
        </button>
        <input
          ref={inputArchivo}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={elegirArchivo}
        />
      </div>

      <p className="text-sm opacity-70">
        También puedes empezar de cero aquí. Si prefieres que tus datos estén en todos tus
        dispositivos sin pasar archivos, cambia el modo en Ajustes → Dónde se guardan tus datos.
      </p>

      <button
        type="button"
        className="toque-12 rounded-md border border-[var(--border)] px-4 text-sm font-medium disabled:opacity-40"
        disabled={importando}
        onClick={onListo}
      >
        Entendido, empezar vacío
      </button>

      {error && (
        <p className="rounded-lg border border-[var(--error-borde)] bg-[var(--error-bg)] p-3 text-sm text-[var(--error)]">
          {error}
        </p>
      )}
    </div>
  );
}
