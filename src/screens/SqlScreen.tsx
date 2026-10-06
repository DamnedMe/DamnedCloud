import { useCallback, useEffect, useState } from 'react'
import { Database, Play, Loader2, RefreshCw, Table2, ChevronRight, ArrowLeft } from 'lucide-react'
import { useRemoteStore, sendConfirmed } from '../lib/store'

interface Conn {
  id: string
  label: string
  server: string
  database?: string
  isConnected: boolean
}

interface QueryResult {
  queryId: string
  results: { columns: string[]; rows: Record<string, unknown>[]; rowCount: number }[]
  totalRowCount: number
  elapsedMs: number
  rowsAffected: number[]
  canceled: boolean
  error?: string
}

export function SqlScreen() {
  const send = useRemoteStore((s) => s.send)
  const [connections, setConnections] = useState<Conn[]>([])
  const [connectionId, setConnectionId] = useState<string | null>(null)
  const [database, setDatabase] = useState<string | null>(null)
  const [databases, setDatabases] = useState<string[]>([])
  const [tables, setTables] = useState<string[]>([])
  const [query, setQuery] = useState('SELECT TOP 100 * FROM ')
  const [result, setResult] = useState<QueryResult | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadConnections = useCallback(async () => {
    setError(null)
    try {
      const list = await send<Conn[]>('sql.connections')
      setConnections(list)
      if (!connectionId && list.length) setConnectionId(list[0].id)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [send, connectionId])

  useEffect(() => {
    void loadConnections()
  }, [loadConnections])

  useEffect(() => {
    if (!connectionId) return
    setDatabases([])
    setTables([])
    setDatabase(null)
    void (async () => {
      try {
        setDatabases(await send<string[]>('sql.databases', { connectionId }))
      } catch (e) {
        setError((e as Error).message)
      }
    })()
  }, [connectionId, send])

  const openDatabase = async (db: string) => {
    setDatabase(db)
    setError(null)
    try {
      setTables(await send<string[]>('sql.tables', { connectionId, database: db }))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const insertTable = (table: string) => {
    setQuery((q) => `${q}${table}`)
  }

  const run = async () => {
    if (!connectionId || !query.trim()) return
    setRunning(true)
    setError(null)
    try {
      setResult(await sendConfirmed<QueryResult>('sql.query', { connectionId, query, database }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <>
      <div className="row between">
        <div className="row">
          <Database size={16} color="var(--accent)" />
          <strong>SQL Server</strong>
        </div>
        <button className="btn small" onClick={() => void loadConnections()}>
          <RefreshCw size={13} />
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="card">
        <label className="field">
          Connessione (già aperta sul desktop)
          <select value={connectionId ?? ''} onChange={(e) => setConnectionId(e.target.value)}>
            {connections.length === 0 && <option value="">nessuna connessione</option>}
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label} · {c.server} {c.isConnected ? '' : '(offline)'}
              </option>
            ))}
          </select>
        </label>
      </div>

      {connectionId && (
        <>
          <div className="row between">
            <div className="row">
              {database ? (
                <>
                  <button className="btn small" onClick={() => setDatabase(null)}><ArrowLeft size={13} /></button>
                  <span className="badge">{database}</span>
                </>
              ) : (
                <span className="muted"><Database size={13} /> database</span>
              )}
            </div>
          </div>
          <div className="list">
            {!database
              ? databases.map((db) => (
                <button key={db} className="list-item" onClick={() => void openDatabase(db)}>
                  <Database size={15} color="var(--accent)" />
                  <span style={{ flex: 1 }}>{db}</span>
                  <ChevronRight size={15} color="var(--text-muted)" />
                </button>
              ))
              : tables.map((t) => (
                <button key={t} className="list-item" onClick={() => insertTable(t)}>
                  <Table2 size={15} color="var(--accent)" />
                  <span style={{ flex: 1 }}>{t}</span>
                </button>
              ))}
          </div>
        </>
      )}

      <div className="card">
        <label className="field">
          Query
          <textarea className="code" style={{ minHeight: 120 }} value={query} spellCheck={false} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="row between">
          <span className="muted mono" style={{ fontSize: 11 }}>F5 per eseguire</span>
          <button className="btn primary" onClick={() => void run()} disabled={running || !connectionId}>
            {running ? <Loader2 size={15} className="spinner" /> : <Play size={15} />} esegui
          </button>
        </div>
      </div>

      {result && (
        <div className="card">
          <div className="muted mono" style={{ fontSize: 11 }}>
            {result.totalRowCount} righe · {result.elapsedMs} ms
            {result.rowsAffected?.length ? ` · ${result.rowsAffected.join(', ')} righe modificate` : ''}
          </div>
          {result.results.map((rs, idx) => (
            <div key={idx} style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 11.5, fontFamily: 'var(--mono)', minWidth: '100%' }}>
                <thead>
                  <tr>
                    {rs.columns.map((col) => (
                      <th key={col} style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--border)', color: 'var(--accent)' }}>
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rs.rows.slice(0, 200).map((row, r) => (
                    <tr key={r}>
                      {rs.columns.map((col) => (
                        <td key={col} style={{ padding: '3px 8px', borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' }}>
                          {row[col] === null || row[col] === undefined ? <span className="muted">NULL</span> : String(row[col])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {rs.rows.length > 200 && <div className="muted" style={{ padding: 6 }}>… mostrate 200 di {rs.rows.length}</div>}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
