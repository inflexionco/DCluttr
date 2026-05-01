/**
 * Scan & Index page — DCluttr
 * Provides device/folder selector, file type icon-grid filters,
 * advanced options accordion (depth + exclusions), and live ProgressStream.
 */

import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  ScanLine,
  ChevronDown,
  ChevronUp,
  FolderOpen,
  Image,
  Film,
  FileText,
  Music,
  File,
  CheckCircle2,
  HardDrive,
} from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { ProgressStream } from '../components/ProgressStream'

const isElectron = typeof window !== 'undefined' && !!window.electronAPI

// ── File type tile data ────────────────────────────────────────────────────

const FILE_TYPE_OPTIONS = [
  { key: 'images',    label: 'Images',    icon: <Image size={22} />,    accent: 'text-blue-400',    bg: 'bg-blue-900/20',    activeBg: 'bg-blue-600',    activeBorder: 'border-blue-500' },
  { key: 'videos',    label: 'Videos',    icon: <Film size={22} />,     accent: 'text-violet-400',  bg: 'bg-violet-900/20',  activeBg: 'bg-violet-600',  activeBorder: 'border-violet-500' },
  { key: 'documents', label: 'Documents', icon: <FileText size={22} />, accent: 'text-emerald-400', bg: 'bg-emerald-900/20', activeBg: 'bg-emerald-600', activeBorder: 'border-emerald-500' },
  { key: 'audio',     label: 'Audio',     icon: <Music size={22} />,    accent: 'text-amber-400',   bg: 'bg-amber-900/20',   activeBg: 'bg-amber-600',   activeBorder: 'border-amber-500' },
  { key: 'other',     label: 'Other',     icon: <File size={22} />,     accent: 'text-slate-400',   bg: 'bg-slate-700/40',   activeBg: 'bg-slate-600',   activeBorder: 'border-slate-500' },
]

