# People — server

Backend mínimo del perfilador. Por ahora hace **una sola cosa**: ser proxy de las
llamadas a la IA, para que las API keys de Groq y Gemini dejen de viajar en el
bundle del client.

Persistencia y sync **todavía no existen** — es el siguiente paso.

```
server/
  supabase/
    config.toml            # proyecto local (project_id = "people")
    .env                   # secrets para desarrollo local — GITIGNOREADO
    functions/
      llm/
        index.ts           # Edge Function: cascada Groq/Gemini
        .env.example       # plantilla de los secrets
```

## Qué hace la función `llm`

Recibe el prompt del client, recorre la cascada de proveedores con las keys que
solo ella conoce, y devuelve el texto. El client no sabe qué proveedor respondió.

**Petición** — `POST /functions/v1/llm`

```jsonc
{
  "tarea": "clasificacion" | "inferencia",  // elige la cascada
  "sistema": "…",                           // system prompt
  "usuario": "…",                           // user prompt
  "maxTokens": 4000,                        // opcional, tope 16000
  "json": true                              // opcional: exige JSON válido y completo
}
```

**Respuesta OK** (HTTP 200)

```jsonc
{ "texto": "…", "proveedor": "groq", "modelo": "llama-3.3-70b-versatile" }
```

**Respuesta con error** (HTTP 400/405/502)

```jsonc
{ "error": { "mensaje": "Cuota agotada en groq", "status": 429 } }
```

El `status` de dentro es el del **proveedor** (0 = red, 429 = cuota, 401 = key
mala…), no el HTTP de la función. El client lo lee del cuerpo y lo propaga tal
cual en `ErrorLLM.status`; la bandeja de captura, por ejemplo, reintenta cuando
ve un 429. El HTTP 502 solo significa "el fallo fue arriba, no aquí".

### Cascadas

| Tarea | Orden de intentos |
|---|---|
| `clasificacion` | Groq `llama-3.3-70b-versatile` → Groq `openai/gpt-oss-120b` → Gemini `gemini-flash-latest` |
| `inferencia` | Gemini `gemini-pro-latest` → Gemini `gemini-flash-latest` → Groq `llama-3.3-70b-versatile` |

Solo se avanza al siguiente intento si el error es **reintentable**: 429 (cuota),
5xx (saturación), fallo de red, respuesta vacía o JSON truncado. Un **400 o 401
corta la cascada de inmediato** — reintentar con otro modelo no arregla una key
mala.

Esta tabla es la **fuente de verdad**. El client tiene una copia declarativa en
`CASCADAS` (`client/src/core/llm.ts`) que solo sirve para etiquetar snapshots de
perfil; si cambias los modelos aquí, actualízala allá.

> Groq se llama con `fetch` directo (formato OpenAI). Gemini necesita el SDK
> oficial (`npm:@google/genai`) porque las keys nuevas en formato `AQ.` no
> autentican contra su endpoint REST crudo.

## Despliegue

