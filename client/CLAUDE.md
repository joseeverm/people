# People — client

Aplicación **personal y de un solo usuario** para modelar a las personas que conozco:
registro señales (hechos observados sobre ellas), un motor LLM infiere perfiles
(gustos, disgustos, motivaciones, contradicciones), y un sistema de niveles mide
cuánto conozco a cada una. Nadie más usa esta app; las personas analizadas no la ven.

## Estado del proyecto

- **Fase actual: client + proxy de IA.** `../server/` ya es un proyecto de Supabase
  con UNA Edge Function (`llm`): las llamadas a Groq/Gemini pasan por ahí y las
  API keys viven como secrets del servidor, no en el bundle. Ver `../server/README.md`.
- **Los datos siguen 100% locales** (IndexedDB vía Dexie). Persistencia y sync en
  el server son el siguiente paso, todavía sin empezar.
- Por eso TODO acceso a datos pasa por la interfaz `Repository` — nunca llamar
  Dexie directo desde componentes.

## Stack

- React + Vite + TypeScript, gestor de paquetes **pnpm** (nunca npm/yarn).
- PWA (vite-plugin-pwa): la captura debe funcionar sin conexión (zona rural).
- Dexie para IndexedDB.
- Estilos: Tailwind.
- Sin router pesado: la app son pocas vistas (captura, bandeja, personas, detalle,
  perfil, ajustes); react-router-dom básico es suficiente.

## Arquitectura (capas, de abajo hacia arriba)

