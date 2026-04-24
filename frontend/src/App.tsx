/**
 * Root App component — sets up routing and sidebar navigation.
 */

import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  MonitorSmartphone,
  ScanLine,
  Copy,
  Tag,
  ArrowLeftRight,
  Library,
  Settings,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { useAppStore } from './store/useAppStore'
import Dashboard from './pages/Dashboard'
import DeviceManager from './pages/DeviceManager'
import ScanIndex from './pages/ScanIndex'

// ── Lazy stubs for Phase 2+ pages ─────────────────────────────────────────

function Placeholder({ name }: { name: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-3">
      <p className="text-lg font-semibold text-slate-400">{name}</p>
      <p className="text-sm">Coming in Phase 2</p>
    </div>
  )
}

// ── Nav items ─────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { to: '/', icon: <LayoutDashboard size={18} />, label: 'Dashboard' },
  { to: '/devices', icon: <MonitorSmartphone size={18} />, label: 'Devices' },
  { to: '/scan', icon: <ScanLine size={18} />, label: 'Scan & Index' },
  { to: '/duplicates', icon: <Copy size={18} />, label: 'Duplicates' },
  { to: '/rename', icon: <Tag size={18} />, label: 'Smart Rename' },
  { to: '/transfer', icon: <ArrowLeftRight size={18} />, label: 'File Transfer' },
  { to: '/library', icon: <Library size={18} />, label: 'Library' },
  { to: '/settings', icon: <Settings size={18} />, label: 'Settings' },
]

// ── Sidebar ───────────────────────────────────────────────────────────────

function Sidebar() {
  const { sidebarCollapsed, toggleSidebar } = useAppStore()

  return (
    <aside
      className={`flex flex-col bg-slate-900 border-r border-slate-800 transition-all duration-200 shrink-0 ${
        sidebarCollapsed ? 'w-14' : 'w-52'
      }`}
    >
      {/* Logo */}
      <div className="h-12 flex items-center px-4 border-b border-slate-800 gap-2 shrink-0">
        {!sidebarCollapsed && (
          <span className="text-sm font-bold text-slate-100 tracking-tight">NeatDrive</span>
        )}
      </div>

      {/* Nav links */}
      <nav className="flex-1 py-3 flex flex-col gap-0.5 px-2 overflow-y-auto">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-blue-600/20 text-blue-400'
                  : 'text-slate-500 hover:text-slate-200 hover:bg-slate-800'
              }`
            }
          >
            <span className="shrink-0">{item.icon}</span>
            {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={toggleSidebar}
        className="m-2 p-2 rounded-lg text-slate-600 hover:text-slate-300 hover:bg-slate-800 transition-colors flex items-center justify-center"
      >
        {sidebarCollapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
      </button>
    </aside>
  )
}

// ── App ───────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/devices" element={<DeviceManager />} />
            <Route path="/scan" element={<ScanIndex />} />
            <Route path="/duplicates" element={<Placeholder name="Duplicate Review" />} />
            <Route path="/rename" element={<Placeholder name="Smart Rename" />} />
            <Route path="/transfer" element={<Placeholder name="File Transfer" />} />
            <Route path="/library" element={<Placeholder name="DMS Library" />} />
            <Route path="/settings" element={<Placeholder name="Settings" />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
