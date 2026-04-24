/**
 * Axios API client for NeatDrive.
 * Resolves the backend base URL from the Electron preload bridge at runtime,
 * falling back to localhost for browser-based development.
 */

import axios, { AxiosInstance } from 'axios'

// ── Types ─────────────────────────────────────────────────────────────────

export interface Device {
  id: number
  name: string
  type: 'mac' | 'iphone' | 'android' | 'external' | 'remote'
  connection_info?: Record<string, unknown> | null
  last_scanned?: string | null
  total_files: number
  total_size: number
  is_connected: boolean
  created_at: string
}

export interface VolumeInfo {
  name: string
  path: string
  total_bytes: number
  used_bytes: number
  free_bytes: number
  fstype: string
  device_type: 'mac' | 'external'
}

export interface ConnectDevicePayload {
  name: string
  type: Device['type']
  connection_info: {
    path?: string
    ip?: string
    port?: number
    username?: string
    ssh_key_path?: string
    password?: string
    adb_serial?: string
    ios_udid?: string
  }
}

export interface ScanStartPayload {
  device_ids: number[]
  file_types?: string[] | null
  scan_depth?: 'shallow' | 'deep'
  exclusion_patterns?: string[] | null
}

export interface ScanJob {
  id: number
  status: 'pending' | 'running' | 'done' | 'failed'
  files_found: number
  files_indexed: number
  scan_depth: string
  created_at: string | null
  completed_at: string | null
}

export interface ScanResults {
  job_id: number
  status: string
  files_found: number
  files_indexed: number
  by_type: Record<string, number>
  by_size: Record<string, number>
  error?: string | null
}

export interface GlobalStats {
  total_files: number
  total_size_bytes: number
  duplicate_groups: number
  space_recoverable_bytes: number
  connected_devices: number
}

// ── Client factory ────────────────────────────────────────────────────────

let _client: AxiosInstance | null = null

async function getBaseUrl(): Promise<string> {
  // Electron environment: ask main process for the backend URL
  if (typeof window !== 'undefined' && window.electronAPI?.getBackendUrl) {
    return window.electronAPI.getBackendUrl()
  }
  // Browser dev / fallback
  return 'http://127.0.0.1:8000'
}

async function getClient(): Promise<AxiosInstance> {
  if (_client) return _client

  const baseURL = await getBaseUrl()
  _client = axios.create({
    baseURL,
    timeout: 30_000,
    headers: { 'Content-Type': 'application/json' },
  })

  // Global error interceptor — normalises error messages
  _client.interceptors.response.use(
    (res) => res,
    (err) => {
      const message: string =
        err.response?.data?.detail ??
        err.response?.data?.message ??
        err.message ??
        'Unknown error'
      return Promise.reject(new Error(message))
    }
  )

  return _client
}

// ── Re-initialise client (e.g. after settings change) ─────────────────────

export function resetClient(): void {
  _client = null
}

// ── Device endpoints ──────────────────────────────────────────────────────

export const devicesApi = {
  list: async (): Promise<Device[]> => {
    const c = await getClient()
    return (await c.get<Device[]>('/api/devices')).data
  },

  listLocalVolumes: async (): Promise<VolumeInfo[]> => {
    const c = await getClient()
    return (await c.get<VolumeInfo[]>('/api/devices/local/volumes')).data
  },

  connect: async (payload: ConnectDevicePayload): Promise<Device> => {
    const c = await getClient()
    return (await c.post<Device>('/api/devices/connect', payload)).data
  },

  get: async (id: number): Promise<Device> => {
    const c = await getClient()
    return (await c.get<Device>(`/api/devices/${id}`)).data
  },

  update: async (id: number, fields: Partial<Pick<Device, 'name'> & { connection_info: Record<string, unknown> }>): Promise<Device> => {
    const c = await getClient()
    return (await c.patch<Device>(`/api/devices/${id}`, fields)).data
  },

  disconnect: async (id: number): Promise<void> => {
    const c = await getClient()
    await c.delete(`/api/devices/${id}`)
  },

  refresh: async (id: number): Promise<Device> => {
    const c = await getClient()
    return (await c.post<Device>(`/api/devices/${id}/refresh`)).data
  },
}

// ── Scan endpoints ────────────────────────────────────────────────────────

export const scanApi = {
  start: async (payload: ScanStartPayload): Promise<{ job_id: number; status: string }> => {
    const c = await getClient()
    return (await c.post('/api/scan/start', payload)).data
  },

  getStatus: async (jobId: number) => {
    const c = await getClient()
    return (await c.get(`/api/scan/${jobId}/status`)).data
  },

  getResults: async (jobId: number): Promise<ScanResults> => {
    const c = await getClient()
    return (await c.get<ScanResults>(`/api/scan/${jobId}/results`)).data
  },

  listJobs: async (): Promise<ScanJob[]> => {
    const c = await getClient()
    return (await c.get<ScanJob[]>('/api/scan/jobs')).data
  },

  hashDevice: async (deviceId: number) => {
    const c = await getClient()
    return (await c.post('/api/scan/hash', { device_id: deviceId })).data
  },

  detectDuplicates: async (deviceIds: number[]) => {
    const c = await getClient()
    return (await c.post('/api/scan/duplicates', { device_ids: deviceIds })).data
  },

  /** Open a WebSocket connection to receive live progress events. */
  openProgressSocket: async (
    jobId: number,
    onMessage: (data: Record<string, unknown>) => void,
    onClose?: () => void,
    onError?: (e: Event) => void
  ): Promise<WebSocket> => {
    const baseUrl = await getBaseUrl()
    const wsUrl = baseUrl.replace(/^http/, 'ws') + `/api/scan/${jobId}/progress`
    const ws = new WebSocket(wsUrl)

    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data as string)
        onMessage(data)
      } catch {
        /* ignore malformed frames */
      }
    }
    ws.onclose = () => onClose?.()
    ws.onerror = (e) => onError?.(e)

    return ws
  },
}

// ── Global stats ──────────────────────────────────────────────────────────

export const statsApi = {
  global: async (): Promise<GlobalStats> => {
    const c = await getClient()
    return (await c.get<GlobalStats>('/api/stats')).data
  },
}