```
src/
  core/            # dominio puro, sin React ni IO
    esquema.ts         # ← YA EXISTE: tipos, taxonomía, niveles, pesoEfectivo, calcularNivel.
                        #   TipoSenal: observacion/cita/respuesta/comportamiento/dato_conocido/
                        #   verificacion (pesos en PESO_TIPO). MARCO SOCIAL (NO lugar físico) en
                        #   dos ejes opcionales: Senal.compania?: string[] (con quién: amigos,
                        #   familia, pareja, solo_conmigo, desconocidos, trabajo) y
                        #   Senal.situacion?: string[] (bajo qué marco: cotidiano, fiesta,
                        #   conflicto, bajo_presion, intimo, publico). Ambos AMPLIABLES
                        #   (vocabularios sugeridos COMPANIA_SUGERIDA/SITUACION_SUGERIDA, no
                        #   cerrados) y OPCIONALES: dato_conocido y muchas observaciones no
                        #   tienen ninguno; NO se inventan valores para rellenar. Opcionales `?`
                        #   a propósito: las señales legadas (previas al cambio, incl. el viejo
                        #   `contexto`) llegan sin estos campos → todo consumidor usa `?? []`.
                        #   No hay migración. Prediccion.tipo: 'inferida' (se sigue de las
                        #   señales, síntesis, casi imposible de fallar) | 'extrapolada' (patrón
                        #   extendido a situación NO observada, arriesgada, la que mide de verdad).
    llm.ts              # ← YA EXISTE: única frontera con la IA. UN solo fetch a la Edge
                        #   Function `llm` del server; la cascada Groq/Gemini y las keys
                        #   viven allá. Interfaz pública intacta (pedirLLM/pedirJSON/ErrorLLM).
    motor-inferencia.ts# ← YA EXISTE: prompt + generarPerfil + validarEvidencia. Señales sin
                        #   marco social (compania y situacion vacíos) NO aportan a
                        #   `porMarcoSocial` del perfil (sí cuentan como evidencia normal para
                        #   el resto). El prompt pide dos clases de predicción (inferida +
                        #   extrapolada, ver esquema.ts) y busca CRUCES compañía×situación.
    clasificador.ts    # ← YA EXISTE: texto crudo + persona YA asignada a mano → propuesta de
                        #   Senal (contenido/tipo/compania/situacion/etiquetas). NO resuelve
                        #   identidad.
    conocimiento.ts    # ← YA EXISTE: calcula EstadoConocimiento desde señales. calcularCalibracion
                        #   (tasaAcierto) cuenta SOLO predicciones 'extrapolada' resueltas — las
                        #   'inferida' inflarían la calibración (casi imposibles de fallar).
  data/
    repository.ts      # ← YA EXISTE: interfaz Repository (contrato de persistencia)
    dexie-repo.ts      # ← YA EXISTE: implementación actual (IndexedDB)
    export.ts          # ← YA EXISTE: ExportBundle → descarga JSON (people-backup-AAAA-MM-DD.json)
                        #   + lectura/validación de un archivo antes de importar
                        #   (validarExportBundle lanza ErrorImport; si lanza NO se toca la base).
                        #   El reemplazo en sí lo hace repo.importar() (transacción).
  features/
    captura/           # ← YA EXISTE: caja de texto + cola offline + asignación manual de
                        #   persona (AsignarPersona) + clasificador + confirmación
                        #   (TarjetaPropuesta.tsx). Contenido, tipo, compañía, situación y
                        #   etiquetas SIEMPRE editables (haya o no aclaraciones del clasificador)
                        #   — pero si la propuesta ya viene completa, un solo toque en
                        #   "Confirmar" basta. Dos selectores multivalor ("¿Con quién?" /
                        #   "¿En qué situación?"): cada uno muestra su vocabulario sugerido +
                        #   valores ya usados en otras señales y permite agregar nuevos;
                        #   ambos pueden quedar vacíos (normaliza minúsculas/sin tildes, dedup).
    personas/          # ← YA EXISTE: lista + alta + detalle placeholder (nombre, nivel, radar)
    perfil/            # ← YA EXISTE: pestañas "Perfil" (resumen, afirmaciones, contradicciones,
                        #   marco social, huecos con preguntas copiables, botón regenerar),
                        #   "Señales" (VistaSenales.tsx: cronología inversa, solo lectura, chips
                        #   de compañía/situación) y "Predicciones" (PestanaPredicciones).
                        #   Encabezado muestra nivel + calibración (tasaAcierto o "faltan N").
    predicciones/      # ← YA EXISTE (paso 5): pestaña DENTRO del perfil de cada persona
                        #   (PestanaPredicciones). Pendientes divididas en dos secciones:
                        #   'extrapolada' ("Puestas a prueba", calibran) e 'inferida'
                        #   ("Se sigue de lo que sabes", no calibran). Resolver (acertó/parcial/
                        #   falló) pide texto y crea una Senal 'verificacion' inmutable atada a
                        #   la predicción (resolver.ts + repo.resolverPrediccionConVerificacion,
                        #   atómico y con guarda de doble resolución). Alta manual (NuevaPrediccion,
                        #   origen 'manual', elige tipo). NO hay vista global en la nav.
    ajustes/           # ← YA EXISTE (paso 6): Ajustes.tsx — exportar copia (con resumen
                        #   "exportadas N personas, M señales") e importar (DESTRUCTIVO:
                        #   compara lo que hay ahora vs. lo que trae el archivo y exige
                        #   confirmación explícita antes de reemplazar).
  App.tsx              # ← YA EXISTE: routing (react-router-dom) + nav mínima (captura, personas, ajustes)
```

## Invariantes — NO romper nunca

1. **Las señales son inmutables.** Solo se crean; jamás update ni delete de una
   `Senal` confirmada. Correcciones = nueva señal.
   *Única excepción, y no la aflojes:* `repo.importar()` (restaurar un backup)
   vacía y repuebla las tablas enteras. Es un reemplazo de TODA la base bajo
   confirmación explícita del usuario, no una edición de señales — no sirve de
   precedente para borrar una `Senal` suelta desde ningún otro sitio.
2. **El nivel jamás se almacena.** Siempre `calcularNivel()` al vuelo. Nada de
   campos `nivel` en la tabla de personas.
