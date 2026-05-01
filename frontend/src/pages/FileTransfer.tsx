/**
 * File Transfer page — DCluttr
 *
 * Layout:
 * - Top toolbar: Source / Destination device pickers + Transfer button
 * - Dual-pane file browser (Source left, Destination right)
 * - Transfer Queue panel at bottom with progress bars
 * - Conflict Resolution dropdown panel (appears when conflict detected)
 */

import { useState } from 'react'
import {
  ArrowLeftRight,
  FolderOpen,
  File,
  Image,
  Film,
  Music,
  FileText,
  ChevronRight,
  RefreshCw,
  Plus,
  X,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  HardDrive,
  ChevronDown,
  Folder,
} from 'lucide-react'
import { useAppStore } from '../store/useAppStore'

// ── Helpers ────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

// ── Types ──────────────────────────────────────────────────────────────────

type FileKind = 'folder' | 'image' | 'video' | 'audio' | 'document' | 'other'

interface FileEntry {
  id: string
  name: string
  kind: FileKind
  size: number
  modified: string
  path: string
  selected?: boolean
}

type TransferStatus = 'queued' | 'transferring' | 'done' | 'conflict' | 'error'

interface TransferItem {
  id: string
  name: string
  size: number
  progress: number
  status: TransferStatus
  conflict?: 'skip' | 'overwrite' | 'rename' | null
}

// ── Mock data ──────────────────────────────────────────────────────────────

const MOCK_SOURCE_FILES: FileEntry[] = [
  { id: 'f1', name: 'Photos', kind: 'folder', size: 0, modified: '2024-12-01', path: '/Photos' },
  { id: 'f2', name: 'Videos', kind: 'folder', size: 0, modified: '2024-11-20', path: '/Videos' },
  { id: 'f3', name: 'IMG_4821.jpg', kind: 'image', size: 4_200_000, modified: '2024-12-10', path: '/IMG_4821.jpg' },
  { id: 'f4', name: 'IMG_4822.jpg', kind: 'image', size: 3_800_000, modified: '2024-12-10', path: '/IMG_4822.jpg' },
  { id: 'f5', name: 'VID_0091.mp4', kind: 'video', size: 128_000_000, modified: '2024-12-09', path: '/VID_0091.mp4' },
  { id: 'f6', name: 'Budget_2024.xlsx', kind: 'document', size: 240_000, modified: '2024-11-15', path: '/Budget_2024.xlsx' },
  { id: 'f7', name: 'Podcast_ep12.mp3', kind: 'audio', size: 52_000_000, modified: '2024-12-01', path: '/Podcast_ep12.mp3' },
  { id: 'f8', name: 'Screenshot.png', kind: 'image', size: 1_100_000, modified: '2024-12-11', path: '/Screenshot.png' },
]

const MOCK_DEST_FILES: FileEntry[] = [
  { id: 'd1', name: 'Backups', kind: 'folder', size: 0, modified: '2024-10-01', path: '/Backups' },
  { id: 'd2', name: 'Imports', kind: 'folder', size: 0, modified: '2024-11-01', path: '/Imports' },
  { id: 'd3', name: 'IMG_4821.jpg', kind: 'image', size: 4_200_000, modified: '2024-11-28', path: '/IMG_4821.jpg' },
]

const MOCK_QUEUE: TransferItem[] = [
  { id: 'q1', name: 'IMG_4821.jpg', size: 4_200_000, progress: 100, status: 'conflict', conflict: null },
  { id: 'q2', name: 'VID_0091.mp4', size: 128_000_000, progress: 62, status: 'transferring', conflict: null },
  { id: 'q3', name: 'Podcast_ep12.mp3', size: 52_000_000, progress: 0, status: 'queued', conflict: null },
  { id: 'q4', name: 'Screenshot.png', size: 1_100_000, progress: 100, status: 'done', conflict: null },
]

// ── File icon ──────────────────────────────────────────────────────────────

