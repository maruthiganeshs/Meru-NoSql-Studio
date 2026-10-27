import { DocsBrowser } from '../docs/DocsBrowser'
import { ImportExportPanel } from '../importExport/ImportExportPanel'
import { QueryEditor } from '../query/QueryEditor'
import { SchemaViewer } from '../../components/SchemaViewer'
import { useWorkspace, type TabMode } from '../../state/workspace'

const modes: { id: TabMode; label: string }[] = [
  { id: 'docs', label: 'Documents' },
  { id: 'query', label: 'Query' },
  { id: 'schema', label: 'Schema' },
  { id: 'import-export', label: 'Import / Export' },
]

export const TabWorkspace = () => {
  const { tabs, activeTabId, setActiveTabId, closeTab, setTabMode } = useWorkspace()
  const active = tabs.find(t => t.id === activeTabId) || null

  if (!tabs.length) {
    return (
      <div className="page">
        <p className="muted">
          Open an index from the Cluster dashboard to start browsing documents in tabs.
        </p>
      </div>
    )
  }

  return (
    <div className="workspace">
      <div className="tab-bar">
        {tabs.map(tab => (
          <div
            key={tab.id}
            className={`tab ${tab.id === activeTabId ? 'active' : ''}`}
            onClick={() => setActiveTabId(tab.id)}
          >
            <span>
              {tab.connectionName} / {tab.indexName}
            </span>
            <button
              type="button"
              className="tab-close"
              onClick={e => {
                e.stopPropagation()
                closeTab(tab.id)
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {active && (
        <>
          <div className="mode-bar">
            {modes.map(m => (
              <button
                key={m.id}
                type="button"
                className={`btn sm ${active.mode === m.id ? 'primary' : 'ghost'}`}
                onClick={() => setTabMode(active.id, m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
          {active.mode === 'docs' && <DocsBrowser tab={active} />}
          {active.mode === 'query' && <QueryEditor tab={active} />}
          {active.mode === 'schema' && (
            <div className="panel">
              <SchemaViewer connectionId={active.connectionId} indexName={active.indexName} />
            </div>
          )}
          {active.mode === 'import-export' && <ImportExportPanel tab={active} />}
        </>
      )}
    </div>
  )
}
