#!/usr/bin/env bun
/**
 * Browser Session Server v2.0.0 - Debug-First Persistent Browser
 *
 * Persistent Playwright browser with ALWAYS-ON event capture.
 * Console logs, network requests, and errors captured from launch.
 *
 * Usage:
 *   # Started automatically by Browse.ts (not directly)
 *   BROWSER_PORT=9222 bun run BrowserSession.ts
 *
 * New API (v2.0.0):
 *   GET  /diagnostics  - Full diagnostic summary (errors, warnings, failed requests)
 *   GET  /console      - All console logs
 *   GET  /network      - All network activity
 *
 * Standard API:
 *   GET  /health       - Server health check
 *   GET  /session      - Current session info
 *   POST /navigate     - Navigate to URL (clears logs for fresh page)
 *   POST /click        - Click element
 *   POST /fill         - Fill input
 *   POST /screenshot   - Take screenshot
 *   GET  /text         - Get visible text
 *   POST /evaluate     - Run JavaScript
 *   POST /stop         - Stop server
 */

import { PlaywrightBrowser } from '../index'

const CONFIG = {
  port: parseInt(process.env.BROWSER_PORT || '9222', 10),
  headless: process.env.BROWSER_HEADLESS === 'true',
  viewport: {
    width: parseInt(process.env.BROWSER_WIDTH || '1920', 10),
    height: parseInt(process.env.BROWSER_HEIGHT || '1080', 10)
  },
  stateFile: '/tmp/browser-session.json',
  idleTimeout: 30 * 60 * 1000 // 30 minutes
}

const browser = new PlaywrightBrowser()
const sessionId = crypto.randomUUID().slice(0, 8)
const startedAt = new Date().toISOString()
let lastActivity = Date.now()

// ============================================
// STATE MANAGEMENT
// ============================================

async function saveState(): Promise<void> {
  try {
    const state = {
      pid: process.pid,
      port: CONFIG.port,
      sessionId,
      startedAt,
      headless: CONFIG.headless,
      url: browser.getUrl()
    }
    await Bun.write(CONFIG.stateFile, JSON.stringify(state, null, 2))
  } catch (error) {
    console.error('Failed to save state:', error)
  }
}

async function cleanup(): Promise<void> {
  console.log('\nShutting down browser session...')
  try {
    await browser.close()
  } catch {}
  try {
    const file = Bun.file(CONFIG.stateFile)
    if (await file.exists()) {
      await Bun.write(CONFIG.stateFile, '')
      const fs = await import('node:fs/promises')
      await fs.unlink(CONFIG.stateFile)
    }
  } catch {}
  console.log('Session closed.')
  process.exit(0)
}

// ============================================
// IDLE TIMEOUT
// ============================================

function checkIdleTimeout(): void {
  const idle = Date.now() - lastActivity
  if (idle > CONFIG.idleTimeout) {
    console.log(`Idle timeout (${Math.round(idle / 60000)} minutes) - shutting down`)
    cleanup()
  }
}

// Check every minute
setInterval(checkIdleTimeout, 60 * 1000)

// ============================================
// RESPONSE HELPERS
// ============================================

type JsonPayload = unknown
type JsonObject = Record<string, unknown>
type NavigateWaitUntil = 'load' | 'domcontentloaded' | 'networkidle' | 'commit'
type WaitForSelectorState = 'attached' | 'detached' | 'visible' | 'hidden'
type WaitForTextState = 'visible' | 'hidden'
type ConsoleLogType = 'all' | 'error' | 'warning' | 'log' | 'info' | 'debug'
const CONSOLE_LOG_TYPES = new Set<ConsoleLogType>([
  'all', 'error', 'warning', 'log', 'info', 'debug'
])
const NAVIGATE_WAIT_UNTIL_VALUES = new Set<NavigateWaitUntil>([
  'load',
  'domcontentloaded',
  'networkidle',
  'commit'
])
const WAIT_FOR_SELECTOR_STATE_VALUES = new Set<WaitForSelectorState>([
  'attached',
  'detached',
  'visible',
  'hidden'
])
const WAIT_FOR_TEXT_STATE_VALUES = new Set<WaitForTextState>([
  'visible',
  'hidden'
])

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readJsonObject(req: Request): Promise<JsonObject> {
  const body = await req.json()
  if (!isJsonObject(body)) {
    throw new Error('JSON body must be an object')
  }
  return body
}

