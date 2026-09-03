import { BrowserWindow, screen, type Rectangle } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

const NORMAL_MIN_WIDTH = 960
const NORMAL_MIN_HEIGHT = 640
const COMPANION_MIN_WIDTH = 360
const COMPANION_MIN_HEIGHT = 480
const COMPANION_WIDTH = 360
const COMPANION_HEIGHT = 720

export type CompanionWindowState = {
  enabled: boolean
  alwaysOnTop: boolean
}

type WindowPreferences = {
  schemaVersion: 1
  companion: CompanionWindowState & { bounds?: Rectangle }
  regularBounds?: Rectangle
  regularMaximized: boolean
  regularFullScreen: boolean
}

const defaultPreferences = (): WindowPreferences => ({
  schemaVersion: 1,
  companion: { enabled: false, alwaysOnTop: true },
  regularMaximized: false,
  regularFullScreen: false,
})

export class WindowController {
  private window: BrowserWindow | null = null
  private saveTimer: NodeJS.Timeout | null = null
  private writeQueue: Promise<void> = Promise.resolve()
  private operationQueue: Promise<void> = Promise.resolve()
  private flushPromise: Promise<void> | null = null
  private applyingCompanionMode = false
  private finalizing = false

  private constructor(
    private readonly preferencesPath: string,
    private preferences: WindowPreferences,
  ) {}

  static async load(dataRoot: string) {
    const preferencesPath = path.join(dataRoot, 'window-preferences.json')
    let preferences = defaultPreferences()
    try {
      preferences = normalizePreferences(JSON.parse(await readFile(preferencesPath, 'utf8')))
    } catch (error: any) {
      if (error?.code !== 'ENOENT') console.warn('failed to read window preferences', error)
    }
    return new WindowController(preferencesPath, preferences)
  }

  initialWindowOptions() {
    const companion = this.preferences.companion.enabled
    const fallback = companion
      ? companionBounds()
      : centeredBounds(NORMAL_MIN_WIDTH + 220, NORMAL_MIN_HEIGHT + 180)
    const saved = companion
      ? normalizeCompanionBounds(this.preferences.companion.bounds)
      : this.preferences.regularBounds
    const bounds = clampToDisplay(saved || fallback, companion)
    return {
      ...bounds,
      minWidth: Math.min(companion ? COMPANION_MIN_WIDTH : NORMAL_MIN_WIDTH, bounds.width),
      minHeight: Math.min(companion ? COMPANION_MIN_HEIGHT : NORMAL_MIN_HEIGHT, bounds.height),
      resizable: !companion,
      alwaysOnTop: companion && this.preferences.companion.alwaysOnTop,
    }
  }

  attach(window: BrowserWindow) {
    this.window = window
    const capture = () => this.scheduleCapture()
    const captureMaximized = () => {
      if (!this.applyingCompanionMode && !this.finalizing && !this.preferences.companion.enabled) {
        this.preferences.regularMaximized = window.isMaximized()
      }
      this.scheduleCapture()
    }
    const captureFullScreen = () => {
      if (!this.applyingCompanionMode && !this.finalizing && !this.preferences.companion.enabled) {
        this.preferences.regularFullScreen = window.isFullScreen()
      }
      this.scheduleCapture()
    }
    window.on('move', capture)
    window.on('resize', capture)
    window.on('maximize', captureMaximized)
    window.on('unmaximize', captureMaximized)
    window.on('enter-full-screen', captureFullScreen)
    window.on('leave-full-screen', captureFullScreen)
    window.on('close', () => {
      if (this.finalizing) return
      if (this.saveTimer) clearTimeout(this.saveTimer)
      this.saveTimer = null
      this.captureWindowState()
      void this.persist().catch((error) => console.warn('failed to save window preferences', error))
    })
    if (!this.preferences.companion.enabled) {
      if (this.preferences.regularMaximized) window.maximize()
      if (this.preferences.regularFullScreen) window.setFullScreen(true)
    }
  }

  state(): CompanionWindowState {
    return {
      enabled: this.preferences.companion.enabled,
      alwaysOnTop: this.preferences.companion.alwaysOnTop,
    }
  }

