/**
 * Scan & Index page — Phase 1 stub (full implementation in Phase 2).
 * Provides device/folder selector, file type filters, depth toggle,
 * exclusion patterns, and the live ProgressStream component.
 */

import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { ScanLine, ChevronDown, ChevronUp, FolderOpen } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { ProgressStream } from '../components/ProgressStream'

const isElectron = typeof window !== 'undefined' && !!window.electronAPI

export default function ScanIndex() {
  const location = useLocation()
  const { devices, fetchDevices, startScan } = useAppStore()

  const [selectedDevices, setSelectedDevices] = useState<number[]>(
    (location.state as { deviceIds?: number[] })?.deviceIds ?? []
  )
  // Per-device path overrides: { deviceId: path }
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

  const FILE_TYPE_OPTIONS = ['images', 'videos', 'documents', 'audio']

  return (
    <div className="flex flex-col gap-6 p-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Scan & Index</h1>
        <p className="text-sm text-slate-400 mt-1">
          Choose sources and start indexing your files
        </p>
      </div>

      {/* Device selector */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
        <h2 className="text-sm font-semibold text-slate-300 mb-3">Select Sources</h2>
        {devices.length === 0 ? (
          <p className="text-sm text-slate-500">No devices registered. Add one in Device Manager first.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {devices.map((d) => (
              <div key={d.id} className="flex flex-col gap-2">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={selectedDevices.includes(d.id)}
                    onChange={() => toggleDevice(d.id)}
                    className="w-4 h-4 rounded accent-blue-500"
                  />
                  <span className="text-sm text-slate-200 group-hover:text-white transition-colors">
                    {d.name}
                  </span>
                  <span className="text-xs text-slate-500">({d.type})</span>
                  {!d.is_connected && (
                    <span className="text-xs text-red-400 ml-auto">offline</span>
                  )}
                </label>
                {/* Folder override — only shown when device is selected */}
                {selectedDevices.includes(d.id) && (
                  <div className="ml-7 flex gap-2">
                    <input
                      value={scanPaths[d.id] ?? ''}
                      onChange={(e) => setScanPath(d.id, e.target.value)}
                      placeholder={`Folder to scan (default: device root)`}
                      className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      onClick={() => pickScanPath(d.id)}
                      disabled={!isElectron}
                      title={isElectron ? 'Browse' : 'Type path manually'}
                      className={`shrink-0 p-1.5 bg-slate-700 border border-slate-600 rounded-lg text-slate-400 transition-colors ${isElectron ? 'hover:text-slate-200 hover:bg-slate-600' : 'opacity-40 cursor-not-allowed'}`}
                    >
                      <FolderOpen size={14} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* File type filter */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
        <h2 className="text-sm font-semibold text-slate-300 mb-3">File Types</h2>
        <div className="flex flex-wrap gap-2">
          {FILE_TYPE_OPTIONS.map((ft) => (
            <button
              key={ft}
              onClick={() => toggleFileType(ft)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                fileTypes.includes(ft)
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'
              }`}
            >
              {ft.charAt(0).toUpperCase() + ft.slice(1)}
            </button>
          ))}
          <button
            onClick={() => setFileTypes([])}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              fileTypes.length === 0
                ? 'bg-blue-600 border-blue-500 text-white'
                : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'
            }`}
          >
            All
          </button>
        </div>
      </div>

      {/* Advanced options */}
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
            <div>
              <label className="text-xs text-slate-400 block mb-2">Scan Depth</label>
              <div className="flex gap-2">
                {(['shallow', 'deep'] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => setScanDepth(d)}
                    className={`px-4 py-2 text-xs font-medium rounded-lg border transition-colors ${
                      scanDepth === d
                        ? 'bg-blue-600 border-blue-500 text-white'
                        : 'bg-slate-700 border-slate-600 text-slate-300'
                    }`}
                  >
                    {d === 'shallow' ? 'Shallow (top 3 levels)' : 'Deep (full recursive)'}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-2">
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
          className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors"
        >
          <ScanLine size={16} />
          Start Scan
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
