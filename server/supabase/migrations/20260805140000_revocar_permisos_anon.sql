-- ============================================================================
-- Quitar al rol anónimo los permisos de tabla que nunca debió tener
-- ============================================================================
-- Medido el 05-08-2026 contra el proyecto real, con la anon key y sin sesión:
-- las cinco tablas respondían HTTP 200 (no "permission denied"), y
-- has_table_privilege('anon', ...) daba TRUE para select, insert, update Y
-- delete en las cinco.
--
-- Por qué pasó: la migración inicial daba por hecho que sin `grant` explícito
-- una tabla es invisible para la Data API. No es cierto en un proyecto
-- Supabase — el bootstrap incluye
--     alter default privileges in schema public
--       grant all on tables to anon, authenticated, service_role;
-- así que toda tabla nueva nace con permisos para los tres roles y aquel
-- `grant select, insert, update to authenticated` sumaba en vez de restringir.
--
-- ¿Había un agujero? NO, y conviene decirlo con precisión para no exagerar el
-- arreglo: el RLS está activo en las cinco tablas y todas las políticas exigen
-- `auth.uid() = user_id`. Para `anon`, `auth.uid()` es null, así que ninguna
-- fila encaja; y para DELETE no hay política ninguna, y sin política RLS
-- deniega. Comprobado: las cinco devolvían `[]`, no filas.
--
-- Entonces por qué tocarlo: porque hoy el ÚNICO muro es el RLS, y la anon key
-- viaja en el bundle del client, a la vista de cualquiera. Con esto vuelven a
-- ser dos muros independientes — el permiso de tabla y la política — y hace
-- falta equivocarse en los dos para exponer algo. Es defensa en profundidad,
-- no un parche de urgencia.

-- ----------------------------------------------------------------------------
-- 1. Las cinco tablas de hoy
-- ----------------------------------------------------------------------------
-- `anon` no tiene nada que hacer en el dominio: la app exige sesión para todo
-- lo que toque datos. El login NO se ve afectado — GoTrue vive en /auth/v1 y no
-- pasa por estos permisos.

revoke all on public.personas     from anon;
revoke all on public.senales      from anon;
revoke all on public.predicciones from anon;
revoke all on public.perfiles     from anon;
revoke all on public.guias        from anon;

-- DELETE tampoco para `authenticated`: es lo que la migración inicial quiso
-- decir y no llegó a conseguir. Las señales son inmutables y los perfiles son
-- snapshots históricos; lo único que puede borrar es `borrar_mis_datos()`, que
-- es `security definer` y por tanto NO necesita que quien la llama tenga este
-- permiso. Vaciar la cuenta entera sigue funcionando; borrar una fila suelta
-- desde la API deja de ser expresable.

revoke delete on public.personas     from authenticated;
revoke delete on public.senales      from authenticated;
revoke delete on public.predicciones from authenticated;
revoke delete on public.perfiles     from authenticated;
revoke delete on public.guias        from authenticated;

-- Lo que `authenticated` conserva (y la app necesita): select, insert, update.
-- No se re-conceden aquí — ya los tiene de la migración inicial.

-- ----------------------------------------------------------------------------
-- 2. La causa de raíz: las tablas FUTURAS
-- ----------------------------------------------------------------------------
-- Sin esto, la próxima tabla del dominio vuelve a nacer con permisos para
-- `anon` y este arreglo dura hasta la siguiente migración. `for role postgres`
-- porque es el rol con el que corren las migraciones, y los default privileges
-- se aplican por rol CREADOR.
--
-- Ojo si alguna vez se añade una tabla pensada para lectura pública (no hay
-- ninguna hoy, ni debería en esta app): tendría que concederle el select a
-- `anon` explícitamente, que es justo lo que se quiere — explícito.

alter default privileges for role postgres in schema public
  revoke all on tables from anon;

alter default privileges for role postgres in schema public
  revoke delete on tables from authenticated;