  setCompanionMode(enabled: boolean) {
    return this.enqueueWindowOperation(() => this.applyCompanionMode(enabled))
  }

  setCompanionAlwaysOnTop(alwaysOnTop: boolean) {
    return this.enqueueWindowOperation(() => this.applyCompanionAlwaysOnTop(alwaysOnTop))
  }

  async flush() {
    if (this.flushPromise) return this.flushPromise
    this.finalizing = true
    this.flushPromise = this.flushBeforeQuit()
    return this.flushPromise
  }

  private async applyCompanionMode(enabled: boolean) {
    const window = this.requireWindow()
    if (enabled === this.preferences.companion.enabled) return this.state()
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null

    this.applyingCompanionMode = true
    try {
      if (enabled) {
        this.preferences.regularBounds = validBounds(window.getNormalBounds()) || validBounds(window.getBounds())
        this.preferences.regularFullScreen = window.isFullScreen()
        if (!this.preferences.regularFullScreen) this.preferences.regularMaximized = window.isMaximized()
        await leaveFullScreen(window)
        if (window.isMaximized()) window.unmaximize()
        window.setMinimumSize(COMPANION_MIN_WIDTH, COMPANION_MIN_HEIGHT)
        const target = clampToDisplay(
          normalizeCompanionBounds(this.preferences.companion.bounds) || companionBounds(window.getBounds()),
          true,
        )
        window.setResizable(false)
        window.setBounds(target, true)
        window.setAlwaysOnTop(this.preferences.companion.alwaysOnTop, 'floating')
        this.preferences.companion.enabled = true
      } else {
        this.preferences.companion.bounds = validBounds(window.getNormalBounds()) || validBounds(window.getBounds())
        await leaveFullScreen(window)
        window.setAlwaysOnTop(false)
        window.setResizable(true)
        const target = clampToDisplay(
          this.preferences.regularBounds || centeredBounds(NORMAL_MIN_WIDTH + 220, NORMAL_MIN_HEIGHT + 180),
          false,
        )
        window.setMinimumSize(Math.min(NORMAL_MIN_WIDTH, target.width), Math.min(NORMAL_MIN_HEIGHT, target.height))
        window.setBounds(target, true)
        this.preferences.companion.enabled = false
        if (this.preferences.regularMaximized) window.maximize()
        if (this.preferences.regularFullScreen) window.setFullScreen(true)
      }
    } finally {
      this.applyingCompanionMode = false
    }

    await this.persist()
    return this.state()
  }

  private async applyCompanionAlwaysOnTop(alwaysOnTop: boolean) {
    const window = this.requireWindow()
    this.preferences.companion.alwaysOnTop = alwaysOnTop
    if (this.preferences.companion.enabled) window.setAlwaysOnTop(alwaysOnTop, 'floating')
    await this.persist()
    return this.state()
  }

  private enqueueWindowOperation<T>(operation: () => Promise<T>): Promise<T> {
    if (this.finalizing) return Promise.reject(new Error('应用正在退出'))
    const next = this.operationQueue.then(operation)
    this.operationQueue = next.then(() => undefined, (error) => {
      console.warn('window operation failed', error)
    })
    return next
  }

  private requireWindow() {
    if (!this.window || this.window.isDestroyed()) throw new Error('主窗口尚未就绪')
    return this.window
  }