function FileIcon({ kind, size = 16 }: { kind: FileKind; size?: number }) {
  switch (kind) {
    case 'folder': return <Folder size={size} className="text-blue-400" />
    case 'image':  return <Image size={size} className="text-violet-400" />
    case 'video':  return <Film size={size} className="text-pink-400" />
    case 'audio':  return <Music size={size} className="text-amber-400" />
    case 'document': return <FileText size={size} className="text-emerald-400" />
    default: return <File size={size} className="text-slate-400" />
  }
}

// ── File browser pane ──────────────────────────────────────────────────────

interface FilePaneProps {
  title: string
  deviceName: string
  files: FileEntry[]
  selected: Set<string>
  onSelect: (id: string) => void
  onDeviceClick: () => void
  side: 'source' | 'dest'
}

function FilePane({ title, deviceName, files, selected, onSelect, onDeviceClick, side }: FilePaneProps) {
  const [currentPath] = useState('/')

  return (
    <div className="flex flex-col bg-slate-800 rounded-xl border border-slate-700 overflow-hidden min-h-0">
      {/* Pane header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 bg-slate-800/80 shrink-0">
        <div className="flex items-center gap-2">
          <HardDrive size={14} className="text-slate-400" />
          <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">{title}</span>
        </div>
        <button
          onClick={onDeviceClick}
          className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 bg-blue-900/20 px-2.5 py-1 rounded-lg transition-colors"
        >
          <span className="max-w-[120px] truncate">{deviceName}</span>
          <ChevronDown size={11} />
        </button>
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-slate-700/50 text-xs text-slate-500 shrink-0">
        <FolderOpen size={12} />
        <ChevronRight size={10} />
        <span className="text-slate-400">{currentPath}</span>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[1fr_80px_100px] gap-2 px-4 py-1.5 border-b border-slate-700/50 text-xs text-slate-600 font-medium shrink-0">
        <span>Name</span>
        <span className="text-right">Size</span>
        <span className="text-right">Modified</span>
      </div>

      {/* File rows */}
      <div className="flex-1 overflow-y-auto">
        {files.map((file) => {
          const isSelected = selected.has(file.id)
          return (
            <button
              key={file.id}
              onClick={() => side === 'source' && onSelect(file.id)}
              className={`w-full grid grid-cols-[1fr_80px_100px] gap-2 items-center px-4 py-2 text-left transition-colors border-b border-slate-700/30 last:border-0 ${
                isSelected
                  ? 'bg-blue-600/15 text-blue-100'
                  : 'hover:bg-slate-700/50 text-slate-200'
              } ${side === 'dest' ? 'cursor-default' : 'cursor-pointer'}`}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <FileIcon kind={file.kind} size={14} />
                <span className="truncate text-xs">{file.name}</span>
              </span>
              <span className="text-right text-xs text-slate-500">
                {file.kind === 'folder' ? '—' : formatBytes(file.size)}
              </span>
              <span className="text-right text-xs text-slate-500">{file.modified}</span>
            </button>
          )
        })}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-slate-700 text-xs text-slate-500 shrink-0">
        {files.length} items
        {side === 'source' && selected.size > 0 && (
          <span className="ml-2 text-blue-400">{selected.size} selected</span>
        )}
      </div>
    </div>
  )
}

// ── Transfer queue item ────────────────────────────────────────────────────

interface QueueItemProps {
  item: TransferItem
  onResolveConflict: (id: string, resolution: 'skip' | 'overwrite' | 'rename') => void
}

