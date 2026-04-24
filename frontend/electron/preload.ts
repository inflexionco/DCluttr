/**
 * Electron preload script.
 * Runs in a privileged context with access to Node APIs but exposes only
 * a narrow, typed API surface to the renderer via contextBridge.
 *
 * Security model:
 * - contextIsolation: true  → renderer cannot access Node globals
 * - sandbox: true           → preload runs in renderer sandbox
 * - Only explicitly whitelisted IPC channels are exposed
 */

import { contextBridge, ipcRenderer } from 'electron'

// ── Type definitions exposed to the renderer window ───────────────────────

export interface ElectronAPI {
  /** Returns the FastAPI backend base URL (e.g. http://127.0.0.1:8000) */
  getBackendUrl: () => Promise<string>

  /** Open a native OS directory picker; returns chosen path or null. */
  pickDirectory: () => Promise<string | null>

  /** Open a native OS file picker with optional type filters. */
  pickFile: (filters?: Array<{ name: string; extensions: string[] }>) => Promise<string | null>

  /** Check if a local filesystem path exists. */
  pathExists: (path: string) => Promise<boolean>

  /** Reveal a file/folder in macOS Finder or Windows Explorer. */
  revealInFinder: (path: string) => Promise<void>

  /** Reload the renderer window. */
  reloadWindow: () => Promise<void>

  /** Platform string: 'darwin' | 'win32' | 'linux' */
  platform: string
}

// ── Expose safe API to renderer ───────────────────────────────────────────

contextBridge.exposeInMainWorld('electronAPI', {
  getBackendUrl: () => ipcRenderer.invoke('get-backend-url'),

  pickDirectory: () => ipcRenderer.invoke('pick-directory'),

  pickFile: (filters?: Array<{ name: string; extensions: string[] }>) =>
    ipcRenderer.invoke('pick-file', filters),

  pathExists: (path: string) => ipcRenderer.invoke('path-exists', path),

  revealInFinder: (path: string) => ipcRenderer.invoke('reveal-in-finder', path),

  reloadWindow: () => ipcRenderer.invoke('reload-window'),

  platform: process.platform,
} satisfies ElectronAPI)

// ── Global type augmentation ───────────────────────────────────────────────
// This makes `window.electronAPI` typed in the renderer without needing imports.

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
