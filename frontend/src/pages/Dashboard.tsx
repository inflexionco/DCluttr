/**
 * Dashboard page — NeatDrive home screen.
 *
 * Shows:
 * - Summary stat cards (total files, duplicates, space recoverable, devices)
 * - Storage breakdown donut chart per category
 * - Recent scan jobs feed
 * - Quick action buttons
 */

import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  HardDrive,
  Copy,
  Trash2,
  Plug,
  ScanLine,
  FolderSearch,
  Tag,
  RefreshCw,
} from 'lucide-react'
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { useAppStore } from '../store/useAppStore'

// ── Helpers ───────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function formatNumber(n: number): string {
  return n.toLocaleString()
}

const CATEGORY_COLORS: Record<string, string> = {
  images: '#3b82f6',    // blue-500
  videos: '#8b5cf6',    // violet-500
  documents: '#10b981', // emerald-500
  audio: '#f59e0b',     // amber-500
  other: '#6b7280',     // gray-500
}

// ── Sub-components ────────────────────────────────────────────────────────

interface StatCardProps {
  icon: React.ReactNode
  label: string
  value: string
  subtext?: string
  accent?: string
}

function StatCard({ icon, label, value, subtext, accent = 'text-blue-500' }: StatCardProps) {
  return (
    <div className="bg-slate-800 rounded-xl p-5 flex items-start gap-4 border border-slate-700">
      <div className={`p-2 rounded-lg bg-slate-700 ${accent}`}>{icon}</div>
      <div>
        <p className="text-sm text-slate-400">{label}</p>
        <p className="text-2xl font-semibold text-slate-100 mt-0.5">{value}</p>
        {subtext && <p className="text-xs text-slate-500 mt-1">{subtext}</p>}
      </div>
    </div>
  )
}

interface QuickActionProps {
  icon: React.ReactNode
  label: string
  description: string
  onClick: () => void
  variant?: 'primary' | 'secondary'
}

function QuickAction({ icon, label, description, onClick, variant = 'secondary' }: QuickActionProps) {
  const base = 'flex items-center gap-3 rounded-xl p-4 border cursor-pointer transition-colors'
  const style =
    variant === 'primary'
      ? `${base} bg-blue-600 border-blue-500 hover:bg-blue-500 text-white`
      : `${base} bg-slate-800 border-slate-700 hover:bg-slate-700 text-slate-100`

  return (
    <button className={style} onClick={onClick}>
      <div className="shrink-0">{icon}</div>
      <div className="text-left">
        <p className="font-medium text-sm">{label}</p>
        <p className="text-xs opacity-70 mt-0.5">{description}</p>
      </div>
    </button>
  )
}

// ── Dashboard ─────────────────────────────────────────────────────────────

