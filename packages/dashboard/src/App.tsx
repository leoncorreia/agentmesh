import { NavLink, Route, Routes } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { AgentsPage } from './pages/AgentsPage';
import { AgentDetailPage } from './pages/AgentDetailPage';
import { EventsPage } from './pages/EventsPage';
import { VoicePage } from './pages/VoicePage';
import { SettingsPage } from './pages/SettingsPage';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-2 rounded-md text-sm ${isActive ? 'bg-mesh-accent/20 text-mesh-accent' : 'text-slate-300 hover:text-white'}`;

export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-white/10 px-6 py-4 flex items-center gap-6">
        <div className="text-mesh-accent font-semibold tracking-wide">
          AgentMesh
        </div>
        <nav className="flex gap-2">
          <NavLink to="/" className={linkClass} end>
            Mesh
          </NavLink>
          <NavLink to="/agents" className={linkClass}>
            Agents
          </NavLink>
          <NavLink to="/events" className={linkClass}>
            Events
          </NavLink>
          <NavLink to="/voice" className={linkClass}>
            Voice
          </NavLink>
          <NavLink to="/settings" className={linkClass}>
            Settings
          </NavLink>
        </nav>
      </header>
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/agents/:id" element={<AgentDetailPage />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/voice" element={<VoicePage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