3. **Los perfiles jamás se editan a mano.** Solo los produce `generarPerfil()`.
   Cada generación es un snapshot nuevo (histórico completo, no se sobreescriben).
4. **Ninguna afirmación sin evidencia.** `validarEvidencia()` corre SIEMPRE antes
   de persistir un perfil; si lanza, el perfil se descarta y se reintenta.
5. **La captura nunca se pierde.** Escribir primero a `CapturaPendiente` local;
   clasificar y confirmar después. Sin red = la cola espera.
6. **Todo el dominio vive en `core/`** sin dependencias de React/Dexie, para que
   el server lo reutilice tal cual más adelante.
7. **La identidad de la persona en una señal se asigna A MANO, nunca por IA.**
   El usuario elige la persona (y, si aplica, secundarias) en la bandeja de
   confirmación ANTES de clasificar (`AsignarPersona.tsx`); esa asignación se
   persiste en `CapturaPendiente.personaId`/`personaIdsSecundarios` para no
   perderla si sales de la vista. El clasificador (`clasificador.ts`) recibe
   la persona ya resuelta y solo estructura contenido/tipo/compania/situacion/
   etiquetas — nunca decide de quién es la nota. Ahorra tokens (no hay que
   mandarle el catálogo completo) y elimina el riesgo de que el LLM alucine una
   identidad y envenene el perfil de la persona equivocada.
8. **La calibración solo la miden las predicciones 'extrapolada'.** Una
   predicción resuelta genera una `Senal` tipo 'verificacion' inmutable como
   cualquier otra; una predicción ya resuelta NO se puede volver a resolver
   (guarda en el repo, transacción atómica). Solo las 'extrapolada' cuentan para
   `tasaAcierto`/`prediccionesResueltas`; las 'inferida' se resuelven igual pero
   no calibran (inflarían la métrica).

## Interfaz Repository (contrato)

```ts
interface Repository {
  // personas
  listarPersonas(): Promise<Persona[]>;
  crearPersona(p: Omit<Persona, 'id' | 'creadaEn'>): Promise<Persona>;
  actualizarPersona(p: Persona): Promise<void>; // aliases/contextos sí son editables
  // señales (append-only)
  agregarSenal(s: Omit<Senal, 'id'>): Promise<Senal>;
  senalesDe(personaId: string): Promise<Senal[]>;
  todasLasSenales(): Promise<Senal[]>; // sugerir compania/situacion ya usadas en captura
  // cola de captura
  encolarCaptura(texto: string): Promise<CapturaPendiente>;
  pendientes(): Promise<CapturaPendiente[]>;
  asignarPersonasCaptura(idLocal: string, personaId: string, personaIdsSecundarios?: string[]): Promise<void>;
  resolverCaptura(idLocal: string, senal: Omit<Senal, 'id'>): Promise<void>;
  // predicciones
  guardarPrediccion(p: Omit<Prediccion, 'id' | 'creadaEn'>): Promise<Prediccion>;
  resolverPrediccion(id: string, estado: Prediccion['estado'], senalVerificacion: string): Promise<void>;
  // resolución atómica: crea la Senal 'verificacion' + marca la predicción (guarda doble resolución)
  resolverPrediccionConVerificacion(
    prediccionId: string,
    estado: 'acertada' | 'parcial' | 'fallida',
    senal: Omit<Senal, 'id'>
  ): Promise<Senal>;
  prediccionesDe(personaId: string): Promise<Prediccion[]>;
  // perfiles (snapshots)
  guardarPerfil(p: Omit<PerfilGenerado, 'id'>): Promise<PerfilGenerado>;
  ultimoPerfil(personaId: string): Promise<PerfilGenerado | null>;
  // export
  exportar(): Promise<ExportBundle>;
  // DESTRUCTIVO: clear + bulkAdd de las 4 tablas del bundle en una transacción
  // (no fusiona). NO toca capturasPendientes: el bundle no la incluye y
  // borrarla perdería notas sin clasificar que ningún backup devuelve.
  importar(b: ExportBundle): Promise<void>;
}
```

