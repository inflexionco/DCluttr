/**
 * Device Manager page.
 *
 * Features:
 * - Lists registered devices with live connection status
 * - Auto-detects local + external volumes
 * - "Add Device" modal for: Local path, External volume, SFTP remote
 * - Per-device actions: Scan, Refresh stats, Disconnect
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Monitor,
  Smartphone,
  HardDrive,
  Wifi,
  Usb,
  Plus,
  RefreshCw,
  ScanLine,
  Trash2,
  CheckCircle2,
  XCircle,
  FolderOpen,
  Server,
} from 'lucide-react'
import { Device, VolumeInfo, devicesApi, ConnectDevicePayload } from '../api/client'
import { useAppStore } from '../store/useAppStore'

// ── Helpers ───────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

const DEVICE_ICONS: Record<Device['type'], React.ReactNode> = {
  mac: <Monitor size={24} />,
  iphone: <Smartphone size={24} />,
  android: <Smartphone size={24} />,
  external: <HardDrive size={24} />,
  remote: <Server size={24} />,
}

const DEVICE_TYPE_LABELS: Record<Device['type'], string> = {
  mac: 'Mac',
  iphone: 'iPhone',
  android: 'Android',
  external: 'External Drive',
  remote: 'Remote Mac (SFTP)',
}

// ── Device Card ───────────────────────────────────────────────────────────

interface DeviceCardProps {
  device: Device
  onScan: () => void
  onRefresh: () => void
  onDisconnect: () => void
}

function DeviceCard({ device, onScan, onRefresh, onDisconnect }: DeviceCardProps) {
  const usedPct =
    device.total_size > 0
      ? Math.min(100, (device.total_size / (device.total_size * 1.5)) * 100)
      : 0

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-5 flex flex-col gap-4">
      {/* Header row */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-slate-700 rounded-lg text-blue-400">
            {DEVICE_ICONS[device.type]}
          </div>
          <div>
            <h3 className="text-slate-100 font-semibold text-sm">{device.name}</h3>
            <p className="text-xs text-slate-500 mt-0.5">{DEVICE_TYPE_LABELS[device.type]}</p>
          </div>
        </div>

        {/* Connection badge */}
        {device.is_connected ? (
          <span className="flex items-center gap-1 text-xs text-green-400 bg-green-900/30 px-2 py-1 rounded-full">
            <CheckCircle2 size={11} />
            Connected
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-slate-500 bg-slate-700 px-2 py-1 rounded-full">
            <XCircle size={11} />
            Offline
          </span>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 text-xs text-slate-400">
        <div>
          <p className="text-slate-500 mb-0.5">Files indexed</p>
          <p className="text-slate-200 font-medium">{device.total_files.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-slate-500 mb-0.5">Index size</p>
          <p className="text-slate-200 font-medium">{formatBytes(device.total_size)}</p>
        </div>
        <div>
          <p className="text-slate-500 mb-0.5">Last scanned</p>
          <p className="text-slate-200 font-medium">
            {device.last_scanned
              ? new Date(device.last_scanned).toLocaleDateString()
              : 'Never'}
          </p>
        </div>
        <div>
          <p className="text-slate-500 mb-0.5">Type</p>
          <p className="text-slate-200 font-medium">{device.type}</p>
        </div>
      </div>

      {/* Storage bar */}
      {device.total_size > 0 && (
        <div>
          <div className="flex justify-between text-xs text-slate-500 mb-1">
            <span>{formatBytes(device.total_size)} indexed</span>
          </div>
          <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all"
              style={{ width: `${usedPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={onScan}
          disabled={!device.is_connected}
          className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
        >
          <ScanLine size={13} />
          Scan
        </button>
        <button
          onClick={onRefresh}
          className="flex items-center justify-center gap-1.5 text-xs font-medium py-2 px-3 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors"
          title="Refresh stats"
        >
          <RefreshCw size={13} />
        </button>
        <button
          onClick={onDisconnect}
          className="flex items-center justify-center gap-1.5 text-xs font-medium py-2 px-3 rounded-lg bg-red-900/40 hover:bg-red-900/70 text-red-400 transition-colors"
          title="Remove device"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  )
}

// ── Add Device Modal ──────────────────────────────────────────────────────

type AddDeviceTab = 'local' | 'external' | 'sftp'

interface AddDeviceModalProps {
  volumes: VolumeInfo[]
  onClose: () => void
  onAdded: (device: Device) => void
}

function AddDeviceModal({ volumes, onClose, onAdded }: AddDeviceModalProps) {
  const [tab, setTab] = useState<AddDeviceTab>('local')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Local path form
  const [localName, setLocalName] = useState('My Mac')
  const [localPath, setLocalPath] = useState('')

  // SFTP form
  const [sftpName, setSftpName] = useState('Remote Mac')
  const [sftpIp, setSftpIp] = useState('')
  const [sftpPort, setSftpPort] = useState('22')
  const [sftpUser, setSftpUser] = useState('')
  const [sftpKeyPath, setSftpKeyPath] = useState('')

  // Selected volume (external tab)
  const [selectedVolume, setSelectedVolume] = useState<VolumeInfo | null>(
    volumes.find((v) => v.device_type === 'external') ?? null
  )

  const isElectron = typeof window !== 'undefined' && !!window.electronAPI

  const pickDirectory = async () => {
    if (window.electronAPI?.pickDirectory) {
      const path = await window.electronAPI.pickDirectory()
      if (path) setLocalPath(path)
    }
  }

  const pickKeyFile = async () => {
    if (window.electronAPI?.pickFile) {
      const path = await window.electronAPI.pickFile()
      if (path) setSftpKeyPath(path)
    }
  }

  const handleSubmit = async () => {
    setError(null)
    setLoading(true)

    try {
      let payload: ConnectDevicePayload

      if (tab === 'local') {
        payload = {
          name: localName || 'My Mac',
          type: 'mac',
          connection_info: { path: localPath || '/' },
        }
      } else if (tab === 'external') {
        if (!selectedVolume) throw new Error('Select a volume first')
        payload = {
          name: selectedVolume.name,
          type: 'external',
          connection_info: { path: selectedVolume.path },
        }
      } else {
        if (!sftpIp) throw new Error('IP address is required')
        if (!sftpUser) throw new Error('Username is required')
        payload = {
          name: sftpName,
          type: 'remote',
          connection_info: {
            ip: sftpIp,
            port: parseInt(sftpPort) || 22,
            username: sftpUser,
            ssh_key_path: sftpKeyPath || undefined,
          },
        }
      }

      const device = await devicesApi.connect(payload)
      onAdded(device)
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-md shadow-2xl">
        {/* Title */}
        <div className="px-6 pt-6 pb-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold text-slate-100">Add Device</h2>
          <p className="text-sm text-slate-400 mt-1">
            Connect a new source to scan and manage
          </p>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-700">
          {(['local', 'external', 'sftp'] as AddDeviceTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                tab === t
                  ? 'text-blue-400 border-b-2 border-blue-400'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {t === 'local' ? 'Local Path' : t === 'external' ? 'External Drive' : 'SFTP Remote'}
            </button>
          ))}
        </div>

        {/* Form content */}
        <div className="px-6 py-5 flex flex-col gap-4">
          {tab === 'local' && (
            <>
              <Field label="Device Name">
                <input
                  value={localName}
                  onChange={(e) => setLocalName(e.target.value)}
                  className={inputClass}
                  placeholder="My MacBook"
                />
              </Field>
              <Field label="Root Path">
                <div className="flex gap-2">
                  <input
                    value={localPath}
                    onChange={(e) => setLocalPath(e.target.value)}
                    className={inputClass}
                    placeholder="/Users/you"
                  />
                  <button
                    onClick={pickDirectory}
                    disabled={!isElectron}
                    className={iconBtnClass + (!isElectron ? ' opacity-40 cursor-not-allowed' : '')}
                    title={isElectron ? 'Browse' : 'Browse only available in the desktop app - type path manually'}
                  >
                    <FolderOpen size={16} />
                  </button>
                </div>
                {!isElectron && (
                  <p className="text-xs text-slate-500">Running in browser - type the path manually above.</p>
                )}
              </Field>
            </>
          )}

          {tab === 'external' && (
            <div className="flex flex-col gap-2">
              {volumes.filter((v) => v.device_type === 'external').length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-4">
                  No external drives detected. Plug in a drive and try again.
                </p>
              ) : (
                volumes
                  .filter((v) => v.device_type === 'external')
                  .map((vol) => (
                    <button
                      key={vol.path}
                      onClick={() => setSelectedVolume(vol)}
                      className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                        selectedVolume?.path === vol.path
                          ? 'border-blue-500 bg-blue-900/20'
                          : 'border-slate-700 hover:bg-slate-700'
                      }`}
                    >
                      <HardDrive size={18} className="text-slate-400 shrink-0" />
                      <div>
                        <p className="text-sm text-slate-200 font-medium">{vol.name}</p>
                        <p className="text-xs text-slate-500">
                          {formatBytes(vol.used_bytes)} / {formatBytes(vol.total_bytes)} · {vol.path}
                        </p>
                      </div>
                    </button>
                  ))
              )}
            </div>
          )}

          {tab === 'sftp' && (
            <>
              <Field label="Device Name">
                <input value={sftpName} onChange={(e) => setSftpName(e.target.value)} className={inputClass} />
              </Field>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <Field label="IP Address">
                    <input value={sftpIp} onChange={(e) => setSftpIp(e.target.value)} className={inputClass} placeholder="192.168.1.10" />
                  </Field>
                </div>
                <Field label="Port">
                  <input value={sftpPort} onChange={(e) => setSftpPort(e.target.value)} className={inputClass} placeholder="22" />
                </Field>
              </div>
              <Field label="Username">
                <input value={sftpUser} onChange={(e) => setSftpUser(e.target.value)} className={inputClass} placeholder="johndoe" />
              </Field>
              <Field label="SSH Key Path (optional)">
                <div className="flex gap-2">
                  <input value={sftpKeyPath} onChange={(e) => setSftpKeyPath(e.target.value)} className={inputClass} placeholder="~/.ssh/id_rsa" />
                  <button onClick={pickKeyFile} className={iconBtnClass}><FolderOpen size={16} /></button>
                </div>
              </Field>
            </>
          )}

          {error && (
            <p className="text-sm text-red-400 bg-red-900/20 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-5 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            {loading ? 'Connecting…' : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  )
}

const inputClass =
  'w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500'
const iconBtnClass =
  'shrink-0 p-2 bg-slate-700 border border-slate-600 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-600 transition-colors'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-slate-400">{label}</label>
      {children}
    </div>
  )
}

