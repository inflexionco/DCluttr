/**
 * Electron main process for NeatDrive.
 *
 * Responsibilities:
 * - Spawn the Python FastAPI backend as a child process
 * - Create the main BrowserWindow
 * - Handle IPC from renderer via contextBridge
 * - Manage app lifecycle (quit, reload, window state)
 */

import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'

// ── Constants ──────────────────────────────────────────────────────────────
const BACKEND_HOST = '127.0.0.1'
const BACKEND_PORT = 8000
const BACKEND_URL = `http://${BACKEND_HOST}:${BACKEND_PORT}`
const DEV_RENDERER_URL = 'http://localhost:5173'
const IS_DEV = !app.isPackaged

// ── Backend process handle ─────────────────────────────────────────────────
let backendProcess: ChildProcess | null = null

function startBackend(): void {
  const pythonBin = IS_DEV ? 'python' : path.join(process.resourcesPath, 'venv', 'bin', 'python')
  const scriptPath = IS_DEV
    ? path.join(__dirname, '..', '..', 'backend', 'main.py')
    : path.join(process.resourcesPath, 'backend', 'main.py')

  backendProcess = spawn(
    pythonBin,
    ['-m', 'backend.main'],
    {
      cwd: IS_DEV ? path.join(__dirname, '..', '..') : process.resourcesPath,
      env: {
        ...process.env,
        NEATDRIVE_HOST: BACKEND_HOST,
        NEATDRIVE_PORT: String(BACKEND_PORT),
        NEATDRIVE_RELOAD: IS_DEV ? 'false' : 'false',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )

  backendProcess.stdout?.on('data', (data: Buffer) => {
    console.log('[backend]', data.toString().trim())
  })

  backendProcess.stderr?.on('data', (data: Buffer) => {
    console.error('[backend:err]', data.toString().trim())
  })

  backendProcess.on('exit', (code) => {
    console.log(`[backend] process exited with code ${code}`)
    backendProcess = null
  })
}

function stopBackend(): void {
  if (backendProcess) {
    backendProcess.kill('SIGTERM')
    backendProcess = null
  }
}

/** Poll until the backend HTTP server responds or timeout. */
async function waitForBackend(timeoutMs = 10_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BACKEND_URL}/health`)
      if (res.ok) return
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  console.warn('[main] Backend did not start within timeout — continuing anyway')
}

// ── Window ─────────────────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    titleBarStyle: 'hiddenInset',  // macOS native traffic lights
    backgroundColor: '#0f172a',    // slate-900 — prevents white flash
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (IS_DEV) {
    await mainWindow.loadURL(DEV_RENDERER_URL)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    await mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Open external links in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

// ── IPC handlers ───────────────────────────────────────────────────────────

/** Expose backend URL to renderer. */
ipcMain.handle('get-backend-url', () => BACKEND_URL)

/** Open a native folder picker and return the selected path. */
ipcMain.handle('pick-directory', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  })
  return result.canceled ? null : result.filePaths[0]
})

/** Open a native file picker. */
ipcMain.handle('pick-file', async (_event, filters?: Electron.FileFilter[]) => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: filters ?? [],
  })
  return result.canceled ? null : result.filePaths[0]
})

/** Check if a local path exists (for device connection validation). */
ipcMain.handle('path-exists', (_event, p: string) => {
  return fs.existsSync(p)
})

/** Open path in Finder / Explorer. */
ipcMain.handle('reveal-in-finder', (_event, p: string) => {
  shell.showItemInFolder(p)
})

/** Reload renderer — useful after settings change. */
ipcMain.handle('reload-window', () => {
  mainWindow?.reload()
})

// ── App lifecycle ──────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  startBackend()
  await waitForBackend()
  await createWindow()

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  // On macOS, keep the process running until Cmd+Q
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  stopBackend()
})

app.on('will-quit', () => {
  stopBackend()
})
