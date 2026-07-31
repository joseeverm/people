-- ============================================================================
-- Sincronización — paso 1: esquema espejo de client/src/core/esquema.ts
-- ============================================================================
-- Cuatro tablas, una por entidad sincronizable. `capturasPendientes` NO está
-- aquí a propósito: es una cola local de notas sin clasificar, no un dato del
-- dominio (tampoco viaja en el ExportBundle).
--
-- Decisiones que conviene no revertir sin pensarlo:
--
--  * Los `id` son TEXT y los genera el CLIENT (crypto.randomUUID()). Nada de
--    serials: el client escribe primero en IndexedDB y sube después, así que
--    necesita conocer el id antes de que el servidor lo vea. Es lo que hace
--    que subir dos veces la misma operación sea idempotente.
--
--  * NO hay claves foráneas entre entidades (senales→personas,
--    predicciones→personas). El outbox sube en orden FIFO y una persona
--    siempre se crea antes que sus señales, pero una FK convertiría un fallo
--    puntual en un bloqueo permanente de todo lo que dependa de esa fila.
--    Además `senales.persona_ids` es un array (señales multi-persona), que no
--    admite FK: poner FK solo en unas entidades y no en otras sería incoherente.
--
--  * `updated_at` lo mantiene un trigger, no solo el default. El default solo
--    cubre el INSERT; sin el trigger un UPDATE dejaría la fila con la marca
--    vieja y el pull incremental (siguiente paso) se la saltaría.
--
--  * Sin políticas ni grants de DELETE: las señales son inmutables y los
--    perfiles son snapshots históricos. Lo que no se puede borrar desde la
--    app tampoco debería poder borrarse desde la API.

-- ----------------------------------------------------------------------------
-- Trigger compartido de updated_at
-- ----------------------------------------------------------------------------

create or replace function public.tocar_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- personas
-- ----------------------------------------------------------------------------

