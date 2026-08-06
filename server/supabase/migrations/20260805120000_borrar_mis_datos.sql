-- ============================================================================
-- borrar_mis_datos() — vaciar la cuenta propia del servidor
-- ============================================================================
-- Hace falta para el modo "solo en este dispositivo": al pasar de nube a local
-- se le pregunta al usuario si quiere que sus datos dejen de estar en el
-- servidor, y hasta ahora no había forma de cumplirlo — el esquema no tiene
-- políticas ni grants de DELETE en ninguna de las cinco tablas, a propósito
-- (ver la cabecera de 20260731120000_sync_inicial.sql).
--
-- Por qué una función y NO políticas de delete:
--
--  * Abrir DELETE en la Data API daría permiso para borrar UNA señal suelta, y
--    eso rompe el invariante #1 del dominio (las señales son inmutables;
--    corregir = agregar otra). Lo que el usuario pide aquí no es editar su
--    historia: es irse y llevarse todo. Son actos distintos y merecen permisos
--    distintos.
--  * Con una sola función el permiso concedido es exactamente "vaciar lo mío,
--    entero". No hay forma de expresar un borrado parcial a través de ella.
--
-- `security definer` porque la función salta el RLS: por eso el `where user_id
-- = auth.uid()` de cada DELETE NO es una optimización ni una redundancia — es
-- LA ÚNICA protección que queda. Ninguno de esos WHERE se puede quitar.
-- `search_path = ''` (y nombres calificados) para que no se pueda secuestrar
-- la resolución de nombres desde el esquema del que llama.

create or replace function public.borrar_mis_datos()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  quien uuid := auth.uid();
  n_personas     bigint;
  n_senales      bigint;
  n_predicciones bigint;
  n_perfiles     bigint;
  n_guias        bigint;
begin
  -- Sin sesión no hay nada que borrar, y un `where user_id = null` no
  -- coincidiría con ninguna fila — pero fallar ruidosamente es mejor que
  -- devolver "0 borradas" y que el client lo cuente como éxito.
  if quien is null then
    raise exception 'borrar_mis_datos: no hay usuario autenticado';
  end if;

  delete from public.personas     where user_id = quien;
  get diagnostics n_personas = row_count;

  delete from public.senales      where user_id = quien;
  get diagnostics n_senales = row_count;

  delete from public.predicciones where user_id = quien;
  get diagnostics n_predicciones = row_count;

  delete from public.perfiles     where user_id = quien;
  get diagnostics n_perfiles = row_count;

  delete from public.guias        where user_id = quien;
  get diagnostics n_guias = row_count;

  return jsonb_build_object(
    'personas',     n_personas,
    'senales',      n_senales,
    'predicciones', n_predicciones,
    'perfiles',     n_perfiles,
    'guias',        n_guias
  );
end;
$$;

-- Solo para sesiones autenticadas. El revoke a public es explícito: `create
-- function` concede EXECUTE a public por omisión, así que sin esta línea la
-- función quedaría al alcance del rol anónimo.
revoke execute on function public.borrar_mis_datos() from public;
revoke execute on function public.borrar_mis_datos() from anon;
grant  execute on function public.borrar_mis_datos() to authenticated;
