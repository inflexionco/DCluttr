/**
 * ProgressStream component.
 *
 * Displays a live WebSocket scan progress panel:
 * - Animated progress bar
 * - Real-time file count
 * - Current path being scanned (truncated)
 * - Status badge
 * - Post-scan summary breakdown by type
 *
 * Usage:
 *   <ProgressStream jobId={42} onDone={(results) => …} />
 */

import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, XCircle, Loader2, File } from 'lucide-react'
import { ScanProgressEvent } from '../store/useAppStore'
import { scanApi, ScanResults } from '../api/client'

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function truncatePath(path: string, maxLen = 60): string {
  if (path.length <= maxLen) return path
  const parts = path.split('/')
  if (parts.length <= 2) return '…' + path.slice(-maxLen)
  return '…/' + parts.slice(-2).join('/')
}

const CATEGORY_COLORS: Record<string, string> = {
  images: 'bg-blue-500',
  videos: 'bg-violet-500',
  documents: 'bg-emerald-500',
  audio: 'bg-amber-500',
  other: 'bg-slate-500',
}

const CATEGORY_LABELS: Record<string, string> = {
  images: 'Images',
  videos: 'Videos',
  documents: 'Documents',
  audio: 'Audio',
  other: 'Other',
}

// ── ProgressStream ─────────────────────────────────────────────────────────

interface ProgressStreamProps {
  jobId: number
  onDone?: (results: ScanResults) => void
  onError?: (message: string) => void
  className?: string
}

export function ProgressStream({ jobId, onDone, onError, className = '' }: ProgressStreamProps) {
  const [progress, setProgress] = useState<ScanProgressEvent>({
    job_id: jobId,
    status: 'pending',
    files_found: 0,
    files_indexed: 0,
    current_path: '',
  })
  const [results, setResults] = useState<ScanResults | null>(null)
  const socketRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    let cancelled = false

    const connect = async () => {
      try {
        const ws = await scanApi.openProgressSocket(
          jobId,
          (data) => {
            if (cancelled) return
            const event = data as ScanProgressEvent
            if (event.heartbeat) return

            setProgress(event)

            if (event.status === 'done') {
              // Fetch final summary
              scanApi.getResults(jobId).then((r) => {
                if (!cancelled) {
                  setResults(r)
                  onDone?.(r)
                }
              }).catch(console.error)
            }

            if (event.status === 'failed') {
              onError?.(event.error ?? 'Scan failed')
            }
          },
          () => {
            // Socket closed — if not done/failed, treat as error
            if (!cancelled && progress.status === 'running') {
              onError?.('Connection lost')
            }
          }
        )
        socketRef.current = ws
      } catch (err) {
        console.error('ProgressStream WebSocket error:', err)
      }
    }

    connect()

    return () => {
      cancelled = true
      socketRef.current?.close()
      socketRef.current = null
    }
  }, [jobId])

  const isDone = progress.status === 'done'
  const isFailed = progress.status === 'failed'
  const isRunning = progress.status === 'running'

  // Indeterminate progress — we don't know total ahead of time
  // Show a pseudo-percentage based on files indexed (capped at 95% until done)
  const pct = isDone
    ? 100
    : progress.files_found > 0
    ? Math.min(95, (progress.files_indexed / progress.files_found) * 100)
    : isRunning
    ? undefined  // indeterminate
    : 0

  return (
    <div className={`bg-slate-800 rounded-xl border border-slate-700 p-5 flex flex-col gap-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isDone ? (
            <CheckCircle2 size={18} className="text-green-400" />
          ) : isFailed ? (
            <XCircle size={18} className="text-red-400" />
          ) : (
            <Loader2 size={18} className="text-blue-400 animate-spin" />
          )}
          <span className="text-sm font-semibold text-slate-200">
            {isDone ? 'Scan Complete' : isFailed ? 'Scan Failed' : 'Scanning…'}
          </span>
        </div>
        <span
          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            isDone
              ? 'bg-green-900/40 text-green-400'
              : isFailed
              ? 'bg-red-900/40 text-red-400'
              : 'bg-blue-900/40 text-blue-400'
          }`}
        >
          {progress.status}
        </span>
      </div>

      {/* Progress bar */}
      <div className="flex flex-col gap-1.5">
        <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
          {pct !== undefined ? (
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                isDone ? 'bg-green-500' : isFailed ? 'bg-red-500' : 'bg-blue-500'
              }`}
              style={{ width: `${pct}%` }}
            />
          ) : (
            /* Indeterminate shimmer */
            <div className="h-full w-1/3 bg-blue-500 rounded-full animate-[progress-shimmer_1.5s_ease-in-out_infinite]" />
          )}
        </div>
        <div className="flex justify-between text-xs text-slate-500">
          <span>
            {progress.files_indexed.toLocaleString()} indexed
            {progress.files_found > 0 && ` / ${progress.files_found.toLocaleString()} found`}
          </span>
          {pct !== undefined && <span>{Math.round(pct)}%</span>}
        </div>
      </div>

      {/* Current path */}
      {progress.current_path && !isDone && !isFailed && (
        <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-900/50 rounded-lg px-3 py-2">
          <File size={11} className="shrink-0 text-slate-600" />
          <span className="truncate font-mono">{truncatePath(progress.current_path)}</span>
        </div>
      )}

      {/* Error message */}
      {isFailed && progress.error && (
        <div className="text-xs text-red-400 bg-red-900/20 rounded-lg px-3 py-2">
          {progress.error}
        </div>
      )}

      {/* Post-scan summary */}
      {isDone && results && (
        <div className="flex flex-col gap-3 pt-1 border-t border-slate-700">
          <p className="text-xs font-medium text-slate-400">Files by type</p>
          <div className="flex flex-col gap-2">
            {Object.entries(results.by_type)
              .sort(([, a], [, b]) => b - a)
              .map(([cat, count]) => {
                const total = Object.values(results.by_type).reduce((s, v) => s + v, 0)
                const pct = total > 0 ? (count / total) * 100 : 0
                return (
                  <div key={cat} className="flex flex-col gap-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">{CATEGORY_LABELS[cat] ?? cat}</span>
                      <span className="text-slate-300">
                        {count.toLocaleString()}
                        {results.by_size[cat]
                          ? ` · ${formatBytes(results.by_size[cat])}`
                          : ''}
                      </span>
                    </div>
                    <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${CATEGORY_COLORS[cat] ?? 'bg-slate-500'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
          </div>

          <div className="flex justify-between text-xs text-slate-500 mt-1">
            <span>
              Total: {results.files_indexed.toLocaleString()} files
            </span>
            <span>
              {formatBytes(Object.values(results.by_size).reduce((s, v) => s + v, 0))}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

export default ProgressStream
