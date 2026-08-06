import { NavLink, Route, Routes } from 'react-router-dom';
import { Captura } from './features/captura/Captura';
import { Bandeja } from './features/captura/Bandeja';
import { ListaPersonas } from './features/personas/ListaPersonas';
import { DetallePersona } from './features/personas/DetallePersona';
import { VistaPerfil } from './features/perfil/VistaPerfil';
import { Ajustes } from './features/ajustes/Ajustes';
import { EleccionAlmacenamiento } from './features/almacenamiento/EleccionAlmacenamiento';
import { Login } from './features/auth/Login';
import { AvisoSinConexion } from './ui/EstadoConexion';
import { EstadoSync } from './ui/EstadoSync';
import { useEstaEnLinea } from './ui/useEstaEnLinea';
import { useModoAlmacenamiento } from './ui/useModoAlmacenamiento';
import { useSesion } from './ui/useSesion';
import { useSync } from './ui/useSync';

/** Iconos inline (24px, trazo en currentColor): solo los tres del nav, no
 *  justifican una dependencia ni un sprite. */
const TRAZO = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

function IconoCaptura() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden {...TRAZO}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function IconoPersonas() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden {...TRAZO}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function IconoAjustes() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden {...TRAZO}>
      <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
      <path d="M1 14h6M9 8h6M17 16h6" />
    </svg>
  );
}

/** Mismos destinos arriba (escritorio) y abajo (móvil). */
const NAV = [
  { to: '/', etiqueta: 'captura', Icono: IconoCaptura },
  { to: '/personas', etiqueta: 'personas', Icono: IconoPersonas },
  { to: '/ajustes', etiqueta: 'ajustes', Icono: IconoAjustes },
];

/** Alto reservado por cada franja de estado apilada sobre la barra inferior. */
const ALTO_FRANJA_REM = 2;

function App() {
  const enLinea = useEstaEnLinea();
  const { sesion, cargando, error } = useSesion();
  const { modo, elegir } = useModoAlmacenamiento(sesion?.user.id ?? null);
  // El ciclo de sync solo arranca con sesión resuelta Y en modo nube: sin
  // sesión no hay a quién subir (el RLS filtra por auth.uid()), y en modo local
  // no debe salir nada del dispositivo. `sincronizar()` vuelve a comprobar el
  // modo por su cuenta — esto solo evita montar los temporizadores.
  const sync = useSync(!!sesion && modo === 'nube');

  if (cargando) {
    return <div className="p-6 text-sm opacity-70">Cargando…</div>;
  }

  // Sin base local no hay nada que enseñar: la app entera lee de ahí. Entrar
  // igualmente daría una app vacía que además falla al escribir, que es peor
  // que decirlo.
  if (error) {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-3 p-6">
        <h1 className="text-lg font-medium">No se pudo abrir la app</h1>
        <p className="rounded-lg border border-[var(--error-borde)] bg-[var(--error-bg)] p-3 text-sm text-[var(--error)]">
          {error}
        </p>
        <p className="text-sm opacity-70">
          Suele arreglarse cerrando las otras pestañas de People (y la app instalada) y
          recargando.
        </p>
      </div>
    );
  }

  // Puerta de la app: sin sesión no se muestra nada más. `useSesion` lee de
  // localStorage, así que una sesión ya guardada entra aunque no haya red.
  if (!sesion) {
    return <Login />;
  }

  // Primer arranque de este usuario en este dispositivo: antes de dejarle
  // entrar hay que saber dónde van sus datos. Después ya no sería una elección
  // sobre datos que no han salido de aquí — la app escribe (y en modo nube,
  // sube) desde el primer segundo.
  if (!modo) {
    return <EleccionAlmacenamiento onElegir={elegir} />;
  }

  const franjas = (enLinea ? 0 : 1) + (sync.mostrar ? 1 : 0);

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Escritorio: nav arriba, como estaba. */}
      <nav className="hidden justify-center gap-6 border-b border-[var(--border)] p-3 text-sm md:flex">
        {NAV.map(({ to, etiqueta }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              isActive ? 'text-[var(--accent)]' : 'opacity-70 hover:opacity-100'
            }
          >
            {etiqueta}
          </NavLink>
        ))}
      </nav>

      {/* El padding inferior (--espacio-nav-inferior) evita que la barra móvil
          tape el final de las listas; en escritorio la variable vale 0. A eso
          se le suma el alto de las franjas de estado visibles, que también son
          fijas y si no se comerían las últimas líneas al llegar al fondo.
          En estilo y no en clase: el número de franjas es dinámico y Tailwind
          no puede generar la clase de algo que no ve en el código. */}
      <main
        className="flex flex-1 flex-col"
        style={{
          paddingBottom: `calc(var(--espacio-nav-inferior) + ${franjas * ALTO_FRANJA_REM}rem)`,
        }}
      >
        <Routes>
          <Route path="/" element={<Captura />} />
          <Route path="/bandeja" element={<Bandeja />} />
          <Route path="/personas" element={<ListaPersonas />} />
          <Route path="/personas/:id" element={<DetallePersona />} />
          <Route path="/personas/:id/perfil" element={<VistaPerfil />} />
          <Route path="/ajustes" element={<Ajustes />} />
        </Routes>
      </main>

      {/* Franjas de estado apiladas justo encima de la barra de navegación
          (o abajo del todo en escritorio, donde el nav va arriba). */}
      <div className="fixed inset-x-0 bottom-[calc(var(--nav-inferior)+var(--safe-abajo))] z-30 md:bottom-0">
        {!enLinea && <AvisoSinConexion />}
        {sync.mostrar && (
          <EstadoSync
            pendientes={sync.pendientes}
            subiendo={sync.subiendo}
            progreso={sync.progreso}
            error={sync.error}
            onReintentar={sync.sincronizar}
          />
        )}
      </div>

      {/* Móvil: barra fija abajo, al alcance del pulgar. El padding inferior es
          el safe area de iOS, para no quedar bajo la barra de gestos. */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t border-[var(--border)] bg-[var(--bg)] pb-[var(--safe-abajo)] md:hidden">
        {NAV.map(({ to, etiqueta, Icono }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex min-h-[var(--nav-inferior)] flex-col items-center justify-center gap-0.5 text-xs ${
                isActive ? 'text-[var(--accent)]' : 'opacity-60'
              }`
            }
          >
            <Icono />
            {etiqueta}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export default App;
