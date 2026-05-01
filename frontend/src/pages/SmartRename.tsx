/**
 * Smart Rename AI page — DCluttr
 *
 * Layout:
 * - Left: rename queue list with confidence badges + per-item actions
 * - Right: naming rules panel with toggle switches
 * - Bulk action bar (approve all, reject all, apply selected)
 */

import { useState } from 'react'
import {
  Tag,
  CheckCircle2,
  XCircle,
  Sparkles,
  ChevronRight,
  RefreshCw,
  Check,
  X,
  ToggleLeft,
  ToggleRight,
  Image,
  Film,
  FileText,
  Music,
  File,
  Info,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────

type RenameStatus = 'pending' | 'approved' | 'rejected' | 'analyzing'
type FileKind = 'image' | 'video' | 'document' | 'audio' | 'other'

interface RenameItem {
  id: string
  originalName: string
  suggestedName: string
  kind: FileKind
  confidence: number   // 0–100
  reason: string
  status: RenameStatus
  device: string
  path: string
}

interface NamingRule {
  id: string
  label: string
  description: string
  enabled: boolean
}

// ── Mock data ──────────────────────────────────────────────────────────────

const INITIAL_ITEMS: RenameItem[] = [
  {
    id: 'r1',
    originalName: 'IMG_4821.jpg',
    suggestedName: '2024-12-10_Beach_Sunset.jpg',
    kind: 'image',
    confidence: 94,
    reason: 'EXIF GPS location matches Malibu Beach; timestamp 18:32',
    status: 'pending',
    device: 'My Mac',
    path: '/Photos/IMG_4821.jpg',
  },
  {
    id: 'r2',
    originalName: 'VID_0091.mp4',
    suggestedName: '2024-12-09_Birthday_Party.mp4',
    kind: 'video',
    confidence: 87,
    reason: 'Face recognition matches family album; EXIF date December 9th',
    status: 'pending',
    device: 'My Mac',
    path: '/Videos/VID_0091.mp4',
  },
  {
    id: 'r3',
    originalName: 'Document1.docx',
    suggestedName: 'Q4_2024_Budget_Report.docx',
    kind: 'document',
    confidence: 76,
    reason: 'Title metadata reads "Q4 Budget Report"; created Oct 2024',
    status: 'approved',
    device: 'My Mac',
    path: '/Documents/Document1.docx',
  },
  {
    id: 'r4',
    originalName: 'untitled_recording_03.m4a',
    suggestedName: 'Voice_Memo_2024-11-20.m4a',
    kind: 'audio',
    confidence: 61,
    reason: 'Audio metadata has creation date; no title tag found',
    status: 'pending',
    device: 'iPhone',
    path: '/Voice Memos/untitled_recording_03.m4a',
  },
  {
    id: 'r5',
    originalName: 'Screenshot 2024-12-11 at 09.14.22.png',
    suggestedName: 'Screenshot_Dashboard_2024-12-11.png',
    kind: 'image',
    confidence: 82,
    reason: 'Screen contents contain "Dashboard" text via OCR',
    status: 'rejected',
    device: 'My Mac',
    path: '/Desktop/Screenshot 2024-12-11 at 09.14.22.png',
  },
  {
    id: 'r6',
    originalName: 'final_final_v3_REAL.pdf',
    suggestedName: 'Project_Proposal_v3.pdf',
    kind: 'document',
    confidence: 89,
    reason: 'PDF title metadata: "Project Proposal"; version suffix detected',
    status: 'pending',
    device: 'My Mac',
    path: '/Documents/final_final_v3_REAL.pdf',
  },
  {
    id: 'r7',
    originalName: 'clip_export_HD_1080.mp4',
    suggestedName: 'Travel_Montage_Tokyo_2024.mp4',
    kind: 'video',
    confidence: 71,
    reason: 'GPS metadata places footage in Tokyo; date range 2024',
    status: 'analyzing',
    device: 'External Drive',
    path: '/Exports/clip_export_HD_1080.mp4',
  },
]

const INITIAL_RULES: NamingRule[] = [
  { id: 'date_prefix', label: 'Date Prefix', description: 'Prepend YYYY-MM-DD to filenames', enabled: true },
  { id: 'location_tag', label: 'Location Tag', description: 'Include GPS location in photo/video names', enabled: true },
  { id: 'content_desc', label: 'AI Content Description', description: 'Add AI-detected subject/scene to name', enabled: true },
  { id: 'clean_version', label: 'Clean Version Suffixes', description: 'Remove _v1, _final, _copy etc.', enabled: true },
  { id: 'lowercase', label: 'Lowercase Names', description: 'Convert all filenames to lowercase', enabled: false },
  { id: 'strip_spaces', label: 'Replace Spaces', description: 'Replace spaces with underscores', enabled: true },
]

// ── Helpers ────────────────────────────────────────────────────────────────

function FileIcon({ kind }: { kind: FileKind }) {
  switch (kind) {
    case 'image':    return <Image size={15} className="text-blue-400" />
    case 'video':    return <Film size={15} className="text-violet-400" />
    case 'document': return <FileText size={15} className="text-emerald-400" />
    case 'audio':    return <Music size={15} className="text-amber-400" />
    default:         return <File size={15} className="text-slate-400" />
  }
}

function ConfidenceBadge({ value }: { value: number }) {
  const color =
    value >= 85 ? 'text-green-400 bg-green-900/25 border-green-800/40' :
    value >= 65 ? 'text-yellow-400 bg-yellow-900/25 border-yellow-800/40' :
                  'text-red-400 bg-red-900/25 border-red-800/40'
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${color}`}>
      {value}%
    </span>
  )
}

// ── Rename item row ────────────────────────────────────────────────────────

interface RenameRowProps {
  item: RenameItem
  selected: boolean
  onToggleSelect: () => void
  onApprove: () => void
  onReject: () => void
}

function RenameRow({ item, selected, onToggleSelect, onApprove, onReject }: RenameRowProps) {
  const [expanded, setExpanded] = useState(false)

  const statusStyles: Record<RenameStatus, string> = {
    pending:   'border-slate-700 bg-slate-800',
    approved:  'border-green-800/50 bg-green-900/10',
    rejected:  'border-red-800/50 bg-red-900/10',
    analyzing: 'border-blue-800/50 bg-blue-900/10',
  }

  return (
    <div className={`rounded-xl border transition-colors ${statusStyles[item.status]} ${selected ? 'ring-1 ring-blue-500' : ''}`}>
      <div className="flex items-center gap-3 p-3.5">
        {/* Checkbox */}
        <button
          onClick={onToggleSelect}
          className={`w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center transition-colors ${
            selected ? 'bg-blue-600 border-blue-600' : 'border-slate-600 hover:border-slate-400'
          }`}
        >
          {selected && <Check size={10} className="text-white" />}
        </button>

        {/* File icon */}
        <FileIcon kind={item.kind} />

        {/* Names */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-400 truncate max-w-[180px]">{item.originalName}</span>
            <ChevronRight size={11} className="text-slate-600 shrink-0" />
            <span className="text-xs font-medium text-slate-100 truncate max-w-[200px]">{item.suggestedName}</span>
          </div>
          <p className="text-xs text-slate-600 mt-0.5 truncate">{item.device} · {item.path}</p>
        </div>

        {/* Confidence */}
        <ConfidenceBadge value={item.confidence} />

        {/* Status / actions */}
        {item.status === 'analyzing' ? (
          <span className="flex items-center gap-1 text-xs text-blue-400">
            <RefreshCw size={12} className="animate-spin" />
            Analyzing
          </span>
        ) : item.status === 'approved' ? (
          <span className="flex items-center gap-1 text-xs text-green-400">
            <CheckCircle2 size={13} />
            Approved
          </span>
        ) : item.status === 'rejected' ? (
          <span className="flex items-center gap-1 text-xs text-slate-500">
            <XCircle size={13} />
            Rejected
          </span>
        ) : (
          <div className="flex gap-1.5 shrink-0">
            <button
              onClick={onApprove}
              className="p-1.5 rounded-lg bg-green-900/30 hover:bg-green-900/60 text-green-400 transition-colors"
              title="Approve rename"
            >
              <Check size={13} />
            </button>
            <button
              onClick={onReject}
              className="p-1.5 rounded-lg bg-red-900/20 hover:bg-red-900/40 text-red-400 transition-colors"
              title="Reject rename"
            >
              <X size={13} />
            </button>
          </div>
        )}

        {/* Expand reason */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="p-1.5 rounded-lg text-slate-600 hover:text-slate-300 hover:bg-slate-700 transition-colors shrink-0"
          title="View reason"
        >
          <Info size={13} />
        </button>
      </div>

      {/* Expanded reason */}
      {expanded && (
        <div className="px-4 pb-3 pt-0">
          <div className="flex items-start gap-2 bg-slate-900/60 rounded-lg px-3 py-2">
            <Sparkles size={12} className="text-blue-400 mt-0.5 shrink-0" />
            <p className="text-xs text-slate-400">{item.reason}</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Smart Rename page ──────────────────────────────────────────────────────

export default function SmartRename() {
  const [items, setItems] = useState<RenameItem[]>(INITIAL_ITEMS)
  const [rules, setRules] = useState<NamingRule[]>(INITIAL_RULES)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all')

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const approveItem = (id: string) =>
    setItems((prev) => prev.map((it) => it.id === id ? { ...it, status: 'approved' } : it))

  const rejectItem = (id: string) =>
    setItems((prev) => prev.map((it) => it.id === id ? { ...it, status: 'rejected' } : it))

  const approveSelected = () => {
    setItems((prev) =>
      prev.map((it) => selectedIds.has(it.id) && it.status === 'pending' ? { ...it, status: 'approved' } : it)
    )
    setSelectedIds(new Set())
  }

  const rejectSelected = () => {
    setItems((prev) =>
      prev.map((it) => selectedIds.has(it.id) && it.status === 'pending' ? { ...it, status: 'rejected' } : it)
    )
    setSelectedIds(new Set())
  }

  const toggleRule = (id: string) =>
    setRules((prev) => prev.map((r) => r.id === id ? { ...r, enabled: !r.enabled } : r))

  const filteredItems = filter === 'all' ? items : items.filter((it) => it.status === filter)

  const pendingCount = items.filter((i) => i.status === 'pending').length
  const approvedCount = items.filter((i) => i.status === 'approved').length
  const rejectedCount = items.filter((i) => i.status === 'rejected').length

  return (
    <div className="flex flex-col h-full p-6 gap-4 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Smart Rename</h1>
          <p className="text-sm text-slate-400 mt-1">
            AI-suggested renames awaiting your approval
          </p>
        </div>
        <button className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 bg-slate-800 border border-slate-700 px-3 py-2 rounded-lg transition-colors">
          <Sparkles size={14} className="text-blue-400" />
          Re-analyze All
        </button>
      </div>

      {/* Stats row */}
      <div className="flex gap-3 shrink-0">
        {[
          { label: 'Pending', count: pendingCount, color: 'text-yellow-400 bg-yellow-900/20', filter: 'pending' as const },
          { label: 'Approved', count: approvedCount, color: 'text-green-400 bg-green-900/20', filter: 'approved' as const },
          { label: 'Rejected', count: rejectedCount, color: 'text-slate-400 bg-slate-700/50', filter: 'rejected' as const },
        ].map((s) => (
          <button
            key={s.label}
            onClick={() => setFilter(filter === s.filter ? 'all' : s.filter)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${s.color} ${
              filter === s.filter ? 'ring-1 ring-current' : ''
            }`}
          >
            <span className="font-bold">{s.count}</span>
            <span className="opacity-80">{s.label}</span>
          </button>
        ))}
      </div>

      {/* Main layout */}
      <div className="flex-1 flex gap-5 min-h-0">
        {/* Left: rename queue */}
        <div className="flex-1 flex flex-col gap-3 min-h-0">
          {/* Bulk action bar */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 bg-blue-900/20 border border-blue-800/40 rounded-xl px-4 py-2.5 shrink-0">
              <span className="text-xs text-blue-300 font-medium">{selectedIds.size} selected</span>
              <div className="flex gap-2 ml-auto">
                <button
                  onClick={approveSelected}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-green-700 hover:bg-green-600 text-white transition-colors"
                >
                  <Check size={12} />
                  Approve
                </button>
                <button
                  onClick={rejectSelected}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-red-900/50 hover:bg-red-900/80 text-red-300 transition-colors"
                >
                  <X size={12} />
                  Reject
                </button>
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="text-xs text-slate-400 hover:text-slate-200 px-2 py-1.5 transition-colors"
                >
                  Clear
                </button>
              </div>
            </div>
          )}

          {/* Queue header */}
          <div className="flex items-center gap-2 shrink-0">
            <Tag size={14} className="text-slate-500" />
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
              Rename Queue
            </span>
            <span className="text-xs text-slate-600 ml-1">
              {filteredItems.length} item{filteredItems.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Item list */}
          <div className="flex-1 overflow-y-auto flex flex-col gap-2">
            {filteredItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-500">
                <Tag size={36} className="mb-3 opacity-30" />
                <p className="text-sm">No items in this view</p>
              </div>
            ) : (
              filteredItems.map((item) => (
                <RenameRow
                  key={item.id}
                  item={item}
                  selected={selectedIds.has(item.id)}
                  onToggleSelect={() => toggleSelect(item.id)}
                  onApprove={() => approveItem(item.id)}
                  onReject={() => rejectItem(item.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* Right: naming rules panel */}
        <div className="w-72 shrink-0 flex flex-col gap-4">
          <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
            <div className="px-4 py-3.5 border-b border-slate-700">
              <h3 className="text-sm font-semibold text-slate-200">Naming Rules</h3>
              <p className="text-xs text-slate-500 mt-0.5">Configure AI rename behavior</p>
            </div>

            <div className="divide-y divide-slate-700/50">
              {rules.map((rule) => (
                <div key={rule.id} className="flex items-start justify-between gap-3 px-4 py-3.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-200">{rule.label}</p>
                    <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{rule.description}</p>
                  </div>
                  <button
                    onClick={() => toggleRule(rule.id)}
                    className="shrink-0 mt-0.5 transition-colors"
                  >
                    {rule.enabled
                      ? <ToggleRight size={22} className="text-blue-400" />
                      : <ToggleLeft size={22} className="text-slate-600" />
                    }
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Apply button */}
          <button
            disabled={approvedCount === 0}
            className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors"
          >
            <CheckCircle2 size={15} />
            Apply {approvedCount > 0 ? `${approvedCount} ` : ''}Approved Renames
          </button>
        </div>
      </div>
    </div>
  )
}
