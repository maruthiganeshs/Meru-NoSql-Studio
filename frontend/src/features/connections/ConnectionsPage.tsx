import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type Connection, type ConnectionInput, type OsPrivileges } from '../../api/client'
import { useWorkspace } from '../../state/workspace'

const emptyForm: ConnectionInput = {
  name: '',
  engine_type: 'opensearch',
  host_url: 'https://',
  auth_mode: 'basic',
  ssl_verify: true,
  username: '',
  password: '',
  api_key: '',
}

export const ConnectionsPage = () => {
  const navigate = useNavigate()
  const { connections, setConnections, setActiveConnectionId, activeConnectionId } = useWorkspace()
  const [form, setForm] = useState<ConnectionInput>(emptyForm)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [lastProbe, setLastProbe] = useState<OsPrivileges | null>(null)

  const reload = async () => {
    const list = await api.listConnections()
    setConnections(list)
  }

  useEffect(() => {
    reload().catch(err => setError(err.message))
  }, [])

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const { os_privileges: _ignored, ...payload } = form as ConnectionInput & {
        os_privileges?: unknown
      }
      if (editingId != null) {
        await api.updateConnection(editingId, payload)
        setMessage('Connection updated')
      } else {
        await api.createConnection(payload)
        setMessage('Connection saved')
      }
      setForm(emptyForm)
      setEditingId(null)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const testDraft = async () => {
    setTesting(true)
    setError(null)
    setMessage(null)
    try {
      const result = await api.testDraft(form)
      if (result.ok) {
        setMessage(
          `Connection OK — ${result.cluster_name || 'cluster'} ${result.version || ''}`.trim(),
        )
        if (result.privileges) setLastProbe(result.privileges)
      } else {
        setError(result.message)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setTesting(false)
    }
  }

  const startEdit = (c: Connection) => {
    setEditingId(c.id)
    setForm({
      name: c.name,
      engine_type: c.engine_type as 'opensearch' | 'elasticsearch',
      host_url: c.host_url,
      auth_mode: c.auth_mode as ConnectionInput['auth_mode'],
      ssl_verify: c.ssl_verify,
      username: '',
      password: '',
      api_key: '',
    })
  }

  const onTest = async (id: number) => {
    setTesting(true)
    setError(null)
    try {
      const result = await api.testConnection(id)
      setMessage(
        result.ok
          ? `OK — ${result.cluster_name || 'cluster'} ${result.version || ''}`
          : result.message,
      )
      if (!result.ok) setError(result.message)
      if (result.privileges) setLastProbe(result.privileges)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setTesting(false)
    }
  }

  const onDelete = async (id: number) => {
    if (!confirm('Delete this connection?')) return
    await api.deleteConnection(id)
    if (activeConnectionId === id) setActiveConnectionId(null)
    await reload()
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Connections</h1>
          <p className="muted">
            Test before saving. Remote clusters require basic or API key auth. Index delete and
            other capabilities come from your OpenSearch account privileges.
          </p>
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}
      {message && <div className="banner ok">{message}</div>}

      <div className="split">
        <form className="card form" onSubmit={onSubmit}>
          <h2>{editingId != null ? 'Edit connection' : 'Add connection'}</h2>
          <label>
            Name
            <input
              className="input"
              required
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            Engine
            <select
              className="input"
              value={form.engine_type}
              onChange={e =>
                setForm({
                  ...form,
                  engine_type: e.target.value as ConnectionInput['engine_type'],
                })
              }
            >
              <option value="opensearch">OpenSearch</option>
              <option value="elasticsearch">Elasticsearch</option>
            </select>
          </label>
          <label>
            Host URL
            <input
              className="input"
              required
              value={form.host_url}
              onChange={e => setForm({ ...form, host_url: e.target.value })}
              placeholder="https://opensearch.example:9200"
            />
          </label>
          <label>
            Auth mode
            <select
              className="input"
              value={form.auth_mode}
              onChange={e =>
                setForm({ ...form, auth_mode: e.target.value as ConnectionInput['auth_mode'] })
              }
            >
              <option value="basic">Basic</option>
              <option value="apiKey">API key</option>
              <option value="none">None (localhost only)</option>
            </select>
          </label>
          {form.auth_mode === 'basic' && (
            <>
              <label>
                Username
                <input
                  className="input"
                  value={form.username || ''}
                  onChange={e => setForm({ ...form, username: e.target.value })}
                  required={editingId == null}
                />
              </label>
              <label>
                Password
                <input
                  className="input"
                  type="password"
                  value={form.password || ''}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  required={editingId == null}
                  placeholder={editingId != null ? '(unchanged if blank)' : ''}
                />
              </label>
            </>
          )}
          {form.auth_mode === 'apiKey' && (
            <label>
              API key
              <input
                className="input"
                type="password"
                value={form.api_key || ''}
                onChange={e => setForm({ ...form, api_key: e.target.value })}
                required={editingId == null}
              />
            </label>
          )}
          <label className="checkbox">
            <input
              type="checkbox"
              checked={form.ssl_verify}
              onChange={e => setForm({ ...form, ssl_verify: e.target.checked })}
            />
            Verify TLS certificates
          </label>

          {lastProbe && (
            <div className="banner ok">
              OpenSearch privileges ({lastProbe.source}
              {lastProbe.probe_available ? '' : ', heuristic'}): delete index=
              {String(lastProbe.index_delete)}, write docs={String(lastProbe.document_write)}
              {lastProbe.probe_error ? ` — ${lastProbe.probe_error}` : ''}
            </div>
          )}

          <div className="row gap wrap">
            <button type="button" className="btn" onClick={testDraft} disabled={testing || busy}>
              {testing ? (
                <>
                  <span className="spinner" /> Testing…
                </>
              ) : (
                'Test connection'
              )}
            </button>
            <button className="btn primary" type="submit" disabled={busy || testing}>
              {busy ? 'Saving…' : editingId != null ? 'Update' : 'Save'}
            </button>
            {editingId != null && (
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setEditingId(null)
                  setForm(emptyForm)
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </form>

        <div className="card">
          <h2>Saved ({connections.length})</h2>
          <ul className="list">
            {connections.map(c => (
              <li key={c.id} className={activeConnectionId === c.id ? 'active' : ''}>
                <div>
                  <strong>{c.name}</strong>
                  <div className="muted sm">
                    {c.engine_type} · {c.host_url} · {c.auth_mode}
                    {c.last_test_ok != null && (
                      <> · last test {c.last_test_ok ? 'OK' : 'FAIL'}</>
                    )}
                  </div>
                </div>
                <div className="row gap wrap">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setActiveConnectionId(c.id)
                      navigate('/cluster')
                    }}
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => onTest(c.id)}
                    disabled={testing}
                  >
                    {testing ? <span className="spinner" /> : 'Test'}
                  </button>
                  <button type="button" className="btn ghost" onClick={() => startEdit(c)}>
                    Edit
                  </button>
                  <button type="button" className="btn danger" onClick={() => onDelete(c.id)}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
            {connections.length === 0 && <li className="muted">No connections yet</li>}
          </ul>
        </div>
      </div>
    </div>
  )
}