export default function Dashboard() {
  const navigate = useNavigate()
  const { globalStats, scanJobs, devicesLoading, fetchStats, fetchScanJobs, fetchDevices, devices } =
    useAppStore()

  useEffect(() => {
    fetchStats()
    fetchScanJobs()
    fetchDevices()
  }, [])

  // Build donut chart data from last scan results
  const lastCompletedJob = scanJobs.find((j) => j.status === 'done')
  const chartData = globalStats
    ? Object.entries({
        images: 0,
        videos: 0,
        documents: 0,
        audio: 0,
        other: 0,
      }).map(([key]) => ({
        name: key.charAt(0).toUpperCase() + key.slice(1),
        value: 1, // placeholder — real per-type stats come from scan results
        color: CATEGORY_COLORS[key],
      })).filter((d) => d.value > 0)
    : []

  const stats = globalStats

  return (
    <div className="flex flex-col gap-6 p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Dashboard</h1>
          <p className="text-sm text-slate-400 mt-1">
            Overview of your files, devices, and pending actions
          </p>
        </div>
        <button
          onClick={() => { fetchStats(); fetchScanJobs(); fetchDevices() }}
          className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-100 transition-colors"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          icon={<HardDrive size={20} />}
          label="Files Indexed"
          value={formatNumber(stats?.total_files ?? 0)}
          subtext={formatBytes(stats?.total_size_bytes ?? 0) + ' total'}
          accent="text-blue-400"
        />
        <StatCard
          icon={<Copy size={20} />}
          label="Duplicate Groups"
          value={formatNumber(stats?.duplicate_groups ?? 0)}
          subtext="pending review"
          accent="text-yellow-400"
        />
        <StatCard
          icon={<Trash2 size={20} />}
          label="Space Recoverable"
          value={formatBytes(stats?.space_recoverable_bytes ?? 0)}
          subtext="by resolving duplicates"
          accent="text-red-400"
        />
        <StatCard
          icon={<Plug size={20} />}
          label="Devices Connected"
          value={formatNumber(stats?.connected_devices ?? 0)}
          subtext={`${devices.length} registered`}
          accent="text-green-400"
        />
      </div>

      {/* Main grid: chart + quick actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Storage breakdown donut */}
        <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
          <h2 className="text-base font-semibold text-slate-200 mb-4">Storage Breakdown</h2>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {chartData.map((entry, idx) => (
                    <Cell key={idx} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number) => formatBytes(value)}
                  contentStyle={{
                    backgroundColor: '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: '8px',
                    color: '#f1f5f9',
                  }}
                />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  formatter={(value) => (
                    <span className="text-slate-300 text-xs">{value}</span>
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex flex-col items-center justify-center h-[220px] text-slate-500">
              <HardDrive size={40} className="mb-3 opacity-30" />
              <p className="text-sm">No files indexed yet</p>
              <p className="text-xs mt-1">Run a scan to populate this chart</p>
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
          <h2 className="text-base font-semibold text-slate-200 mb-4">Quick Actions</h2>
          <div className="flex flex-col gap-3">
            <QuickAction
              icon={<ScanLine size={20} />}
              label="Start New Scan"
              description="Index files across connected devices"
              onClick={() => navigate('/scan')}
              variant="primary"
            />
            <QuickAction
              icon={<FolderSearch size={20} />}
              label="Review Duplicates"
              description={
                stats?.duplicate_groups
                  ? `${stats.duplicate_groups} groups pending`
                  : 'No duplicates detected yet'
              }
              onClick={() => navigate('/duplicates')}
            />
            <QuickAction
              icon={<Tag size={20} />}
              label="Smart Rename Queue"
              description="AI-suggested renames awaiting approval"
              onClick={() => navigate('/rename')}
            />
          </div>
        </div>
      </div>

      {/* Recent scan jobs */}
      <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
        <h2 className="text-base font-semibold text-slate-200 mb-4">Recent Activity</h2>
        {scanJobs.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-6">
            No scans run yet. Start a scan to see activity here.
          </p>
        ) : (
          <div className="divide-y divide-slate-700">
            {scanJobs.slice(0, 8).map((job) => (
              <div key={job.id} className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <StatusDot status={job.status} />
                  <div>
                    <p className="text-sm text-slate-200">
                      Scan #{job.id} — {job.scan_depth} scan
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {job.files_indexed.toLocaleString()} files indexed
                      {job.completed_at
                        ? ` · ${new Date(job.completed_at).toLocaleString()}`
                        : ''}
                    </p>
                  </div>
                </div>
                <span
                  className={`text-xs px-2 py-1 rounded-full font-medium ${
                    job.status === 'done'
                      ? 'bg-green-900/40 text-green-400'
                      : job.status === 'failed'
                      ? 'bg-red-900/40 text-red-400'
                      : 'bg-blue-900/40 text-blue-400'
                  }`}
                >
                  {job.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'done'
      ? 'bg-green-500'
      : status === 'failed'
      ? 'bg-red-500'
      : status === 'running'
      ? 'bg-blue-500 animate-pulse'
      : 'bg-slate-500'

  return <span className={`w-2 h-2 rounded-full ${color} shrink-0`} />
}
