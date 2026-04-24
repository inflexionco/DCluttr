/**
 * Zustand global state store for NeatDrive.
 *
 * Organised into slice-like sub-stores:
 *   deviceStore  — connected devices + connection status
 *   scanStore    — active scan jobs + results
 *   duplicateStore — duplicate groups + review state (Phase 2)
 *   uiStore      — theme, sidebar, notifications
 */

import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import {
  Device,
  GlobalStats,
  ScanJob,
  ScanResults,
  devicesApi,
  scanApi,
  statsApi,
} from '../api/client'

// ── Device slice ──────────────────────────────────────────────────────────

interface DeviceSlice {
  devices: Device[]
  devicesLoading: boolean
  devicesError: string | null

  fetchDevices: () => Promise<void>
  addDevice: (device: Device) => void
  removeDevice: (id: number) => void
  updateDevice: (device: Device) => void
}

// ── Scan slice ────────────────────────────────────────────────────────────

export interface ScanProgressEvent {
  job_id: number
  status: string
  files_found: number
  files_indexed: number
  current_path: string
  error?: string | null
  by_type?: Record<string, number>
  by_size?: Record<string, number>
  heartbeat?: boolean
}

interface ActiveScan {
  jobId: number
  progress: ScanProgressEvent
  socket: WebSocket | null
}

interface ScanSlice {
  scanJobs: ScanJob[]
  activeScan: ActiveScan | null
  lastScanResults: ScanResults | null
  scanLoading: boolean
  scanError: string | null

  fetchScanJobs: () => Promise<void>
  startScan: (deviceIds: number[], options?: {
    fileTypes?: string[]
    scanDepth?: 'shallow' | 'deep'
    exclusionPatterns?: string[]
  }) => Promise<number>  // returns jobId
  updateScanProgress: (event: ScanProgressEvent) => void
  closeScanSocket: () => void
  fetchScanResults: (jobId: number) => Promise<void>
}

// ── Stats slice ───────────────────────────────────────────────────────────

interface StatsSlice {
  globalStats: GlobalStats | null
  statsLoading: boolean
  fetchStats: () => Promise<void>
}

// ── UI slice ──────────────────────────────────────────────────────────────

type Theme = 'light' | 'dark' | 'system'

interface UISlice {
  theme: Theme
  sidebarCollapsed: boolean
  notifications: Notification[]

  setTheme: (theme: Theme) => void
  toggleSidebar: () => void
  addNotification: (n: Omit<Notification, 'id'>) => void
  removeNotification: (id: string) => void
}

interface Notification {
  id: string
  type: 'info' | 'success' | 'warning' | 'error'
  title: string
  message?: string
  duration?: number  // ms; 0 = permanent
}

// ── Combined store ────────────────────────────────────────────────────────

type AppStore = DeviceSlice & ScanSlice & StatsSlice & UISlice

let _notifCounter = 0

export const useAppStore = create<AppStore>()(
  devtools(
    (set, get) => ({
      // ── Devices ──────────────────────────────────────────────────────────
      devices: [],
      devicesLoading: false,
      devicesError: null,

      fetchDevices: async () => {
        set({ devicesLoading: true, devicesError: null })
        try {
          const devices = await devicesApi.list()
          set({ devices, devicesLoading: false })
        } catch (err) {
          set({
            devicesError: (err as Error).message,
            devicesLoading: false,
          })
        }
      },

      addDevice: (device) =>
        set((state) => ({ devices: [...state.devices, device] })),

      removeDevice: (id) =>
        set((state) => ({ devices: state.devices.filter((d) => d.id !== id) })),

      updateDevice: (updated) =>
        set((state) => ({
          devices: state.devices.map((d) => (d.id === updated.id ? updated : d)),
        })),

      // ── Scans ─────────────────────────────────────────────────────────────
      scanJobs: [],
      activeScan: null,
      lastScanResults: null,
      scanLoading: false,
      scanError: null,

      fetchScanJobs: async () => {
        try {
          const jobs = await scanApi.listJobs()
          set({ scanJobs: jobs })
        } catch (err) {
          console.error('fetchScanJobs:', err)
        }
      },

      startScan: async (deviceIds, options = {}) => {
        set({ scanLoading: true, scanError: null, lastScanResults: null })

        try {
          const { job_id } = await scanApi.start({
            device_ids: deviceIds,
            file_types: options.fileTypes ?? null,
            scan_depth: options.scanDepth ?? 'deep',
            exclusion_patterns: options.exclusionPatterns ?? null,
          })

          const initialProgress: ScanProgressEvent = {
            job_id,
            status: 'pending',
            files_found: 0,
            files_indexed: 0,
            current_path: '',
          }

          set({ activeScan: { jobId: job_id, progress: initialProgress, socket: null } })

          // Open WebSocket for live progress
          const socket = await scanApi.openProgressSocket(
            job_id,
            (data) => {
              const event = data as ScanProgressEvent
              if (event.heartbeat) return
              get().updateScanProgress(event)

              if (event.status === 'done' || event.status === 'failed') {
                get().fetchScanResults(job_id)
                get().fetchDevices()
                set({ scanLoading: false })
              }
            },
            () => {
              // Socket closed
              set((state) => ({
                activeScan: state.activeScan
                  ? { ...state.activeScan, socket: null }
                  : null,
              }))
            }
          )

          set((state) => ({
            activeScan: state.activeScan
              ? { ...state.activeScan, socket }
              : null,
          }))

          return job_id
        } catch (err) {
          set({ scanError: (err as Error).message, scanLoading: false })
          throw err
        }
      },

      updateScanProgress: (event) =>
        set((state) => ({
          activeScan: state.activeScan
            ? { ...state.activeScan, progress: event }
            : null,
        })),

      closeScanSocket: () => {
        const { activeScan } = get()
        activeScan?.socket?.close()
        set({ activeScan: null })
      },

      fetchScanResults: async (jobId) => {
        try {
          const results = await scanApi.getResults(jobId)
          set({ lastScanResults: results })
        } catch (err) {
          console.error('fetchScanResults:', err)
        }
      },

      // ── Stats ─────────────────────────────────────────────────────────────
      globalStats: null,
      statsLoading: false,

      fetchStats: async () => {
        set({ statsLoading: true })
        try {
          const stats = await statsApi.global()
          set({ globalStats: stats, statsLoading: false })
        } catch {
          set({ statsLoading: false })
        }
      },

      // ── UI ────────────────────────────────────────────────────────────────
      theme: 'dark',
      sidebarCollapsed: false,
      notifications: [],

      setTheme: (theme) => {
        set({ theme })
        document.documentElement.classList.toggle('dark', theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches))
      },

      toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

      addNotification: (n) => {
        const id = String(++_notifCounter)
        const notification: Notification = { ...n, id }
        set((state) => ({ notifications: [...state.notifications, notification] }))

        if (n.duration !== 0) {
          setTimeout(
            () => get().removeNotification(id),
            n.duration ?? 4000
          )
        }
      },

      removeNotification: (id) =>
        set((state) => ({
          notifications: state.notifications.filter((n) => n.id !== id),
        })),
    }),
    { name: 'NeatDriveStore' }
  )
)