function getString(body: JsonObject, key: string): string | undefined {
  const value = body[key]
  return typeof value === 'string' ? value : undefined
}

function getNumber(body: JsonObject, key: string): number | undefined {
  const value = body[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function getBoolean(body: JsonObject, key: string): boolean | undefined {
  const value = body[key]
  return typeof value === 'boolean' ? value : undefined
}

function getNavigateWaitUntil(body: JsonObject): NavigateWaitUntil | undefined {
  const value = getString(body, 'waitUntil')
  if (!value) return undefined
  return NAVIGATE_WAIT_UNTIL_VALUES.has(value as NavigateWaitUntil)
    ? (value as NavigateWaitUntil)
    : undefined
}

function getWaitForSelectorState(body: JsonObject): WaitForSelectorState | undefined {
  const value = getString(body, 'state')
  if (!value) return undefined
  return WAIT_FOR_SELECTOR_STATE_VALUES.has(value as WaitForSelectorState)
    ? (value as WaitForSelectorState)
    : undefined
}

function getWaitForTextState(body: JsonObject): WaitForTextState | undefined {
  const value = getString(body, 'state')
  if (!value) return undefined
  return WAIT_FOR_TEXT_STATE_VALUES.has(value as WaitForTextState)
    ? (value as WaitForTextState)
    : undefined
}

function getSelectValue(body: JsonObject): string | string[] | undefined {
  const value = body.value
  if (typeof value === 'string') return value
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
    return value as string[]
  }
  return undefined
}

function json(data: JsonPayload, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  })
}

function success(data?: JsonPayload): Response {
  return json({ success: true, data })
}

function error(message: string, status = 500): Response {
  return json({ success: false, error: message }, status)
}

// ============================================
// LAUNCH BROWSER
// ============================================

console.log('Starting browser session...')
console.log(`  Port: ${CONFIG.port}`)
console.log(`  Headless: ${CONFIG.headless}`)
console.log(`  Viewport: ${CONFIG.viewport.width}x${CONFIG.viewport.height}`)
console.log(`  Idle timeout: ${CONFIG.idleTimeout / 60000} minutes`)

await browser.launch({
  headless: CONFIG.headless,
  viewport: CONFIG.viewport
})

// ============================================
// HTTP SERVER
// ============================================

