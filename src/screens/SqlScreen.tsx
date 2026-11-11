import { useCallback, useEffect, useRef, useState } from 'react'
import { Database, Play, Loader2, RefreshCw, Table2, ChevronRight, ArrowLeft, Square } from 'lucide-react'
import { useRemoteStore, sendConfirmed } from '../lib/store'
import { isDeclined } from './bridgeHelpers'

/** Rows per result set the bridge sends back: a phone cannot render 250k rows anyway. */
const MAX_ROWS = 1000

// same keywords and comment stripping as isMutatingSql in the bridge (commands.ts), which asks
// to confirm these: only they report affected rows (a SELECT's count is not a modification)
const MUTATING_SQL = /\b(DROP|TRUNCATE|ALTER|DELETE|UPDATE|INSERT|MERGE|EXEC|EXECUTE|CREATE|GRANT|REVOKE|BACKUP|RESTORE|DBCC)\b/i

function isMutatingSql(query: string): boolean {
  return MUTATING_SQL.test(query.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' '))
}

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
  truncated?: boolean
  maxRows?: number
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
  const [resultMutating, setResultMutating] = useState(false)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [listLoading, setListLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // databases and tables share one list: a late answer for the previous one is dropped
  const listSeq = useRef(0)
  const running = runningId !== null

  const loadList = async (fetchList: () => Promise<string[]>, apply: (list: string[]) => void) => {
    const seq = ++listSeq.current
    setListLoading(true)
    try {
      const list = await fetchList()
      if (seq === listSeq.current) apply(list)
    } catch (e) {
      if (seq === listSeq.current) setError((e as Error).message)
    } finally {
      if (seq === listSeq.current) setListLoading(false)
    }
  }

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
    void loadList(() => send<string[]>('sql.databases', { connectionId }), setDatabases)
  }, [connectionId, send])

  const openDatabase = (db: string) => {
    setDatabase(db)
    setTables([])
    setError(null)
    void loadList(() => send<string[]>('sql.tables', { connectionId, database: db }), setTables)
  }

  const closeDatabase = () => {
    listSeq.current++
    setListLoading(false)
    setDatabase(null)
  }

  const insertTable = (table: string) => {
    setQuery((q) => `${q}${table}`)
  }

  const run = async () => {
    if (!connectionId || !query.trim() || running) return
    // our own id, so 'annulla' can name the running query. The bridge keeps it only if it matches
    // /^remote_[\w-]{1,64}$/ (the prefix keeps the phone off the desktop's own queries), otherwise
    // it picks its own and the cancel finds nothing to stop
    const queryId = `remote_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    setRunningId(queryId)
    setError(null)
    try {
      const res = await sendConfirmed<QueryResult>('sql.query', { connectionId, query, database, maxRows: MAX_ROWS, queryId })
      setResult(res)
      setResultMutating(isMutatingSql(query))
    } catch (e) {
      if (!isDeclined(e)) setError((e as Error).message)
    } finally {
      setRunningId(null)
    }
  }

  const cancel = async () => {
    if (!runningId) return
    try {
      await send('sql.cancel', { queryId: runningId })
    } catch (e) {
      setError((e as Error).message)
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
                  <button className="btn small" onClick={closeDatabase}><ArrowLeft size={13} /></button>
                  <span className="badge">{database}</span>
                </>
              ) : (
                <span className="muted"><Database size={13} /> database</span>
              )}
            </div>
          </div>
          <div className="list">
            {listLoading && (
              <div className="muted row" style={{ justifyContent: 'center', padding: 12 }}>
                <Loader2 size={14} className="spinner" /> caricamento…
              </div>
            )}
            {!listLoading && (database ? tables : databases).length === 0 && (
              <div className="muted" style={{ textAlign: 'center', padding: 12 }}>
                {database ? 'nessuna tabella' : 'nessun database'}
              </div>
            )}
            {!database
              ? databases.map((db) => (
                <button key={db} className="list-item" onClick={() => openDatabase(db)}>
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
          <textarea
            className="code"
            style={{ minHeight: 120 }}
            value={query}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                void run()
              }
            }}
          />
        </label>
        <div className="row between">
          <span className="muted mono" style={{ fontSize: 11 }}>Ctrl+Invio per eseguire</span>
          <div className="row">
            {/* ponytail: shown to every bridge, but the released 0.1.0 ignores queryId and answers
                sql.cancel with ok, so there 'annulla' silently stops nothing; gate it on
                system.info ideVersion if 0.1.0 desktops linger */}
            {running && (
              <button className="btn danger" onClick={() => void cancel()}>
                <Square size={15} /> annulla
              </button>
            )}
            <button className="btn primary" onClick={() => void run()} disabled={running || !connectionId}>
              {running ? <Loader2 size={15} className="spinner" /> : <Play size={15} />} esegui
            </button>
          </div>
        </div>
      </div>

      {result && (
        <div className="card">
          <div className="muted mono" style={{ fontSize: 11 }}>
            {result.canceled ? 'query annullata' : `${result.totalRowCount} righe`} · {result.elapsedMs} ms
            {result.truncated ? ` · troncate a ${result.maxRows ?? MAX_ROWS} per risultato` : ''}
            {resultMutating && result.rowsAffected?.length ? ` · ${result.rowsAffected.join(', ')} righe modificate` : ''}
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
