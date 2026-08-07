-- ============================================================================
-- ajustes_usuario — preferencias de la CUENTA, no del dispositivo
-- ============================================================================
-- Arregla un fallo real: el modo de almacenamiento (local | nube) vivía solo en
-- el localStorage de cada dispositivo. Al entrar con la misma cuenta en otro
-- teléfono la app volvía a preguntar, y si ahí se elegía otra cosa el usuario
-- se quedaba sin sus datos sin que nada fallara visiblemente. Dónde guarda sus
-- datos alguien es una decisión de la cuenta; el dispositivo solo la obedece.
--
-- Decisiones:
--
--  * `user_id` es la PRIMARY KEY, no una columna más con un id aparte. Es una
--    fila por usuario por definición, y hacerlo PK deja que sea el propio
--    esquema quien lo garantice en vez de un índice único añadido después.
--    Además da el `on conflict` que necesita el upsert del client.
--
--  * NO se sincroniza por el outbox ni por el pull incremental como las cinco
--    tablas del dominio. Se lee de una sola vez al entrar, ANTES de montar la
--    app: es justamente lo que decide si el ciclo de sincronización puede
--    correr, así que no puede depender de él.
--
--  * `borrar_mis_datos()` NO la toca, y es a propósito (por eso esta tabla no
--    aparece en aquella función). Esa función es para "vaciar mis datos del
--    servidor" al pasarse a modo local; si de paso borrara esta fila, el modo
--    volvería a quedar sin definir y los demás dispositivos preguntarían otra
--    vez — justo el fallo que esta tabla existe para cerrar. Aquí no hay datos
--    sobre personas, solo una preferencia de dos valores.

create table public.ajustes_usuario (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  modo       text not null check (modo in ('local', 'nube')),
  updated_at timestamptz not null default now()
);

-- Mismo trigger compartido que el resto de tablas (ver 20260731120000). Aquí no
-- alimenta ningún cursor de sincronización: sirve para saber cuál fue el último
-- cambio si alguna vez hay que diagnosticar un desacuerdo entre dispositivos.
create trigger ajustes_usuario_updated_at before update on public.ajustes_usuario
  for each row execute function public.tocar_updated_at();

-- ----------------------------------------------------------------------------
-- RLS — cada quien solo ve y toca su propia fila
-- ----------------------------------------------------------------------------

alter table public.ajustes_usuario enable row level security;

-- El WITH CHECK del insert es lo que impide crear la fila a nombre de otro
-- (el USING solo gobierna lo que se puede leer o alcanzar).
create policy "ajustes propios: leer"       on public.ajustes_usuario for select using (auth.uid() = user_id);
create policy "ajustes propios: insertar"   on public.ajustes_usuario for insert with check (auth.uid() = user_id);
create policy "ajustes propios: actualizar" on public.ajustes_usuario for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- Grants
-- ----------------------------------------------------------------------------
-- IMPRESCINDIBLE: este proyecto no tiene `auto_expose_new_tables`, así que sin
-- GRANT explícito PostgREST responde "permission denied" aunque el RLS esté
-- perfecto. Sin DELETE, como el resto del esquema: cambiar de modo es un
-- UPDATE, y no hay ningún flujo que necesite borrar la fila.

grant select, insert, update on public.ajustes_usuario to authenticated;
