import { NavLink, Route, Routes } from 'react-router-dom'
import { ClusterDashboard } from './features/cluster/ClusterDashboard'
import { ConnectionsPage } from './features/connections/ConnectionsPage'
import { TabWorkspace } from './features/workspace/TabWorkspace'
import { ThemeProvider, useTheme } from './state/theme'
import { WorkspaceProvider, useWorkspace } from './state/workspace'

const Shell = () => {
  const { theme, toggleTheme } = useTheme()
  const { activeConnectionId, connections, tabs } = useWorkspace()
  const activeName = connections.find(c => c.id === activeConnectionId)?.name

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/logo.png" alt="Meru NoSQL Studio" className="brand-logo" />
          <div>
            <strong>Meru NoSQL Studio</strong>
            <div className="muted sm">OpenSearch console</div>
          </div>
        </div>
        <nav className="nav">
          <NavLink to="/" end>
            Connections
          </NavLink>
          <NavLink to="/cluster">Cluster</NavLink>
          <NavLink to="/workspace">
            Workspace{tabs.length ? ` (${tabs.length})` : ''}
          </NavLink>
        </nav>
        <div className="sidebar-footer">
          {activeName && <div className="muted sm">Active: {activeName}</div>}
          <button type="button" className="btn ghost" onClick={toggleTheme}>
            {theme === 'light' ? 'Dark theme' : 'Light theme'}
          </button>
        </div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<ConnectionsPage />} />
          <Route path="/cluster" element={<ClusterDashboard />} />
          <Route path="/workspace" element={<TabWorkspace />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <WorkspaceProvider>
        <Shell />
      </WorkspaceProvider>
    </ThemeProvider>
  )
}
