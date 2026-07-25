/**
 * Pestaña "Predicciones" del perfil de una persona. Las pendientes se separan
 * en dos secciones con propósitos distintos: las inferidas ("Se sigue de lo que
 * sabes") como síntesis, y las extrapoladas ("Puestas a prueba") que son las
 * únicas que calibran el modelo. Las resueltas van juntas abajo. El estado
 * (predicciones y señales) lo posee VistaPerfil, para que el indicador de
 * calibración del encabezado se recalcule al resolver: aquí solo se avisa con
 * `onCambio`.
 */
import type { Prediccion, Senal, TipoPrediccion } from '../../core/esquema';
import { NuevaPrediccion } from './NuevaPrediccion';
import { TarjetaPrediccion } from './TarjetaPrediccion';
import { SECCION_TIPO } from './resolver';

interface Props {
  personaId: string;
  predicciones: Prediccion[];
  senales: Senal[];
  onCambio: () => void;
}

export function PestanaPredicciones({ personaId, predicciones, senales, onCambio }: Props) {
  const pendientes = predicciones
    .filter(p => p.estado === 'pendiente')
    .sort((a, b) => a.creadaEn.localeCompare(b.creadaEn));
  const resueltas = predicciones
    .filter(p => p.estado !== 'pendiente')
    .sort((a, b) => b.creadaEn.localeCompare(a.creadaEn));

  // 'inferida' es la categoría explícita que NO calibra; todo lo demás (incluidas
  // predicciones legadas sin `tipo`) cae en 'extrapolada' para que nada desaparezca.
  const pendientesDe = (tipo: TipoPrediccion) =>
    tipo === 'inferida'
      ? pendientes.filter(p => p.tipo === 'inferida')
      : pendientes.filter(p => p.tipo !== 'inferida');

  return (
    <div className="flex flex-col gap-6">
      <NuevaPrediccion personaId={personaId} onCreada={onCambio} />

      {(['extrapolada', 'inferida'] as TipoPrediccion[]).map(tipo => {
        const lista = pendientesDe(tipo);
        const seccion = SECCION_TIPO[tipo];
        return (
          <div key={tipo} className="flex flex-col gap-2">
            <div className="flex flex-col gap-0.5">
              <h2 className="text-sm font-medium opacity-80">
                {seccion.titulo} ({lista.length})
              </h2>
              <p className="text-xs opacity-55">{seccion.nota}</p>
            </div>
            {lista.length === 0 ? (
              <p className="text-sm opacity-60">Nada pendiente aquí.</p>
            ) : (
              lista.map(p => (
                <TarjetaPrediccion key={p.id} prediccion={p} senales={senales} onResuelta={onCambio} />
              ))
            )}
          </div>
        );
      })}

      {resueltas.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium opacity-80">Resueltas ({resueltas.length})</h2>
          {resueltas.map(p => (
            <TarjetaPrediccion key={p.id} prediccion={p} senales={senales} onResuelta={onCambio} />
          ))}
        </div>
      )}
    </div>
  );
}