function QueueItem({ item, onResolveConflict }: QueueItemProps) {
  const [showConflictPanel, setShowConflictPanel] = useState(item.status === 'conflict' && !item.conflict)

  const statusIcon = () => {
    switch (item.status) {
      case 'done': return <CheckCircle2 size={14} className="text-green-400 shrink-0" />
      case 'transferring': return <Loader2 size={14} className="text-blue-400 shrink-0 animate-spin" />
      case 'conflict': return <AlertTriangle size={14} className="text-yellow-400 shrink-0" />
      case 'error': return <X size={14} className="text-red-400 shrink-0" />
      default: return <div className="w-3.5 h-3.5 rounded-full border border-slate-600 shrink-0" />
    }
  }

  const progressColor = item.status === 'done'
    ? 'bg-green-500'
    : item.status === 'conflict'
    ? 'bg-yellow-500'
    : item.status === 'error'
    ? 'bg-red-500'
    : 'bg-blue-500'

  return (
    <div className="border-b border-slate-700/60 last:border-0">
      <div className="flex items-center gap-3 px-4 py-2.5">
        {statusIcon()}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-slate-200 truncate">{item.name}</span>
            <span className="text-xs text-slate-500 ml-3 shrink-0">{formatBytes(item.size)}</span>
          </div>
          <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${progressColor}`}
              style={{ width: `${item.progress}%` }}
            />
          </div>
        </div>
        <span className="text-xs text-slate-500 w-8 text-right shrink-0">{item.progress}%</span>

        {item.status === 'conflict' && (
          <button
            onClick={() => setShowConflictPanel(!showConflictPanel)}
            className="text-xs text-yellow-400 hover:text-yellow-300 bg-yellow-900/20 px-2 py-1 rounded-lg shrink-0 transition-colors"
          >
            Resolve
          </button>
        )}
      </div>

      {/* Conflict resolution panel */}
      {showConflictPanel && (
        <div className="mx-4 mb-3 bg-slate-900 rounded-lg border border-yellow-800/40 p-3">
          <p className="text-xs text-yellow-400 font-medium mb-2">
            File already exists at destination
          </p>
          <p className="text-xs text-slate-500 mb-3">
            A file named <span className="text-slate-300">{item.name}</span> already exists. How should this be handled?
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => { onResolveConflict(item.id, 'skip'); setShowConflictPanel(false) }}
              className="flex-1 py-1.5 text-xs font-medium rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors"
            >
              Skip
            </button>
            <button
              onClick={() => { onResolveConflict(item.id, 'overwrite'); setShowConflictPanel(false) }}
              className="flex-1 py-1.5 text-xs font-medium rounded-lg bg-red-900/40 hover:bg-red-900/60 text-red-300 transition-colors"
            >
              Overwrite
            </button>
            <button
              onClick={() => { onResolveConflict(item.id, 'rename'); setShowConflictPanel(false) }}
              className="flex-1 py-1.5 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
            >
              Rename
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── File Transfer page ─────────────────────────────────────────────────────

export default function FileTransfer() {
  const { devices } = useAppStore()

  const [sourceDeviceIdx, setSourceDeviceIdx] = useState(0)
  const [destDeviceIdx, setDestDeviceIdx] = useState(Math.min(1, devices.length - 1))
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const [queue, setQueue] = useState<TransferItem[]>(MOCK_QUEUE)
  const [showQueue, setShowQueue] = useState(true)

  const sourceDevice = devices[sourceDeviceIdx] ?? { name: 'Source Device' }
  const destDevice = devices[destDeviceIdx] ?? { name: 'Destination Device' }

  const toggleSelect = (id: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleResolveConflict = (id: string, resolution: 'skip' | 'overwrite' | 'rename') => {
    setQueue((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, conflict: resolution, status: resolution === 'skip' ? 'done' : 'transferring' } : item
      )
    )
  }

  const handleAddToQueue = () => {
    const newItems: TransferItem[] = MOCK_SOURCE_FILES.filter((f) => selectedFiles.has(f.id)).map((f) => ({
      id: `q-${f.id}-${Date.now()}`,
      name: f.name,
      size: f.size,
      progress: 0,
      status: 'queued' as TransferStatus,
      conflict: null,
    }))
    setQueue((prev) => [...prev, ...newItems])
    setSelectedFiles(new Set())
    setShowQueue(true)
  }

  const queueConflicts = queue.filter((q) => q.status === 'conflict').length
  const queueActive = queue.filter((q) => q.status === 'transferring').length
  const queueDone = queue.filter((q) => q.status === 'done').length

  return (
    <div className="flex flex-col h-full p-6 gap-4 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">File Transfer</h1>
          <p className="text-sm text-slate-400 mt-1">
            Copy files between devices with conflict detection
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowQueue(!showQueue)}
            className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 bg-slate-800 border border-slate-700 px-3 py-2 rounded-lg transition-colors"
          >
            <ArrowLeftRight size={14} />
            Queue
            {queue.length > 0 && (
              <span className="bg-blue-600 text-white text-xs px-1.5 py-0.5 rounded-full">
                {queue.length}
              </span>
            )}
          </button>
          <button
            disabled={selectedFiles.size === 0}
            onClick={handleAddToQueue}
            className="flex items-center gap-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg transition-colors"
          >
            <Plus size={14} />
            Transfer {selectedFiles.size > 0 ? `(${selectedFiles.size})` : ''}
          </button>
        </div>
      </div>

      {/* Device selectors */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 flex items-center gap-3">
          <HardDrive size={16} className="text-blue-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-slate-500 mb-0.5">Source</p>
            <select
              value={sourceDeviceIdx}
              onChange={(e) => setSourceDeviceIdx(Number(e.target.value))}
              className="w-full bg-transparent text-sm text-slate-100 outline-none cursor-pointer"
            >
              {devices.length === 0 ? (
                <option value={0}>No devices — add one first</option>
              ) : (
                devices.map((d, i) => (
                  <option key={d.id} value={i} className="bg-slate-800">
                    {d.name}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>

        <div className="p-2 bg-slate-800 border border-slate-700 rounded-xl text-slate-500">
          <ArrowLeftRight size={16} />
        </div>

        <div className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 flex items-center gap-3">
          <HardDrive size={16} className="text-emerald-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-slate-500 mb-0.5">Destination</p>
            <select
              value={destDeviceIdx}
              onChange={(e) => setDestDeviceIdx(Number(e.target.value))}
              className="w-full bg-transparent text-sm text-slate-100 outline-none cursor-pointer"
            >
              {devices.length === 0 ? (
                <option value={0}>No devices — add one first</option>
              ) : (
                devices.map((d, i) => (
                  <option key={d.id} value={i} className="bg-slate-800">
                    {d.name}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>
      </div>

      {/* Dual pane + queue layout */}
      <div className="flex-1 flex flex-col gap-4 min-h-0">
        {/* Dual pane */}
        <div className="flex-1 grid grid-cols-2 gap-4 min-h-0">
          <FilePane
            title="Source"
            deviceName={sourceDevice.name}
            files={MOCK_SOURCE_FILES}
            selected={selectedFiles}
            onSelect={toggleSelect}
            onDeviceClick={() => {}}
            side="source"
          />
          <FilePane
            title="Destination"
            deviceName={destDevice.name}
            files={MOCK_DEST_FILES}
            selected={new Set()}
            onSelect={() => {}}
            onDeviceClick={() => {}}
            side="dest"
          />
        </div>

        {/* Transfer queue */}
        {showQueue && (
          <div className="bg-slate-800 rounded-xl border border-slate-700 shrink-0 max-h-64 flex flex-col">
            {/* Queue header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 shrink-0">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-semibold text-slate-200">Transfer Queue</h3>
                <div className="flex items-center gap-2 text-xs">
                  {queueActive > 0 && (
                    <span className="text-blue-400 bg-blue-900/30 px-2 py-0.5 rounded-full">
                      {queueActive} active
                    </span>
                  )}
                  {queueConflicts > 0 && (
                    <span className="text-yellow-400 bg-yellow-900/30 px-2 py-0.5 rounded-full">
                      {queueConflicts} conflict{queueConflicts > 1 ? 's' : ''}
                    </span>
                  )}
                  {queueDone > 0 && (
                    <span className="text-green-400 bg-green-900/30 px-2 py-0.5 rounded-full">
                      {queueDone} done
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-700 transition-colors">
                  <RefreshCw size={13} />
                </button>
                <button
                  onClick={() => setShowQueue(false)}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-700 transition-colors"
                >
                  <X size={13} />
                </button>
              </div>
            </div>

            {/* Queue items */}
            <div className="overflow-y-auto flex-1">
              {queue.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-6">
                  No transfers queued. Select files and click Transfer.
                </p>
              ) : (
                queue.map((item) => (
                  <QueueItem
                    key={item.id}
                    item={item}
                    onResolveConflict={handleResolveConflict}
                  />
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