create table public.personas (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nombre      text not null,
  aliases     text[] not null default '{}',
  contextos   text[] not null default '{}',
  notas       text,
  creada_en   timestamptz not null,
  archivada   boolean not null default false,
  updated_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- senales (append-only: se insertan, nunca se editan)
-- ----------------------------------------------------------------------------

create table public.senales (
  id             text primary key,
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- La primera es siempre la protagonista (ver Senal.personaIds).
  persona_ids    text[] not null check (array_length(persona_ids, 1) >= 1),
  fecha          timestamptz not null,        -- cuándo OCURRIÓ
  registrada_en  timestamptz not null,        -- cuándo se anotó
  -- Marco social. Opcionales de verdad: 'dato_conocido' y muchas observaciones
  -- no tienen ninguno, y las señales legadas llegan sin el campo.
  compania       text[],
  situacion      text[],
  tipo           text not null check (
                   tipo in ('observacion', 'cita', 'respuesta',
                            'comportamiento', 'dato_conocido', 'verificacion')),
  contenido      text not null,
  -- [{ dominio, capa }] — jsonb y no dos columnas: una señal puede tocar
  -- varios dominios, cada uno a su propia capa.
  etiquetas      jsonb not null default '[]'::jsonb,
  -- Solo si tipo = 'verificacion': qué predicción resuelve.
  prediccion_id  text,
  updated_at     timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- predicciones
-- ----------------------------------------------------------------------------

create table public.predicciones (
  id           text primary key,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  persona_id   text not null,
  dominio      text not null check (
                 dominio in ('identidad_basica', 'cotidianidad', 'gustos_ocio',
                             'trabajo_ambiciones', 'relaciones', 'historia_personal',
                             'valores_creencias', 'miedos_inseguridades', 'autoimagen')),
  -- Solo las 'extrapolada' calibran (ver invariante #8 en client/CLAUDE.md).
  tipo         text not null check (tipo in ('inferida', 'extrapolada')),
  texto        text not null,
  confianza    text not null check (confianza in ('baja', 'media', 'alta')),
  basada_en    text[] not null default '{}',   -- Senal.id[]
  origen       text not null check (origen in ('llm', 'manual')),
  creada_en    timestamptz not null,
  estado       text not null check (
                 estado in ('pendiente', 'acertada', 'parcial', 'fallida', 'descartada')),
  resuelta_por text,                            -- Senal.id de la verificación
  updated_at   timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- perfiles (snapshots regenerables; nunca se editan a mano)
-- ----------------------------------------------------------------------------

create table public.perfiles (
  id                      text primary key,
  user_id                 uuid not null default auth.uid() references auth.users (id) on delete cascade,
  persona_id              text not null,
  generado_en             timestamptz not null,
  ultima_senal_incluida   text not null,        -- permite regeneración incremental
  num_senales             integer not null,
  modelo                  text not null,
  resumen                 text not null,
  -- Las cinco listas de Afirmacion y el resto de estructuras van como jsonb:
  -- son salida del LLM, se leen enteras y nunca se consultan por campo.
  rasgos                  jsonb not null default '[]'::jsonb,
  gustos                  jsonb not null default '[]'::jsonb,
  disgustos               jsonb not null default '[]'::jsonb,
  motivaciones            jsonb not null default '[]'::jsonb,
  temas_sensibles         jsonb not null default '[]'::jsonb,
  contradicciones         jsonb not null default '[]'::jsonb,
  por_marco_social        jsonb not null default '{}'::jsonb,
  huecos                  jsonb not null default '[]'::jsonb,
  predicciones_propuestas jsonb not null default '[]'::jsonb,
  updated_at              timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Índices
-- ----------------------------------------------------------------------------

-- (user_id, updated_at): el patrón exacto del pull incremental — "dame lo mío
-- cambiado desde X". Compuesto porque RLS filtra siempre por user_id primero.
create index personas_user_updated_idx     on public.personas     (user_id, updated_at);
create index senales_user_updated_idx      on public.senales      (user_id, updated_at);
create index predicciones_user_updated_idx on public.predicciones (user_id, updated_at);
create index perfiles_user_updated_idx     on public.perfiles     (user_id, updated_at);

-- Consultas por persona (las que ya hace el client: senalesDe, prediccionesDe).
create index senales_persona_ids_idx  on public.senales      using gin (persona_ids);
create index predicciones_persona_idx on public.predicciones (persona_id);
create index perfiles_persona_idx     on public.perfiles     (persona_id);

-- ----------------------------------------------------------------------------
-- Triggers de updated_at
-- ----------------------------------------------------------------------------

create trigger personas_updated_at     before update on public.personas
  for each row execute function public.tocar_updated_at();
create trigger senales_updated_at      before update on public.senales
  for each row execute function public.tocar_updated_at();
create trigger predicciones_updated_at before update on public.predicciones
  for each row execute function public.tocar_updated_at();
create trigger perfiles_updated_at     before update on public.perfiles
  for each row execute function public.tocar_updated_at();

-- ----------------------------------------------------------------------------
-- RLS — cada quien solo ve y toca lo suyo
-- ----------------------------------------------------------------------------

alter table public.personas     enable row level security;
alter table public.senales      enable row level security;
alter table public.predicciones enable row level security;
alter table public.perfiles     enable row level security;

-- El WITH CHECK del insert impide escribir filas a nombre de otro user_id
-- (el USING solo gobierna qué se puede leer/alcanzar).
create policy "personas propias: leer"      on public.personas     for select using (auth.uid() = user_id);
create policy "personas propias: insertar"  on public.personas     for insert with check (auth.uid() = user_id);
create policy "personas propias: actualizar" on public.personas    for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "senales propias: leer"       on public.senales      for select using (auth.uid() = user_id);
create policy "senales propias: insertar"   on public.senales      for insert with check (auth.uid() = user_id);
create policy "senales propias: actualizar" on public.senales      for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "predicciones propias: leer"       on public.predicciones for select using (auth.uid() = user_id);
create policy "predicciones propias: insertar"   on public.predicciones for insert with check (auth.uid() = user_id);
create policy "predicciones propias: actualizar" on public.predicciones for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "perfiles propios: leer"       on public.perfiles     for select using (auth.uid() = user_id);
create policy "perfiles propios: insertar"   on public.perfiles     for insert with check (auth.uid() = user_id);
create policy "perfiles propios: actualizar" on public.perfiles     for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- Grants
-- ----------------------------------------------------------------------------
-- IMPRESCINDIBLE: este proyecto NO tiene `auto_expose_new_tables` activo (ver
-- server/supabase/config.toml), así que una tabla nueva es invisible para la
-- Data API hasta que se le da GRANT explícito. Sin esto, PostgREST responde
-- "permission denied" aunque las políticas RLS sean correctas.
-- Sin DELETE: nada de lo que hay aquí se borra (ver cabecera).

grant select, insert, update on public.personas     to authenticated;
grant select, insert, update on public.senales      to authenticated;
grant select, insert, update on public.predicciones to authenticated;
grant select, insert, update on public.perfiles     to authenticated;
