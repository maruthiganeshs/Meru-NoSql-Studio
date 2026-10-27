import Editor, { type BeforeMount, type OnMount } from '@monaco-editor/react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type SampleQuery, type SearchResult } from '../../api/client'
import { DocumentModal } from '../../components/DocumentModal'
import { useQuerySuggest } from '../../components/QuerySuggest'
import { flattenMappingTypes } from '../../components/FacetFilter'
import { StudioGrid } from '../../components/StudioGrid'
import { useOsPrivileges } from '../../hooks/useOsPrivileges'
import {
  ensureMeruEditorThemes,
  OS_JSON_LANG,
  registerOpenSearchCompletions,
  setCompletionFields,
} from '../../monaco/opensearchCompletions'
import { useTheme } from '../../state/theme'
import type { WorkspaceTab } from '../../state/workspace'

const DEFAULT_QUERY = `{
  "query": {
    "match_all": {}
  }
}`

type Props = { tab: WorkspaceTab }

export const QueryEditor = ({ tab }: Props) => {
  const { theme } = useTheme()
  const { canWriteDocs } = useOsPrivileges(tab.connectionId)
  const [body, setBody] = useState(DEFAULT_QUERY)
  const [samples, setSamples] = useState<SampleQuery[]>([])
  const [result, setResult] = useState<SearchResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'table' | 'json'>('table')
  const [viewRow, setViewRow] = useState<Record<string, unknown> | null>(null)
  const [running, setRunning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editor, setEditor] = useState<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const { suggestUi } = useQuerySuggest(editor)

  useEffect(() => {
    api.sampleQueries(tab.connectionId).then(setSamples).catch(() => setSamples([]))
  }, [tab.connectionId])

  useEffect(() => {
    let cancelled = false
    api
      .mapping(tab.connectionId, tab.indexName)
      .then(res => {
        if (cancelled) return
        setCompletionFields(Object.keys(flattenMappingTypes(res.mappings || {})))
      })
      .catch(() => {
        if (!cancelled) setCompletionFields([])
      })
    return () => {
      cancelled = true
    }
  }, [tab.connectionId, tab.indexName])

  const onEditorBeforeMount: BeforeMount = useCallback(monaco => {
    ensureMeruEditorThemes(monaco)
    registerOpenSearchCompletions(monaco)
  }, [])

  const onEditorMount: OnMount = useCallback(
    (ed, monaco) => {
      ensureMeruEditorThemes(monaco)
      registerOpenSearchCompletions(monaco)
      monaco.editor.setTheme(theme === 'dark' ? 'meru-dark' : 'meru-light')
      // Disable Monaco's native suggest UI — text was rendering blank in this app.
      // We use a React suggestion list instead (QuerySuggest).
      ed.updateOptions({
        quickSuggestions: false,
        suggestOnTriggerCharacters: false,
        wordBasedSuggestions: 'off',
        snippetSuggestions: 'none',
        parameterHints: { enabled: false },
        suggest: {
          showWords: false,
          showSnippets: false,
        },
      })
      setEditor(ed)
    },
    [theme],
  )

  const run = async () => {
    setRunning(true)
    setError(null)
    try {
      const parsed = JSON.parse(body)
      const res = await api.query(tab.connectionId, tab.indexName, parsed, 0, 100)
      setResult(res)
      setViewMode('table')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  const rows = useMemo(() => {
    if (!result) return []
    return result.hits.map(h => ({ _id: h._id, ...(h._source || {}) }))
  }, [result])

  const onSave = async (source: Record<string, unknown>) => {
    if (!viewRow?._id) return
    setSaving(true)
    try {
      await api.updateDocument(tab.connectionId, tab.indexName, String(viewRow._id), source)
      setViewRow({ _id: viewRow._id, ...source })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="panel query-layout">
      <aside className="samples">
        <h3>Sample queries</h3>
        <p className="muted sm">Sample OpenSearch query bodies</p>
        <ul className="list compact">
          {samples.map(s => (
            <li key={s.id}>
              <button type="button" className="linkish" onClick={() => setBody(s.body)}>
                {s.name}
              </button>
              {s.description && <div className="muted sm">{s.description}</div>}
            </li>
          ))}
        </ul>
      </aside>

      <div className="query-main" style={{ minWidth: 0 }}>
        <div className="toolbar">
          <h2>Query — {tab.indexName}</h2>
          <button type="button" className="btn primary" onClick={run} disabled={running}>
            {running ? (
              <>
                <span className="spinner" /> Running…
              </>
            ) : (
              'Run'
            )}
          </button>
        </div>
        <div className="editor-wrap">
          <Editor
            height="260px"
            defaultLanguage={OS_JSON_LANG}
            language={OS_JSON_LANG}
            theme={theme === 'dark' ? 'meru-dark' : 'meru-light'}
            value={body}
            onChange={v => setBody(v || '')}
            beforeMount={onEditorBeforeMount}
            onMount={onEditorMount}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              tabSize: 2,
              automaticLayout: true,
              formatOnPaste: true,
              formatOnType: true,
              quickSuggestions: false,
              suggestOnTriggerCharacters: false,
              wordBasedSuggestions: 'off',
            }}
          />
          {suggestUi}
        </div>

        {error && <div className="banner error">{error}</div>}

        {result && (
          <>
            <div className="toolbar">
              <span className="muted">
                {result.hits_total?.toLocaleString() ?? rows.length} hits
                {result.took != null ? ` · ${result.took}ms` : ''}
              </span>
              <div className="row gap">
                <button
                  type="button"
                  className={`btn sm ${viewMode === 'table' ? 'primary' : 'ghost'}`}
                  onClick={() => setViewMode('table')}
                >
                  Table
                </button>
                <button
                  type="button"
                  className={`btn sm ${viewMode === 'json' ? 'primary' : 'ghost'}`}
                  onClick={() => setViewMode('json')}
                >
                  JSON
                </button>
              </div>
            </div>
            {viewMode === 'table' ? (
              <StudioGrid rows={rows} onView={setViewRow} height="360px" />
            ) : (
              <pre className="json-block">{JSON.stringify(result.raw, null, 2)}</pre>
            )}
          </>
        )}
      </div>

      {viewRow && (
        <DocumentModal
          title={`Hit ${String(viewRow._id ?? '')}`}
          value={viewRow}
          canSave={canWriteDocs}
          saving={saving}
          onClose={() => setViewRow(null)}
          onSave={canWriteDocs ? onSave : undefined}
        />
      )}
    </div>
  )
}