// ── Device Manager page ───────────────────────────────────────────────────

export default function DeviceManager() {
  const navigate = useNavigate()
  const { devices, devicesLoading, fetchDevices, addDevice, removeDevice, updateDevice } =
    useAppStore()

  const [volumes, setVolumes] = useState<VolumeInfo[]>([])
  const [showModal, setShowModal] = useState(false)

  useEffect(() => {
    fetchDevices()
    devicesApi.listLocalVolumes().then(setVolumes).catch(console.error)
  }, [])

  const handleScan = (device: Device) => {
    navigate('/scan', { state: { deviceIds: [device.id] } })
  }

  const handleRefresh = async (device: Device) => {
    try {
      const updated = await devicesApi.refresh(device.id)
      updateDevice(updated)
    } catch (err) {
      console.error('Refresh failed:', err)
    }
  }

  const handleDisconnect = async (device: Device) => {
    if (!confirm(`Remove "${device.name}" from DCluttr? Indexed data will be preserved.`)) return
    try {
      await devicesApi.disconnect(device.id)
      removeDevice(device.id)
    } catch (err) {
      console.error('Disconnect failed:', err)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Device Manager</h1>
          <p className="text-sm text-slate-400 mt-1">
            Manage connected sources — Macs, iPhones, Androids, external drives
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => fetchDevices()}
            className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-100 transition-colors"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg transition-colors"
          >
            <Plus size={15} />
            Add Device
          </button>
        </div>
      </div>

      {/* Device grid */}
      {devicesLoading ? (
        <div className="text-center py-16 text-slate-500">
          <RefreshCw size={32} className="mx-auto mb-3 animate-spin opacity-50" />
          <p className="text-sm">Detecting devices…</p>
        </div>
      ) : devices.length === 0 ? (
        <div className="text-center py-16 text-slate-500 bg-slate-800/50 rounded-xl border border-dashed border-slate-700">
          <HardDrive size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-base font-medium text-slate-400">No devices connected</p>
          <p className="text-sm mt-1 mb-5">
            Add a local path, external drive, or remote Mac to get started
          </p>
          <button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white px-5 py-2.5 rounded-lg transition-colors"
          >
            <Plus size={15} />
            Add First Device
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {devices.map((device) => (
            <DeviceCard
              key={device.id}
              device={device}
              onScan={() => handleScan(device)}
              onRefresh={() => handleRefresh(device)}
              onDisconnect={() => handleDisconnect(device)}
            />
          ))}
        </div>
      )}

      {/* Detected volumes — click + to register as a device */}
      {volumes.length > 0 && (
        <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-4">
          <h3 className="text-sm font-medium text-slate-300 mb-3">Detected Volumes</h3>
          <div className="flex flex-wrap gap-2">
            {volumes.map((vol) => {
              const alreadyAdded = devices.some(
                (d) => (d.connection_info as { path?: string } | null)?.path === vol.path
              )
              return (
                <div
                  key={vol.path}
                  className="flex items-center gap-2 bg-slate-700 rounded-lg px-3 py-2 text-xs text-slate-300"
                >
                  <HardDrive size={12} className="text-slate-500" />
                  <span>{vol.name}</span>
                  <span className="text-slate-500">{formatBytes(vol.free_bytes)} free</span>
                  {alreadyAdded ? (
                    <span className="text-green-500 ml-1">Added</span>
                  ) : (
                    <button
                      onClick={async () => {
                        try {
                          const device = await devicesApi.connect({
                            name: vol.name,
                            type: vol.device_type === 'external' ? 'external' : 'mac',
                            connection_info: { path: vol.path },
                          })
                          addDevice(device)
                        } catch (err) {
                          alert((err as Error).message)
                        }
                      }}
                      className="ml-1 p-0.5 rounded text-blue-400 hover:text-blue-300 hover:bg-blue-900/30 transition-colors"
                      title={`Add ${vol.name} as a device`}
                    >
                      <Plus size={12} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Add Device Modal */}
      {showModal && (
        <AddDeviceModal
          volumes={volumes}
          onClose={() => setShowModal(false)}
          onAdded={(device) => {
            addDevice(device)
            setShowModal(false)
          }}
        />
      )}
    </div>
  )
}