Requisitos: [Supabase CLI](https://supabase.com/docs/guides/local-development).
Sin instalarla, todos los comandos funcionan con `npx supabase …`.
Ejecútalos desde `server/` (donde está la carpeta `supabase/`).

**1. Crear el proyecto** en [supabase.com/dashboard](https://supabase.com/dashboard).
Apunta el *Project ref* (el subdominio de la URL), y de *Project Settings → API*
la **Project URL** y la **anon public key**.

**2. Enlazar el repo con el proyecto remoto**

```bash
npx supabase login
npx supabase link --project-ref TU_PROJECT_REF
```

**3. Cargar los secrets** (aquí es donde acaban las keys, y en ningún otro sitio)

```bash
npx supabase secrets set \
  GROQ_API_KEY=gsk_... \
  GEMINI_API_KEY=AQ....
```

O de una vez desde el archivo local:

```bash
npx supabase secrets set --env-file supabase/.env
```

Comprobar que quedaron cargadas (muestra los nombres y un hash, nunca el valor):

```bash
npx supabase secrets list
```

- Groq: [console.groq.com](https://console.groq.com) (sin tarjeta).
- Gemini: [aistudio.google.com](https://aistudio.google.com) (sin tarjeta).

**4. Desplegar**

```bash
npx supabase functions deploy llm
```

**5. Configurar el client** — en `client/.env.local`:

```
VITE_SUPABASE_URL=https://TU_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=TU_ANON_KEY
```

Ambas son públicas por diseño; la anon key está pensada para ir en el bundle.
`VITE_GROQ_API_KEY` y `VITE_GEMINI_API_KEY` ya no se usan: bórralas si quedan.

**6. Probar**

```bash
curl -i -X POST https://TU_PROJECT_REF.supabase.co/functions/v1/llm \
  -H "Authorization: Bearer TU_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"tarea":"clasificacion","sistema":"Responde en una palabra.","usuario":"¿Capital de Francia?","maxTokens":50}'
```

## Desarrollo local

Necesita Docker corriendo.

```bash
npx supabase start                                   # levanta el stack local
npx supabase functions serve llm --env-file supabase/.env
```

La función queda en `http://127.0.0.1:54321/functions/v1/llm`. Para apuntar el
client ahí, en `client/.env.local`:

```
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<la que imprime `supabase start`>
```

`supabase/.env` está gitignoreado y ya tiene las keys que antes vivían en
`client/.env.local`. Nunca lo commitees.

## Logs

```bash
npx supabase functions logs llm            # producción
```

La función loguea qué proveedor respondió, cada intento fallido de la cascada y
el detalle completo de los errores (que al client solo le llega resumido).
Ahí es donde aparece el volcado de `[llm] gemini 400, body enviado:` que sigue
pendiente de diagnosticar.

## Autenticación

`config.toml` deja `verify_jwt = true` para la función: la anon key **es** un JWT
válido, así que la verificación por defecto de Supabase basta para que el proxy
no quede abierto a cualquiera, sin añadir nada en el client. La app es de un solo
usuario y no hay login todavía; cuando lo haya, el mismo header servirá para
verificar la sesión real.

## Inicio de sesión con Google (configuración manual del panel)

El client ya tiene el botón *Continuar con Google* (`features/auth/Login.tsx`,
`signInWithOAuth` con flujo PKCE). Nada de esto funciona hasta hacer a mano lo
siguiente; son cuatro sitios y el orden importa.

### 1. Google Cloud Console — credenciales OAuth

1. *APIs & Services → OAuth consent screen*: tipo **External**, publicando en
   modo **Testing** basta. Añadirse a uno mismo en *Test users*.
2. *APIs & Services → Credentials → Create credentials → OAuth client ID*, tipo
   **Web application**.
3. **Authorized JavaScript origins** — de dónde SALE la petición:
   - `http://localhost:5173`
   - `https://<tu-app>.vercel.app`
4. **Authorized redirect URIs** — aquí va **una sola URL, la de Supabase**, no
   la de la app. Google devuelve el control a Supabase, y es Supabase quien
   luego redirige a la app:

   ```
   https://yucynqzemdvlgzycujqm.supabase.co/auth/v1/callback
   ```

   Es el error clásico: poner aquí `localhost:5173` y ver `redirect_uri_mismatch`.
5. Copiar **Client ID** y **Client secret**.

### 2. Supabase — Authentication → Sign In / Providers → Google

Activar el proveedor y pegar el Client ID y el Client secret del paso anterior.

### 3. Supabase — Authentication → URL Configuration

Esto es lo que autoriza la vuelta de Supabase **a la app** (lo que el client
manda como `redirectTo`, ver `urlDeRetorno()`):

- **Site URL**: `https://<tu-app>.vercel.app`
- **Redirect URLs** (una por línea):
  - `http://localhost:5173/**`
  - `https://<tu-app>.vercel.app/**`
  - `https://<tu-app>-*.vercel.app/**` — solo si quieres que las *preview
    deployments* de Vercel también entren; cada PR estrena subdominio.

Si una URL falta aquí, Google autentica bien pero la vuelta acaba en el login
con "no se pudo canjear la sesión" — el client lo dice con esas palabras.

### Estado: FUNCIONANDO (05-08-2026)

El inicio de sesión con Google está configurado y probado por el usuario de
punta a punta. No hace falta volver a verificarlo. Comprobado además desde
fuera: `/auth/v1/settings` da `google: true`, y seguir el redirect de
`/auth/v1/authorize?provider=google` llega a la pantalla de Google sin
`invalid_client` ni `redirect_uri_mismatch`.

### 4. El alta queda ABIERTA (decisión del 05-08-2026)

La app dejó de ser de un solo usuario: se abre a más gente, empezando por una
segunda persona. Así que **"Allow new users to sign up" se queda ACTIVADO** —
desactivarlo dejaría fuera a cualquier usuario nuevo, que es justo lo que ahora
se quiere permitir.

Consecuencia a tener presente: con Google activo, **cualquiera con cuenta de
Google puede darse de alta**. El aislamiento entre usuarios lo sostiene
enteramente el RLS (`auth.uid() = user_id`) en el servidor... y **NO lo sostiene
todavía el client**, que guarda los datos en una IndexedDB única por navegador.
Ver § "Aislamiento entre usuarios" más abajo.

Si tu cuenta de Google usa el mismo email que tu usuario de contraseña ya
existente, Supabase enlaza las dos identidades en un solo usuario (lo hace
cuando el proveedor verifica el email, y Google lo verifica). Comprobarlo en
*Authentication → Users*: debes seguir apareciendo **una** vez, con dos
identidades.

## Aislamiento entre usuarios

Dos capas, y hacen falta las dos:

- **Servidor**: RLS por `auth.uid() = user_id`. Ya estaba.
- **Client**: una IndexedDB por usuario, `perfilador-<userId>`. Añadido el
  05-08-2026 — antes era una sola base por navegador, y dos personas en el
  mismo navegador se pisaban (la segunda veía los datos de la primera, y el
  outbox de la primera se subía estampado con el `user_id` de la segunda).
  Detalles en `client/CLAUDE.md` § Multiusuario.

### Auditoría de RLS (05-08-2026)

Repasadas las cinco tablas (`personas`, `senales`, `predicciones`, `perfiles`,
`guias`):

- **select / insert / update**: las tres políticas existen en las cinco tablas y
  todas comparan `auth.uid() = user_id` — `using` en select y update,
  `with check` en insert y update. El `with check` del update es lo que impide
  mover una fila propia a otro `user_id`.
- **delete**: no hay ninguna política de delete. Sin política, RLS deniega. Por
  eso vaciar la cuenta va por `borrar_mis_datos()`, que concede exactamente esa
  capacidad y nada más.
- **`user_id`**: `not null default auth.uid()` en las cinco, con FK a
  `auth.users` y `on delete cascade`.

### Verificado contra el proyecto real (no solo leyendo el SQL)

`rls_activo = true` y `politicas = 3` en las cinco tablas. Una petición con la
anon key y sin sesión devuelve `[]` en las cinco: el RLS filtra de verdad.

⚠️ **Y una suposición de la migración inicial que resultó FALSA.** Decía que sin
`grant` explícito una tabla es invisible para la Data API. No lo es: el
bootstrap de Supabase trae `alter default privileges in schema public grant all
on tables to anon, authenticated, service_role`, así que las cinco tablas
nacieron con select, insert, update **y delete** para `anon`, y aquel
`grant ... to authenticated` sumaba en vez de restringir. Medido con
`has_table_privilege`: TRUE en los cuatro, en las cinco tablas.

No era explotable —`anon` no tiene `auth.uid()`, ninguna política le encaja— pero
dejaba el RLS como único muro, con la anon key viajando en el bundle. Corregido
en `20260805140000_revocar_permisos_anon.sql`, que además arregla la causa de
raíz (los default privileges) para que la próxima tabla no repita el patrón.

**Lección para futuras tablas del dominio**: no basta con no dar `grant`. Hay
que revocar, y comprobarlo con `has_table_privilege` en vez de darlo por hecho.

**Aplicado en `ajustes_usuario`** (07-08-2026, `20260807120000_ajustes_usuario.sql`),
que es la sexta tabla y la primera que NO es del dominio: guarda el modo de
almacenamiento, que es una decisión de la CUENTA y no del dispositivo (ver
`client/CLAUDE.md` § Modo de almacenamiento). Lleva las tres políticas de
siempre y `grant select, insert, update ... to authenticated`, sin delete.
Comprobado en vivo contra el proyecto: leer la fila de otro usuario devuelve 0
filas, escribirla da `42501 new row violates row-level security policy`, y una
petición con solo la anon key responde `401 permission denied for table
ajustes_usuario`.

⚠️ `borrar_mis_datos()` **no la toca a propósito**, y no hay que "arreglarlo":
si borrara esa fila, el modo quedaría sin definir y todos los dispositivos
volverían a preguntar — justo el fallo que la tabla cierra. Ahí no hay datos
sobre personas, solo una preferencia de dos valores.

⚠️ **Matiz honesto**: el client SÍ manda `user_id` en cada fila que sube
(`sync.ts`, `filaPersona(p, userId)` y sus hermanas). No se puede falsificar
—el `with check` rechaza cualquier valor distinto de `auth.uid()`, así que lo
peor que consigue un client manipulado es un error—, pero depender del `with
check` es una capa menos que no mandarlo. Dejar de enviarlo haría que aplicara
el `default auth.uid()` en el INSERT y que el UPDATE del upsert no tocara la
columna. Es un cambio pequeño en `sync.ts` y está **pendiente**.

## Aplicar las migraciones

Aplicadas y comprobadas el 05-08-2026: `guias_relacion` (la tabla responde) y
`borrar_mis_datos` (una llamada anónima devuelve `42501 permission denied for
function`, no `PGRST202 could not find the function` — esa diferencia es la
prueba de que la función existe y de que el revoke a `anon` funcionó).

`20260805140000_revocar_permisos_anon.sql` también aplicada y comprobada: las
cinco tablas pasaron de `HTTP 200 []` a `42501 permission denied for table X`
con la anon key, y `/auth/v1/settings` sigue en 200 (el login no depende de
estos permisos). Ya son dos muros independientes: el permiso de tabla y la
política.

## Adopción de la base legada

La primera vez que alguien entra en un navegador que traía la base vieja
(`perfilador`, de la época de un solo usuario), esa base se copia entera a la
suya. **La vieja no se borra**: si tras comprobar que tu app está completa
quieres recuperar el espacio, bórrala a mano desde DevTools → Application →
IndexedDB → `perfilador`.

### Nota para la PWA instalada

El verificador PKCE vive en el `localStorage` del navegador que **inició** el
flujo. Si la PWA instalada abre Google en el navegador del sistema y la vuelta
aterriza allí, el canje falla por verificador ausente. Iniciar y terminar el
flujo en el mismo contexto.

## Todavía NO implementado

- Persistencia (Postgres) y sync con el client — siguiente paso.
- Auth de usuario, RLS, multiusuario.
