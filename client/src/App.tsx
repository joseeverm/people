import { NavLink, Route, Routes } from 'react-router-dom';
import { Captura } from './features/captura/Captura';
import { Bandeja } from './features/captura/Bandeja';
import { ListaPersonas } from './features/personas/ListaPersonas';
import { DetallePersona } from './features/personas/DetallePersona';
import { VistaPerfil } from './features/perfil/VistaPerfil';
import { Ajustes } from './features/ajustes/Ajustes';
import { AvisoSinConexion } from './ui/EstadoConexion';
import { useEstaEnLinea } from './ui/useEstaEnLinea';

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

function App() {
  const enLinea = useEstaEnLinea();

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
          tape el final de las listas; en escritorio la variable vale 0. Sin
          conexión se le suma el alto de la franja de aviso, que también es
          fija y si no se comería las últimas líneas al llegar al fondo. */}
      <main
        className={`flex flex-1 flex-col ${
          enLinea
            ? 'pb-[var(--espacio-nav-inferior)]'
            : 'pb-[calc(var(--espacio-nav-inferior)_+_2rem)]'
        }`}
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

      {!enLinea && <AvisoSinConexion />}

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
