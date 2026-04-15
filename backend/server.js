import express from 'express'
import cors from 'cors'
import { exec, spawn } from 'child_process'
import { promisify } from 'util'
import { createServer } from 'http'
import net from 'net'
import os from 'os'
import path from 'path'

const execAsync = promisify(exec)
const app = express()
const PORT = process.env.PORT || 3000

// Paths
const HOME = os.homedir()
const DEV_DIR = process.env.DEV_DIR || path.join(HOME, 'Projects_dev/artificial-notes')
const PROD_DIR = process.env.PROD_DIR || path.join(HOME, 'Projects/artificial-notes')
const SCRIPTS_DIR = path.join(DEV_DIR, 'scripts')

// SSE clients for log streaming
const sseClients = new Set()

app.use(cors())
app.use(express.json())

// ── Helpers ──────────────────────────────────────────────────────────────────

function isPortListening(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    socket.setTimeout(500)
    socket.on('connect', () => { socket.destroy(); resolve(true) })
    socket.on('timeout', () => { socket.destroy(); resolve(false) })
    socket.on('error', () => { socket.destroy(); resolve(false) })
    socket.connect(port, '127.0.0.1')
  })
}

async function getLaunchdStatus() {
  try {
    const { stdout } = await execAsync('launchctl list 2>/dev/null | grep artificialnotes || true')
    return stdout.trim()
  } catch {
    return ''
  }
}

function broadcastLog(source, line) {
  const data = JSON.stringify({ source, line, ts: Date.now() })
  for (const client of sseClients) {
    client.write(`data: ${data}\n\n`)
  }
}

function runScript(scriptPath, args = [], source = 'script') {
  return new Promise((resolve, reject) => {
    const proc = spawn('bash', [scriptPath, ...args], {
      env: { ...process.env, HOME },
      cwd: path.dirname(scriptPath),
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean)
      lines.forEach((line) => {
        stdout += line + '\n'
        broadcastLog(source, line)
      })
    })

    proc.stderr.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean)
      lines.forEach((line) => {
        stderr += line + '\n'
        broadcastLog(source, `[stderr] ${line}`)
      })
    })

    proc.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr, code })
      else reject({ stdout, stderr, code, error: `Script exited with code ${code}` })
    })

    proc.on('error', (err) => {
      reject({ error: err.message, code: -1 })
    })
  })
}

// ── Routes ───────────────────────────────────────────────────────────────────

// GET /api/status — full status snapshot
app.get('/api/status', async (req, res) => {
  const [devBackend, devFrontend, prodApp] = await Promise.all([
    isPortListening(8001),
    isPortListening(5174),
    isPortListening(8000),
  ])

  const launchd = await getLaunchdStatus()

  // Parse launchd lines
  const prodBackendRunning = launchd.includes('backend') && !launchd.match(/^-\s+\d+\s+com.*backend/)
  const prodFrontendRunning = launchd.includes('frontend') && !launchd.match(/^-\s+\d+\s+com.*frontend/)

  res.json({
    dev: {
      backend: { port: 8001, running: devBackend },
      frontend: { port: 5174, running: devFrontend },
      url: 'http://localhost:5174',
    },
    prod: {
      app: { port: 8000, running: prodApp },
      launchd: launchd || null,
      url: process.env.PROD_URL || 'https://artificialnotes.app',
    },
  })
})

// POST /api/dev/start
app.post('/api/dev/start', async (req, res) => {
  const script = path.join(SCRIPTS_DIR, 'start-dev.sh')
  try {
    // Run in background — don't await (it blocks waiting for processes)
    spawn('bash', [script], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, HOME },
      cwd: DEV_DIR,
    }).unref()

    // Wait a moment and report status
    await new Promise((r) => setTimeout(r, 2000))
    const [backend, frontend] = await Promise.all([
      isPortListening(8001),
      isPortListening(5174),
    ])
    res.json({ ok: true, backend, frontend })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.error || String(err) })
  }
})

// POST /api/dev/stop
app.post('/api/dev/stop', async (req, res) => {
  const script = path.join(SCRIPTS_DIR, 'stop-dev.sh')
  try {
    await runScript(script, [], 'dev-stop')
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.error || String(err) })
  }
})

// POST /api/prod/deploy
app.post('/api/prod/deploy', async (req, res) => {
  const script = path.join(SCRIPTS_DIR, 'deploy.sh')
  // Respond immediately — client watches SSE logs
  res.json({ ok: true, message: 'Deploy started, watch logs via /api/logs' })
  try {
    await runScript(script, [], 'deploy')
  } catch (err) {
    broadcastLog('deploy', `[ERROR] Deploy failed: ${err.error || err}`)
  }
})

// POST /api/prod/stop
app.post('/api/prod/stop', async (req, res) => {
  try {
    await execAsync(`launchctl stop com.artificialnotes.backend 2>/dev/null || true`)
    await execAsync(`launchctl stop com.artificialnotes.frontend 2>/dev/null || true`)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) })
  }
})

// POST /api/prod/restart
app.post('/api/prod/restart', async (req, res) => {
  try {
    await execAsync(`launchctl kickstart -k gui/$(id -u)/com.artificialnotes.backend 2>/dev/null || true`)
    await execAsync(`launchctl kickstart -k gui/$(id -u)/com.artificialnotes.frontend 2>/dev/null || true`)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) })
  }
})

// GET /api/health — quick health check hitting the prod API
app.get('/api/health', async (req, res) => {
  const checks = await Promise.all([
    isPortListening(8000).then((up) => ({ service: 'prod-app', port: 8000, up })),
    isPortListening(8001).then((up) => ({ service: 'dev-backend', port: 8001, up })),
    isPortListening(5174).then((up) => ({ service: 'dev-frontend', port: 5174, up })),
  ])

  // Try hitting the actual prod /health endpoint
  let prodApiHealth = null
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)
    const r = await fetch('http://localhost:8000/health', { signal: controller.signal })
    clearTimeout(timeout)
    prodApiHealth = { status: r.status, ok: r.status === 200 }
  } catch {
    prodApiHealth = { status: null, ok: false }
  }

  res.json({ checks, prodApiHealth })
})

// GET /api/logs — SSE stream for live log output
app.get('/api/logs', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  sseClients.add(res)
  req.on('close', () => sseClients.delete(res))
})

app.listen(PORT, () => {
  console.log(`Dashboard backend running on http://localhost:${PORT}`)
  console.log(`DEV_DIR:  ${DEV_DIR}`)
  console.log(`PROD_DIR: ${PROD_DIR}`)
})
