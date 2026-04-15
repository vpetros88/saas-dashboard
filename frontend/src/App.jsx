import { useState, useEffect, useRef, useCallback } from 'react'
import './App.css'

const API = 'http://localhost:3000/api'

function usePoll(fn, ms = 5000) {
  useEffect(() => {
    fn()
    const id = setInterval(fn, ms)
    return () => clearInterval(id)
  }, [fn, ms])
}

function Dot({ up }) {
  return <span className={`dot ${up ? 'dot-green' : 'dot-red'}`} />
}

function StatusRow({ label, up, port }) {
  return (
    <div className="status-row">
      <span className="status-label">{label}{port ? ` :${port}` : ''}</span>
      <span className="status-dot">
        <Dot up={up} />
        {up ? 'running' : 'stopped'}
      </span>
    </div>
  )
}

function EnvCard({ title, env, data, onAction }) {
  const isProd = env === 'prod'
  const devRunning = data?.backend?.running || data?.frontend?.running
  const devFullyRunning = data?.backend?.running && data?.frontend?.running

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">{title}</span>
        {isProd ? (
          <span className={`badge ${data?.app?.running ? 'badge-green' : 'badge-red'}`}>
            {data?.app?.running ? 'online' : 'offline'}
          </span>
        ) : (
          <span className={`badge ${devFullyRunning ? 'badge-green' : devRunning ? 'badge-yellow' : 'badge-gray'}`}>
            {devFullyRunning ? 'running' : devRunning ? 'partial' : 'stopped'}
          </span>
        )}
      </div>

      <div className="status-list">
        {isProd ? (
          <StatusRow label="App" port={8000} up={data?.app?.running} />
        ) : (
          <>
            <StatusRow label="Backend"  port={8001} up={data?.backend?.running}  />
            <StatusRow label="Frontend" port={5174} up={data?.frontend?.running} />
          </>
        )}
      </div>

      <div className="btn-row">
        {!isProd && (
          <>
            <button
              className="btn-success"
              onClick={() => onAction('dev/start')}
              disabled={devFullyRunning}
            >
              ▶ Start
            </button>
            <button
              className="btn-danger"
              onClick={() => onAction('dev/stop')}
              disabled={!devRunning}
            >
              ■ Stop
            </button>
          </>
        )}

        {isProd && (
          <>
            <button className="btn-primary" onClick={() => onAction('prod/deploy')}>
              🚀 Deploy
            </button>
            <button className="btn-outline" onClick={() => onAction('prod/restart')}>
              ↺ Restart
            </button>
            <button className="btn-danger" onClick={() => onAction('prod/stop')}>
              ■ Stop
            </button>
          </>
        )}

        <button className="btn-outline" onClick={() => onAction('health')}>
          ♥ Health
        </button>

        <a
          className="btn-link"
          href={isProd ? (data?.url || 'https://artificialnotes.app') : 'http://localhost:5174'}
          target="_blank"
          rel="noreferrer"
        >
          ↗ Open
        </a>
      </div>
    </div>
  )
}

function LogPanel({ logs, onClear }) {
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  return (
    <div className="log-panel">
      <div className="log-header">
        <span>Logs</span>
        <button className="refresh-btn" onClick={onClear}>clear</button>
      </div>
      <div className="log-body">
        {logs.length === 0 && (
          <span style={{ color: 'var(--muted)' }}>No logs yet. Run an action to see output.</span>
        )}
        {logs.map((l, i) => (
          <div
            key={i}
            className={[
              'log-line',
              l.line?.includes('[stderr]') ? 'stderr' : '',
              l.line?.startsWith('[ERROR]') ? 'error' : '',
            ].join(' ')}
          >
            <span style={{ color: 'var(--muted)', marginRight: 8 }}>
              {new Date(l.ts).toLocaleTimeString([], {
                hour: '2-digit', minute: '2-digit', second: '2-digit',
              })}
            </span>
            {l.line}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

function Toast({ msg, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3500)
    return () => clearTimeout(t)
  }, [msg, onDone])
  return <div className="toast">{msg}</div>
}

export default function App() {
  const [status, setStatus] = useState(null)
  const [logs, setLogs] = useState([])
  const [toast, setToast] = useState(null)
  const [lastRefresh, setLastRefresh] = useState(null)

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch(`${API}/status`)
      const data = await r.json()
      setStatus(data)
      setLastRefresh(new Date())
    } catch {
      // backend not reachable yet
    }
  }, [])

  usePoll(fetchStatus, 5000)

  // SSE live log stream
  useEffect(() => {
    const es = new EventSource(`${API}/logs`)
    es.onmessage = (e) => {
      const data = JSON.parse(e.data)
      setLogs((prev) => [...prev.slice(-300), data])
    }
    return () => es.close()
  }, [])

  async function handleAction(action) {
    if (action === 'health') {
      try {
        const r = await fetch(`${API}/health`)
        const data = await r.json()
        const summary = data.checks.map(c => `${c.service} ${c.up ? '✓' : '✗'}`).join('  ')
        setToast(`Health: ${summary}`)
        const lines = [
          ...data.checks.map(c => ({
            source: 'health',
            line: `${c.service} :${c.port} → ${c.up ? 'UP' : 'DOWN'}`,
            ts: Date.now(),
          })),
          data.prodApiHealth && {
            source: 'health',
            line: `prod /health endpoint → ${data.prodApiHealth.ok ? 'OK (200)' : `FAIL (${data.prodApiHealth.status ?? 'unreachable'})`}`,
            ts: Date.now(),
          },
        ].filter(Boolean)
        setLogs(prev => [...prev, ...lines])
      } catch {
        setToast('Dashboard backend not reachable')
      }
      return
    }

    try {
      const r = await fetch(`${API}/${action}`, { method: 'POST' })
      const data = await r.json()
      if (data.message) setToast(data.message)
      else if (data.ok) setToast(`${action} — ok`)
      else setToast(`Error: ${data.error || 'unknown'}`)
      await fetchStatus()
    } catch {
      setToast('Dashboard backend not reachable')
    }
  }

  const now = lastRefresh
    ? lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—'

  return (
    <div className="app">
      <div className="header">
        <h1>SaaS Dashboard</h1>
        <span className="header-meta">auto-refresh · {now}</span>
      </div>

      <div className="grid">
        <EnvCard title="Dev" env="dev" data={status?.dev} onAction={handleAction} />
        <EnvCard title="Production" env="prod" data={status?.prod} onAction={handleAction} />
      </div>

      <LogPanel logs={logs} onClear={() => setLogs([])} />

      {toast && <Toast msg={toast} onDone={() => setToast(null)} />}
    </div>
  )
}