## API de IA (vía Edge Function; Groq + Gemini repartidos por tarea)

- Toda llamada a la IA pasa por `core/llm.ts` — es la ÚNICA frontera. El
  dominio (`clasificador.ts`, `motor-inferencia.ts`) llama a
  `pedirJSON()`/`pedirLLM()` pasando una **cascada** (`Intento[]`) y no sabe
  qué proveedor respondió al otro lado.
- **`llm.ts` ya NO habla con los proveedores**: hace UN solo POST a la Edge
  Function `llm` del server (`server/supabase/functions/llm/index.ts`) con
  `{ tarea, sistema, usuario, maxTokens, json }` y recibe `{ texto }` o
  `{ error: { mensaje, status } }`. La `tarea` se deduce de la cascada que
  pasó el dominio (`tareaDe()`), así la interfaz pública no cambió.
- **La cascada, los reintentos y las keys viven en el server.** Ahí está la
  fuente de verdad de qué modelos se usan y en qué orden; el `CASCADAS` del
  client es una copia declarativa que solo sirve para etiquetar el campo
  `modelo` de un snapshot de perfil. Si cambias una, cambia la otra.
- **Reparto por tarea, cada una con respaldo cruzado en el otro proveedor**:
  - **Clasificación** (`CASCADAS.clasificacion`) → Groq primero (alto
    volumen, tarea mecánica, Groq es gratis/rápido) → respaldo Gemini Flash.
  - **Inferencia de perfil** (`CASCADAS.inferencia`) → Gemini primero (bajo
    volumen, la calidad manda) → respaldo Groq (peor calidad, mantiene el
    servicio vivo si Gemini falla).
  - El server recorre la cascada en orden y solo avanza al siguiente intento
    si el error es reintentable (429, 5xx, red, JSON truncado); un 401/400
    corta la cascada de inmediato (una key mala no se arregla cambiando de
    modelo). Lo que llega al client es ya el veredicto final.
  - `maxTokens` por tarea: inferencia de perfil 8000 (evidencia + afirmaciones
    generan bastante más texto que una clasificación), clasificación 2000.
    Si un perfil vuelve a truncarse, subir de nuevo antes que tocar el prompt.
  - JSON truncado (`maxTokens` corto) se detecta **en el server**, dentro de su
    bucle de cascada, para poder probar el siguiente proveedor en vez de
    fallar del todo. `pedirJSON()` en el client solo parsea lo ya validado.
- Por qué el server tiene dos implementaciones (detalle que ya no toca al client):
  - **Groq**: compatible con el formato OpenAI → `fetch` directo, simple.
  - **Gemini**: SDK oficial `@google/genai` (`GoogleGenAI`), NO `fetch`
    crudo: las API keys nuevas en formato `AQ.` no autentican contra
    `generativelanguage.googleapis.com/v1beta/.../generateContent` (dan
    404/401 aunque la key sea válida). El SDK sí soporta ambos formatos
    (`AIza...` y `AQ...`).
- **En `.env.local` solo quedan `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`**
  (ambas públicas por diseño). `VITE_GROQ_API_KEY`/`VITE_GEMINI_API_KEY` están
  ELIMINADAS: no volver a introducir una key de proveedor en el client, ni
  siquiera "temporalmente para probar". `@google/genai` tampoco es dependencia
  del client. Las keys se cargan con `supabase secrets set` (server/README.md).
- Los nombres de modelo (Groq y Gemini) cambian con frecuencia; si alguno da
  404, probar otro alias del catálogo vigente de ese proveedor.
  Regeneración incremental de perfiles (perfil previo + señales nuevas);
  completa cada 5 incrementales (ver `Config`).