export default function ScanIndex() {
  const location = useLocation()
  const { devices, fetchDevices, startScan } = useAppStore()

  const [selectedDevices, setSelectedDevices] = useState<number[]>(
    (location.state as { deviceIds?: number[] })?.deviceIds ?? []
  )
  const [scanPaths, setScanPaths] = useState<Record<number, string>>({})
  const [fileTypes, setFileTypes] = useState<string[]>([])
  const [scanDepth, setScanDepth] = useState<'shallow' | 'deep'>('deep')
  const [exclusions, setExclusions] = useState('node_modules, .git, __pycache__')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [jobId, setJobId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { fetchDevices() }, [])

  const toggleDevice = (id: number) =>
    setSelectedDevices((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]
    )

  const setScanPath = (deviceId: number, path: string) =>
    setScanPaths((prev) => ({ ...prev, [deviceId]: path }))

  const pickScanPath = async (deviceId: number) => {
    if (!window.electronAPI?.pickDirectory) return
    const path = await window.electronAPI.pickDirectory()
    if (path) setScanPath(deviceId, path)
  }

  const toggleFileType = (ft: string) =>
    setFileTypes((prev) => (prev.includes(ft) ? prev.filter((t) => t !== ft) : [...prev, ft]))

  const handleStartScan = async () => {
    setError(null)
    if (selectedDevices.length === 0) {
      setError('Select at least one device to scan')
      return
    }
    try {
      const id = await startScan(selectedDevices, {
        fileTypes: fileTypes.length > 0 ? fileTypes : undefined,
        scanDepth,
        exclusionPatterns: exclusions
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        scanPaths: Object.keys(scanPaths).length > 0 ? scanPaths : undefined,
      })
      setJobId(id)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Scan & Index</h1>
        <p className="text-sm text-slate-400 mt-1">
          Choose sources and start indexing your files
        </p>
      </div>

      {/* Device selector */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
        <h2 className="text-sm font-semibold text-slate-300 mb-4">Select Sources</h2>
        {devices.length === 0 ? (
          <div className="flex items-center gap-3 text-slate-500 py-2">
            <HardDrive size={16} className="opacity-50" />
            <p className="text-sm">No devices registered. Add one in Device Manager first.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {devices.map((d) => {
              const isSelected = selectedDevices.includes(d.id)
              return (
                <div key={d.id} className="flex flex-col gap-2">
                  <button
                    onClick={() => toggleDevice(d.id)}
                    className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-colors ${
                      isSelected
                        ? 'border-blue-500 bg-blue-900/15'
                        : 'border-slate-700 hover:bg-slate-700/50'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
                      isSelected ? 'bg-blue-600 border-blue-600' : 'border-slate-600'
                    }`}>
                      {isSelected && <CheckCircle2 size={12} className="text-white" />}
                    </div>
                    <HardDrive size={15} className={isSelected ? 'text-blue-400' : 'text-slate-500'} />
                    <div className="flex-1">
                      <span className="text-sm text-slate-200 font-medium">{d.name}</span>
                      <span className="text-xs text-slate-500 ml-2">({d.type})</span>
                    </div>
                    {!d.is_connected && (
                      <span className="text-xs text-red-400 bg-red-900/20 px-2 py-0.5 rounded-full">offline</span>
                    )}
                  </button>

                  {/* Folder override */}
                  {isSelected && (
                    <div className="ml-4 flex gap-2">
                      <input
                        value={scanPaths[d.id] ?? ''}
                        onChange={(e) => setScanPath(d.id, e.target.value)}
                        placeholder="Folder to scan (default: device root)"
                        className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        onClick={() => pickScanPath(d.id)}
                        disabled={!isElectron}
                        title={isElectron ? 'Browse' : 'Type path manually'}
                        className={`shrink-0 p-1.5 bg-slate-700 border border-slate-600 rounded-lg text-slate-400 transition-colors ${
                          isElectron ? 'hover:text-slate-200 hover:bg-slate-600' : 'opacity-40 cursor-not-allowed'
                        }`}
                      >
                        <FolderOpen size={14} />
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* File type grid */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-300">File Types</h2>
          <button
            onClick={() => setFileTypes([])}
            className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
              fileTypes.length === 0
                ? 'bg-blue-600 border-blue-500 text-white'
                : 'border-slate-600 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
            }`}
          >
            All types
          </button>
        </div>

        <div className="grid grid-cols-5 gap-2">
          {FILE_TYPE_OPTIONS.map((ft) => {
            const isActive = fileTypes.includes(ft.key)
            return (
              <button
                key={ft.key}
                onClick={() => toggleFileType(ft.key)}
                className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-colors ${
                  isActive
                    ? `${ft.activeBg} ${ft.activeBorder} text-white`
                    : `${ft.bg} border-slate-700 ${ft.accent} hover:border-slate-600`
                }`}
              >
                <span className={isActive ? 'text-white' : ft.accent}>{ft.icon}</span>
                <span className="text-xs font-medium">{ft.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Advanced options accordion */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full flex items-center justify-between px-5 py-4 text-sm font-semibold text-slate-300 hover:text-slate-100 transition-colors"
        >
          Advanced Options
          {showAdvanced ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>

        {showAdvanced && (
          <div className="px-5 pb-5 flex flex-col gap-4 border-t border-slate-700">
            {/* Scan depth */}
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-2">Scan Depth</label>
              <div className="grid grid-cols-2 gap-2">
                {(['shallow', 'deep'] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => setScanDepth(d)}
                    className={`py-2.5 text-xs font-medium rounded-xl border transition-colors ${
                      scanDepth === d
                        ? 'bg-blue-600 border-blue-500 text-white'
                        : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'
                    }`}
                  >
                    {d === 'shallow' ? 'Shallow (top 3 levels)' : 'Deep (full recursive)'}
                  </button>
                ))}
              </div>
            </div>

            {/* Exclusion patterns */}
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-2">
                Exclusion Patterns (comma-separated)
              </label>
              <input
                value={exclusions}
                onChange={(e) => setExclusions(e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="node_modules, .git, __pycache__"
              />
            </div>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <p className="text-sm text-red-400 bg-red-900/20 rounded-lg px-4 py-3">{error}</p>
      )}

      {/* Start button */}
      {!jobId && (
        <button
          onClick={handleStartScan}
          disabled={selectedDevices.length === 0}
          className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors"
        >
          <ScanLine size={16} />
          Start Scan
          {selectedDevices.length > 0 && (
            <span className="text-blue-200 text-xs ml-1">
              ({selectedDevices.length} source{selectedDevices.length > 1 ? 's' : ''})
            </span>
          )}
        </button>
      )}

      {/* Live progress */}
      {jobId && (
        <ProgressStream
          jobId={jobId}
          onDone={() => setJobId(null)}
          onError={(msg) => { setError(msg); setJobId(null) }}
        />
      )}
    </div>
  )
}