  private scheduleCapture() {
    if (this.applyingCompanionMode || this.finalizing) return
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.captureWindowState()
      void this.persist().catch((error) => console.warn('failed to save window preferences', error))
    }, 200)
  }

  private captureWindowState() {
    const window = this.window
    if (!window || window.isDestroyed()) return
    if (this.preferences.companion.enabled) {
      if (!window.isFullScreen()) {
        this.preferences.companion.bounds = validBounds(window.getNormalBounds()) || validBounds(window.getBounds())
      }
      return
    }
    this.preferences.regularFullScreen = window.isFullScreen()
    const normalBounds = validBounds(window.getNormalBounds())
    if (normalBounds) this.preferences.regularBounds = normalBounds
    if (window.isFullScreen()) return
    this.preferences.regularMaximized = window.isMaximized()
    if (!normalBounds) this.preferences.regularBounds = validBounds(window.getBounds())
  }

  private async flushBeforeQuit() {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    await this.operationQueue
    this.captureWindowState()

    let persistError: unknown
    try {
      await this.persist()
    } catch (error) {
      persistError = error
    }
    await this.writeQueue
    if (persistError) throw persistError
  }

  private async persist() {
    const directory = path.dirname(this.preferencesPath)
    const temporaryPath = `${this.preferencesPath}.tmp`
    const snapshot = `${JSON.stringify(this.preferences, null, 2)}\n`
    const write = this.writeQueue.then(async () => {
      await mkdir(directory, { recursive: true })
      await writeFile(temporaryPath, snapshot)
      await rename(temporaryPath, this.preferencesPath)
    })
    this.writeQueue = write.catch((error) => {
      console.warn('failed to persist window preferences', error)
    })
    return write
  }
}

function normalizePreferences(value: any): WindowPreferences {
  const defaults = defaultPreferences()
  if (!value || value.schemaVersion !== 1) return defaults
  return {
    schemaVersion: 1,
    companion: {
      enabled: typeof value.companion?.enabled === 'boolean' ? value.companion.enabled : false,
      alwaysOnTop: typeof value.companion?.alwaysOnTop === 'boolean' ? value.companion.alwaysOnTop : true,
      bounds: normalizeCompanionBounds(validBounds(value.companion?.bounds)),
    },
    regularBounds: validBounds(value.regularBounds),
    regularMaximized: typeof value.regularMaximized === 'boolean' ? value.regularMaximized : false,
    regularFullScreen: typeof value.regularFullScreen === 'boolean' ? value.regularFullScreen : false,
  }
}

function validBounds(value: any): Rectangle | undefined {
  if (!value || !['x', 'y', 'width', 'height'].every((key) => Number.isFinite(value[key]))) return undefined
  if (value.width < 240 || value.height < 320 || value.width > 10000 || value.height > 10000) return undefined
  return { x: value.x, y: value.y, width: value.width, height: value.height }
}

function normalizeCompanionBounds(bounds?: Rectangle): Rectangle | undefined {
  if (!bounds) return undefined
  return {
    ...bounds,
    x: bounds.x + bounds.width - COMPANION_WIDTH,
    width: COMPANION_WIDTH,
    height: COMPANION_HEIGHT,
  }
}

function centeredBounds(width: number, height: number): Rectangle {
  const { workArea } = screen.getPrimaryDisplay()
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width,
    height,
  }
}

function companionBounds(relativeTo?: Rectangle): Rectangle {
  const display = relativeTo ? screen.getDisplayMatching(relativeTo) : screen.getPrimaryDisplay()
  const { workArea } = display
  return {
    x: workArea.x + workArea.width - COMPANION_WIDTH - 24,
    y: workArea.y + 24,
    width: COMPANION_WIDTH,
    height: COMPANION_HEIGHT,
  }
}

function clampToDisplay(bounds: Rectangle, companion: boolean): Rectangle {
  const { workArea } = screen.getDisplayMatching(bounds)
  const minWidth = companion ? COMPANION_MIN_WIDTH : NORMAL_MIN_WIDTH
  const minHeight = companion ? COMPANION_MIN_HEIGHT : NORMAL_MIN_HEIGHT
  const width = Math.min(Math.max(bounds.width, minWidth), workArea.width)
  const height = Math.min(Math.max(bounds.height, minHeight), workArea.height)
  const x = Math.min(Math.max(bounds.x, workArea.x), workArea.x + workArea.width - width)
  const y = Math.min(Math.max(bounds.y, workArea.y), workArea.y + workArea.height - height)
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
}

async function leaveFullScreen(window: BrowserWindow) {
  if (!window.isFullScreen()) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 1000)
    window.once('leave-full-screen', () => {
      clearTimeout(timer)
      resolve()
    })
    window.setFullScreen(false)
  })
  if (window.isFullScreen()) throw new Error('无法退出全屏模式')
}