- Errores tipados vía `ErrorLLM` (mensaje legible + status: sin conexión, key
  inválida, límite de peticiones, respuesta bloqueada/vacía, más el
  proveedor que falló). El `status` es el del PROVEEDOR, no el HTTP de la Edge
  Function: viene dentro del cuerpo del error. La UI debe mostrarlos, no
  tragárselos silenciosamente.
- ⚠️ **Bug abierto: Gemini Flash devuelve 400 INVALID_ARGUMENT.** Se sospechaba
  de `thinkingConfig` (los modelos "pro" no aceptan desactivar el thinking,
  solo "flash"), pero tras filtrar por nombre de modelo el 400 seguía
  apareciendo en Flash. Como diagnóstico, `thinkingConfig` está QUITADO POR
  COMPLETO en `llamarGemini` (ni para pro ni para flash) — falta confirmar qué
  campo del `config` rechaza realmente la API antes de reintroducirlo. El
  volcado ahora sale en los logs del server (`supabase functions logs llm`),
  no en la consola del navegador.
- **Rate limit**: la bandeja clasifica notas EN SERIE, nunca en paralelo —
  pausa de ~4s entre peticiones y un reintento a los 10s si el proveedor
  responde 429 (ver `Bandeja.tsx`). No volver a paralelizar con
  `Promise.all`/`Promise.allSettled`: dispara 429 de inmediato con más de
  una nota.

## MVP (en orden)

1. ✅ Scaffold + Dexie + Repository. (Sin tabla de seed para los dominios: los
   9 `DOMINIOS` ya son la fuente de verdad como const tipado en esquema.ts, y
   el nivel/cobertura se calculan siempre al vuelo — no hay nada que persistir.)
2. ✅ **Captura**: caja de texto → cola → asignación manual de persona
   (sin IA) → clasificador (con IA: tipo/compañía/situación/etiquetas) →
   confirmación → Senal. La identidad NUNCA la resuelve la IA (ver Invariantes #7).
   (Es la pantalla principal; abrir la app = poder anotar en <15 segundos.)
3. ✅ **Personas**: lista con nombre, nivel calculado y dominios cubiertos.
   El detalle (`/personas/:id`) por ahora es solo placeholder: encabezado +
   radar, sin señales/perfil/huecos.
4. ✅ **Perfil**: pestaña "Perfil" (último snapshot, afirmaciones con estatus
   hecho/inferencia/especulación y evidencia expandible, contradicciones, marco
   social, huecos con preguntas copiables, botón regenerar manual) + pestaña
   "Señales" (cronología inversa, solo lectura).
5. ✅ **Predicciones**: pestaña dentro del perfil de cada persona. Pendientes en
   dos secciones (extrapolada/inferida), resolver con un toque (crea Senal
   'verificacion'), alta manual. Sin vista global en la nav (se quitó a propósito).
6. ✅ **Export/Import JSON**: vista `/ajustes`. Export descarga todo (incluidos
   todos los snapshots de perfiles); base vacía produce un bundle vacío válido.
   Import valida primero (version 1 + los cuatro arrays + `id` en cada registro)
   y es DESTRUCTIVO: `repo.importar()` hace clear + bulkAdd en una transacción.
   NO borra `capturasPendientes` (el bundle no las incluye; borrarlas perdería
   notas sin clasificar que ningún backup devuelve).
7. PWA offline (config mínima ya en `vite.config.ts`, falta activarla de verdad).

## Fuera de alcance (no implementar aunque parezca buena idea)

- Auth, multiusuario, compartir perfiles.
- Grafo de relaciones entre personas (el esquema ya lo soporta vía `personaIds[]`;
  la UI llegará después).
- Edición manual de perfiles generados.
- Cifrado en client (llega junto con el server/sync).

## Convenciones

- Español para dominio, tipos y UI (código de infraestructura puede usar inglés).
- Componentes de función + hooks; sin clases.
- Sin librerías de estado global: el estado vive en hooks por feature +
  el Repository. Si algo se comparte, contexto de React simple.
- Commits en español, imperativo: "agrega cola de captura offline".
