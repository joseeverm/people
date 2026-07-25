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

## Todavía NO implementado

- Persistencia (Postgres) y sync con el client — siguiente paso.
- Auth de usuario, RLS, multiusuario.