const _server = Bun.serve({
  port: CONFIG.port,

  async fetch(req) {
    const url = new URL(req.url)
    const method = req.method

    // Update activity timestamp on every request
    lastActivity = Date.now()

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      })
    }

    try {
      // ========================================
      // DIAGNOSTIC ENDPOINTS (NEW in v2.0.0)
      // ========================================

      // Full diagnostics - errors, warnings, failed requests, stats
      if (url.pathname === '/diagnostics' && method === 'GET') {
        const allLogs = browser.getConsoleLogs()
        const errors = allLogs.filter(l => l.type === 'error')
        const warnings = allLogs.filter(l => l.type === 'warning')

        const networkLogs = browser.getNetworkLogs({ type: 'response' })
        const failedRequests = networkLogs
          .filter(l => l.status !== undefined && l.status >= 400)
          .map(l => ({
            url: l.url,
            method: l.method,
            status: l.status ?? 0,
            statusText: l.statusText
          }))

        const stats = browser.getNetworkStats()

        return success({
          errors,
          warnings,
          failedRequests,
          stats,
          pageTitle: await browser.getTitle(),
          pageUrl: browser.getUrl()
        })
      }

      // Console logs
      if (url.pathname === '/console' && method === 'GET') {
        const typeParam = url.searchParams.get('type')
        const type = typeParam && CONSOLE_LOG_TYPES.has(typeParam as ConsoleLogType)
          ? (typeParam as ConsoleLogType)
          : undefined
        const limit = parseInt(url.searchParams.get('limit') || '100', 10)
        const logs = browser.getConsoleLogs({ type: type || undefined, limit })
        return success(logs)
      }

      // Network logs
      if (url.pathname === '/network' && method === 'GET') {
        const limit = parseInt(url.searchParams.get('limit') || '100', 10)
        const logs = browser.getNetworkLogs({ limit })
        return success(logs)
      }

      // ========================================
      // STANDARD ENDPOINTS
      // ========================================

      // Health check
      if (url.pathname === '/health' && method === 'GET') {
        return success({
          status: 'ok',
          sessionId,
          uptime: Date.now() - new Date(startedAt).getTime()
        })
      }

      // Session info
      if (url.pathname === '/session' && method === 'GET') {
        return success({
          sessionId,
          startedAt,
          port: CONFIG.port,
          headless: CONFIG.headless,
          url: browser.getUrl(),
          title: await browser.getTitle(),
          idleTimeout: `${CONFIG.idleTimeout / 60000} minutes`,
          lastActivity: new Date(lastActivity).toISOString()
        })
      }

      // Navigate - CLEARS LOGS for fresh page diagnostics
      if (url.pathname === '/navigate' && method === 'POST') {
        const body = await readJsonObject(req)
        const targetUrl = getString(body, 'url')
        if (!targetUrl) return error('url required', 400)

        // Clear logs before navigating for clean diagnostic slate
        browser.getConsoleLogs({ clear: true })
        browser.clearNetworkLogs()

        await browser.navigate(targetUrl, {
          waitUntil: getNavigateWaitUntil(body) || 'networkidle'
        })
        await saveState()

        return success({
          url: browser.getUrl(),
          title: await browser.getTitle()
        })
      }

      // Click
      if (url.pathname === '/click' && method === 'POST') {
        const body = await readJsonObject(req)
        const selector = getString(body, 'selector')
        if (!selector) return error('selector required', 400)
        await browser.click(selector, { timeout: getNumber(body, 'timeout') })
        return success({ clicked: selector })
      }

      // Fill
      if (url.pathname === '/fill' && method === 'POST') {
        const body = await readJsonObject(req)
        const selector = getString(body, 'selector')
        const value = getString(body, 'value')
        if (!selector || value === undefined) return error('selector and value required', 400)
        await browser.fill(selector, value)
        return success({ filled: selector })
      }

      // Type (character by character)
      if (url.pathname === '/type' && method === 'POST') {
        const body = await readJsonObject(req)
        const selector = getString(body, 'selector')
        const text = getString(body, 'text')
        if (!selector || !text) return error('selector and text required', 400)
        await browser.type(selector, text, getNumber(body, 'delay'))
        return success({ typed: selector })
      }

      // Screenshot
      if (url.pathname === '/screenshot' && method === 'POST') {
        const body = await readJsonObject(req)
        const path = getString(body, 'path') || '/tmp/screenshot.png'
        await browser.screenshot({
          path,
          fullPage: getBoolean(body, 'fullPage') || false,
          selector: getString(body, 'selector')
        })
        return success({ path })
      }

      // Get visible text
      if (url.pathname === '/text' && method === 'GET') {
        const selector = url.searchParams.get('selector') || undefined
        const text = await browser.getVisibleText(selector)
        return success({ text })
      }

      // Get HTML
      if (url.pathname === '/html' && method === 'GET') {
        const selector = url.searchParams.get('selector') || undefined
        const html = await browser.getVisibleHtml({ selector })
        return success({ html })
      }

      // Evaluate JavaScript
      if (url.pathname === '/evaluate' && method === 'POST') {
        const body = await readJsonObject(req)
        const script = getString(body, 'script')
        if (!script) return error('script required', 400)
        const result = await browser.evaluate(script)
        return success({ result })
      }

      // Wait for selector
      if (url.pathname === '/wait' && method === 'POST') {
        const body = await readJsonObject(req)
        const selector = getString(body, 'selector')
        if (!selector) return error('selector required', 400)
        await browser.waitForSelector(selector, {
          state: getWaitForSelectorState(body),
          timeout: getNumber(body, 'timeout')
        })
        return success({ found: selector })
      }

      // Wait for text
      if (url.pathname === '/wait-text' && method === 'POST') {
        const body = await readJsonObject(req)
        const text = getString(body, 'text')
        if (!text) return error('text required', 400)
        await browser.waitForText(text, {
          state: getWaitForTextState(body),
          timeout: getNumber(body, 'timeout')
        })
        return success({ found: text })
      }

      // Hover
      if (url.pathname === '/hover' && method === 'POST') {
        const body = await readJsonObject(req)
        const selector = getString(body, 'selector')
        if (!selector) return error('selector required', 400)
        await browser.hover(selector)
        return success({ hovered: selector })
      }

      // Press key
      if (url.pathname === '/press' && method === 'POST') {
        const body = await readJsonObject(req)
        const key = getString(body, 'key')
        if (!key) return error('key required', 400)
        await browser.pressKey(key, getString(body, 'selector'))
        return success({ pressed: key })
      }

      // Select dropdown
      if (url.pathname === '/select' && method === 'POST') {
        const body = await readJsonObject(req)
        const selector = getString(body, 'selector')
        const value = getSelectValue(body)
        if (!selector || value === undefined) return error('selector and value required', 400)
        await browser.select(selector, value)
        return success({ selected: value })
      }

      // Tabs - list
      if (url.pathname === '/tabs' && method === 'GET') {
        const tabs = browser.getTabs()
        return success({ tabs })
      }

      // Tabs - new
      if (url.pathname === '/tabs' && method === 'POST') {
        const body = await readJsonObject(req)
        const newTabUrl = getString(body, 'url')
        await browser.newTab(newTabUrl)
        return success({ created: true, url: newTabUrl })
      }

      // Tabs - close
      if (url.pathname.startsWith('/tabs/') && method === 'DELETE') {
        const index = parseInt(url.pathname.split('/')[2], 10)
        if (Number.isNaN(index)) return error('invalid tab index', 400)
        await browser.switchTab(index)
        await browser.closeTab()
        return success({ closed: index })
      }

      // Tabs - switch
      if (url.pathname.startsWith('/tabs/') && method === 'POST') {
        const index = parseInt(url.pathname.split('/')[2], 10)
        if (Number.isNaN(index)) return error('invalid tab index', 400)
        await browser.switchTab(index)
        return success({ switched: index })
      }

      // Reload
      if (url.pathname === '/reload' && method === 'POST') {
        await browser.reload()
        return success({ reloaded: true })
      }

      // Go back
      if (url.pathname === '/back' && method === 'POST') {
        await browser.goBack()
        return success({ back: true })
      }

      // Go forward
      if (url.pathname === '/forward' && method === 'POST') {
        await browser.goForward()
        return success({ forward: true })
      }

      // Resize viewport
      if (url.pathname === '/resize' && method === 'POST') {
        const body = await readJsonObject(req)
        const width = getNumber(body, 'width')
        const height = getNumber(body, 'height')
        if (width === undefined || height === undefined) return error('width and height required', 400)
        await browser.resize(width, height)
        return success({ width, height })
      }

      // Stop server
      if (url.pathname === '/stop' && method === 'POST') {
        setTimeout(() => cleanup(), 100)
        return success({ stopping: true })
      }

      return error('Not found', 404)

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('Request error:', message)
      return error(message)
    }
  }
})

await saveState()
console.log(`\nBrowser session started!`)
console.log(`  Session ID: ${sessionId}`)
console.log(`  URL: http://localhost:${CONFIG.port}`)
console.log(`  Diagnostics: http://localhost:${CONFIG.port}/diagnostics`)
console.log(`\nSession will auto-close after ${CONFIG.idleTimeout / 60000} minutes of inactivity.`)
console.log(`Press Ctrl+C to stop manually.`)

// Cleanup handlers
process.on('SIGTERM', cleanup)
process.on('SIGINT', cleanup)
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err)
  cleanup()
})
