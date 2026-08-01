-- ============================================================================
-- Guías de relación — quinta entidad sincronizable
-- ============================================================================
-- El perfil responde "quién es esta persona"; la guía responde "cómo me
-- relaciono mejor con ella". Se genera a partir del perfil más la progresión
-- de capas derivada de las señales (ver client/src/core/guia-relacion.ts).
--
-- Sigue exactamente las decisiones de la migración inicial, y por las mismas
-- razones (ver 20260731120000_sync_inicial.sql):
--
--  * `id` TEXT generado por el CLIENT: escribe en IndexedDB primero y sube
--    después, así que necesita el id antes de que el servidor vea la fila. Es
--    lo que hace idempotente subir dos veces la misma operación.
--
--  * Sin FK a `personas`: el outbox sube en orden FIFO y la persona siempre va
--    antes, pero una FK convertiría un fallo puntual en un bloqueo permanente.
--
--  * `updated_at` por trigger, no solo por default: el default solo cubre el
--    INSERT, y sin trigger un UPDATE dejaría la marca vieja y el pull
--    incremental se saltaría la fila.
--
--  * Sin DELETE en políticas ni grants: la guía es un SNAPSHOT histórico, como
--    los perfiles. Se agregan, nunca se editan ni se borran.

create table public.guias (
  id                     text primary key,
  user_id                uuid not null default auth.uid() references auth.users (id) on delete cascade,
  persona_id             text not null,
  generada_en            timestamptz not null,
  ultima_senal_incluida  text not null,   -- para saber si la guía se quedó atrás
  modelo                 text not null,
  -- Los cinco bloques son listas de Afirmacion (el mismo tipo que usa el
  -- perfil): salida del LLM, se leen enteras y nunca se consultan por campo.
  -- El default '[]' importa: un bloque VACÍO es un resultado válido y con
  -- significado —dice qué falta observar—, no un error de generación.
  terreno_fertil         jsonb not null default '[]'::jsonb,
  terreno_minado         jsonb not null default '[]'::jsonb,
  como_se_abre           jsonb not null default '[]'::jsonb,
  que_valora_en_la_gente jsonb not null default '[]'::jsonb,
  siguiente_paso         jsonb not null default '[]'::jsonb,
  updated_at             timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Índices
-- ----------------------------------------------------------------------------

-- (user_id, updated_at): el patrón exacto del pull incremental.
create index guias_user_updated_idx on public.guias (user_id, updated_at);
-- La consulta del client es siempre "la última guía de esta persona".
create index guias_persona_idx      on public.guias (persona_id);

-- ----------------------------------------------------------------------------
-- Trigger de updated_at
-- ----------------------------------------------------------------------------

create trigger guias_updated_at before update on public.guias
  for each row execute function public.tocar_updated_at();

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

alter table public.guias enable row level security;

create policy "guias propias: leer"       on public.guias for select using (auth.uid() = user_id);
create policy "guias propias: insertar"   on public.guias for insert with check (auth.uid() = user_id);
create policy "guias propias: actualizar" on public.guias for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- Grants
-- ----------------------------------------------------------------------------
-- IMPRESCINDIBLE: este proyecto NO tiene `auto_expose_new_tables`, así que una
-- tabla nueva es invisible para la Data API hasta que se le da GRANT explícito.
-- Sin esto PostgREST responde "permission denied" aunque el RLS esté bien.

grant select, insert, update on public.guias to authenticated;
