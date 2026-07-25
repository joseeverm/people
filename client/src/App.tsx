import { Link, Route, Routes } from 'react-router-dom';
import { Captura } from './features/captura/Captura';
import { Bandeja } from './features/captura/Bandeja';
import { ListaPersonas } from './features/personas/ListaPersonas';
import { DetallePersona } from './features/personas/DetallePersona';
import { VistaPerfil } from './features/perfil/VistaPerfil';
import { Ajustes } from './features/ajustes/Ajustes';

function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <nav className="flex justify-center gap-6 border-b border-[var(--border)] p-3 text-sm">
        <Link to="/" className="opacity-70 hover:opacity-100">
          captura
        </Link>
        <Link to="/personas" className="opacity-70 hover:opacity-100">
          personas
        </Link>
        <Link to="/ajustes" className="opacity-70 hover:opacity-100">
          ajustes
        </Link>
      </nav>
      <Routes>
        <Route path="/" element={<Captura />} />
        <Route path="/bandeja" element={<Bandeja />} />
        <Route path="/personas" element={<ListaPersonas />} />
        <Route path="/personas/:id" element={<DetallePersona />} />
        <Route path="/personas/:id/perfil" element={<VistaPerfil />} />
        <Route path="/ajustes" element={<Ajustes />} />
      </Routes>
    </div>
  );
}

export default App;
