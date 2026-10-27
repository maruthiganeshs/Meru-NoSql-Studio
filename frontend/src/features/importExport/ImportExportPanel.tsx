import Editor from '@monaco-editor/react'
import { useMemo, useState } from 'react'
import { api } from '../../api/client'
import { useTheme } from '../../state/theme'
import type { WorkspaceTab } from '../../state/workspace'

const ES_TYPES = [
  'text',
  'keyword',
  'long',
  'integer',
  'double',
  'float',
  'boolean',
  'date',
  'object',
  'nested',
  'ip',
  'binary',
]

type FieldMap = { field: string; type: string; suggested?: string }

type Props = { tab: WorkspaceTab }

export const ImportExportPanel = ({ tab }: Props) => {
  const { theme } = useTheme()
  const [raw, setRaw] = useState('[\n  { "name": "example", "count": 1 }\n]')
  const [indexName, setIndexName] = useState(tab.indexName)
  const [mappings, setMappings] = useState<FieldMap[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exportFormat, setExportFormat] = useState<'json' | 'jsonl' | 'csv'>('json')
  const [includeSchema, setIncludeSchema] = useState(true)
  const [exportQuery, setExportQuery] = useState('')
  const [busy, setBusy] = useState(false)

  const documents = useMemo(() => {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : null
    } catch {
      return null
    }
  }, [raw])

  const prepareMappings = async () => {
    setError(null)
    setMessage(null)
    if (!documents) {
      setError('Import body must be a JSON array of documents')
      return
    }
    setBusy(true)
    try {
      const inferred = await api.inferTypesFor(tab.connectionId, documents)
      const fields = new Set<string>()
      documents.forEach(d => Object.keys(d).forEach(k => k !== '_id' && fields.add(k)))
      const byField = Object.fromEntries(
        inferred.suggestions.map(s => [s.field, s.suggested_type]),
      )
      setMappings(
        Array.from(fields)
          .sort()
          .map(field => ({
            field,
            type: '',
            suggested: byField[field] || '',
          })),
      )
      setMessage(inferred.note)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const runImport = async () => {
    setError(null)
    setMessage(null)
    if (!documents) {
      setError('Invalid JSON documents')
      return
    }
    const missing = mappings.filter(m => !m.type.trim())
    if (missing.length) {
      setError(
        `Explicit type required for: ${missing.map(m => m.field).join(', ')} (no fallback)`,
      )
      return
    }
    setBusy(true)
    try {
      const result = await api.importDocs(tab.connectionId, {
        index: indexName,
        documents,
        field_mappings: mappings.map(m => ({ field: m.field, type: m.type })),
        create_index: true,
      })
      setMessage(
        `Indexed ${result.indexed} document(s)` +
          (result.errors.length ? `; ${result.errors.length} error(s)` : ''),
      )
      if (result.errors.length) setError(result.errors.slice(0, 5).join('\n'))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const runExport = async () => {
    setBusy(true)
    setError(null)
    try {
      let query: object | null = null
      const trimmed = exportQuery.trim()
      if (trimmed) {
        query = JSON.parse(trimmed)
      }
      const blob = await api.exportDocs(tab.connectionId, {
        index: tab.indexName,
        format: exportFormat,
        include_schema: includeSchema,
        query,
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${tab.indexName}.${exportFormat}`
      a.click()
      URL.revokeObjectURL(url)
      setMessage(trimmed ? 'Filtered export downloaded' : 'Full index export downloaded')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel">
      <h2>Import / Export — {tab.indexName}</h2>
      {error && <div className="banner error">{error}</div>}
      {message && <div className="banner ok">{message}</div>}

      <section className="card">
        <h3>Import</h3>
        <p className="muted">
          Every field must have an explicit OpenSearch type. Suggestions are advisory only.
        </p>
        <label>
          Target index
          <input className="input" value={indexName} onChange={e => setIndexName(e.target.value)} />
        </label>
        <textarea
          className="textarea"
          rows={10}
          value={raw}
          onChange={e => setRaw(e.target.value)}
          spellCheck={false}
        />
        <div className="row gap">
          <button type="button" className="btn" onClick={prepareMappings} disabled={busy}>
            Infer suggestions
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={runImport}
            disabled={busy || mappings.length === 0}
          >
            Import
          </button>
        </div>

        {mappings.length > 0 && (
          <div className="table-scroll mt" style={{ overflow: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Suggested</th>
                  <th>Explicit type (required)</th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((m, i) => (
                  <tr key={m.field}>
                    <td>{m.field}</td>
                    <td className="muted">{m.suggested || '—'}</td>
                    <td>
                      <select
                        className="input"
                        value={m.type}
                        onChange={e => {
                          const next = [...mappings]
                          next[i] = { ...m, type: e.target.value }
                          setMappings(next)
                        }}
                      >
                        <option value="">Select type…</option>
                        {ES_TYPES.map(t => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h3>Export</h3>
        <p className="muted">
          Optional query filters the export. Leave empty to export the whole index (match_all).
        </p>
        <div className="editor-wrap">
          <Editor
            height="180px"
            defaultLanguage="json"
            theme={theme === 'dark' ? 'vs-dark' : 'light'}
            value={exportQuery}
            onChange={v => setExportQuery(v || '')}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              tabSize: 2,
              automaticLayout: true,
            }}
          />
        </div>
        <div className="row gap wrap mt">
          <label>
            Format
            <select
              className="input"
              value={exportFormat}
              onChange={e => setExportFormat(e.target.value as typeof exportFormat)}
            >
              <option value="json">JSON</option>
              <option value="jsonl">JSONL</option>
              <option value="csv">CSV</option>
            </select>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={includeSchema}
              onChange={e => setIncludeSchema(e.target.checked)}
            />
            Include schema sidecar
          </label>
          <button type="button" className="btn" onClick={runExport} disabled={busy}>
            Download export
          </button>
        </div>
      </section>
    </div>
  )
}
