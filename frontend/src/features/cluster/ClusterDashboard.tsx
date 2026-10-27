import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ColDef } from 'ag-grid-community'
import {
  api,
  type ClusterOverview,
  type IndexSummary,
  type NodeSummary,
} from '../../api/client'
import { Gauge } from '../../components/Gauge'
import { SchemaViewer } from '../../components/SchemaViewer'
import { ActionsCell, StudioGrid } from '../../components/StudioGrid'
import { useOsPrivileges } from '../../hooks/useOsPrivileges'
import { useWorkspace } from '../../state/workspace'

const prettyBytes = (n: number) => {
  let v = n
  for (const u of ['B', 'KB', 'MB', 'GB', 'TB']) {
    if (v < 1024 || u === 'TB') return u === 'B' ? `${v} B` : `${v.toFixed(2)} ${u}`
    v /= 1024
  }
  return `${n}`
}

const statusClass = (s?: string | null) => {
  if (s === 'green') return 'green'
  if (s === 'yellow') return 'yellow'
  if (s === 'red') return 'red'
  return ''
}

export const ClusterDashboard = () => {
  const navigate = useNavigate()
  const { connections, activeConnectionId, openIndexTab } = useWorkspace()
  const conn = connections.find(c => c.id === activeConnectionId) || null
  const { canDeleteIndex, refresh: refreshPrivs } = useOsPrivileges(conn?.id ?? null)
  const [cluster, setCluster] = useState<ClusterOverview | null>(null)
  const [nodes, setNodes] = useState<NodeSummary[]>([])
  const [indices, setIndices] = useState<IndexSummary[]>([])
  const [schemaIndex, setSchemaIndex] = useState<string | null>(null)
  const [deleteIndex, setDeleteIndex] = useState<string | null>(null)
  const [confirmName, setConfirmName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const load = async () => {
    if (!conn) return
    setLoading(true)
    setError(null)
    try {
      const [c, n, i] = await Promise.all([
        api.cluster(conn.id),
        api.nodes(conn.id),
        api.indices(conn.id),
      ])
      setCluster(c)
      setNodes(n)
      setIndices(i)
      await refreshPrivs()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [conn?.id])

  const topStore = useMemo(() => {
    const sorted = [...indices]
      .filter(i => (i.store_size_bytes || 0) > 0)
      .sort((a, b) => (b.store_size_bytes || 0) - (a.store_size_bytes || 0))
      .slice(0, 8)
    const max = sorted[0]?.store_size_bytes || 1
    return sorted.map(i => ({
      name: i.index,
      bytes: i.store_size_bytes || 0,
      pct: ((i.store_size_bytes || 0) / max) * 100,
      label: i.store_size || prettyBytes(i.store_size_bytes || 0),
    }))
  }, [indices])

  const indexRows = useMemo(
    () =>
      indices.map(i => ({
        index: i.index,
        health: i.health,
        status: i.status,
        docs_count: i.docs_count,
        store_size: i.store_size,
        store_size_bytes: i.store_size_bytes,
        shards: `${i.pri ?? 0}p / ${i.rep ?? 0}r`,
        aliases: (i.aliases || []).join(', '),
      })),
    [indices],
  )

  const leadingColumns = useMemo<ColDef[]>(() => {
    if (!conn) return []
    const actions = [
      {
        label: 'Docs',
        className: 'btn sm',
        onClick: (row: Record<string, unknown>) => {
          openIndexTab(conn, String(row.index), 'docs')
          navigate('/workspace')
        },
      },
      {
        label: 'Query',
        className: 'btn sm ghost',
        onClick: (row: Record<string, unknown>) => {
          openIndexTab(conn, String(row.index), 'query')
          navigate('/workspace')
        },
      },
      {
        label: 'Schema',
        className: 'btn sm ghost',
        onClick: (row: Record<string, unknown>) => setSchemaIndex(String(row.index)),
      },
      ...(canDeleteIndex
        ? [
            {
              label: 'Delete',
              className: 'btn sm danger',
              onClick: (row: Record<string, unknown>) => {
                setDeleteIndex(String(row.index))
                setConfirmName('')
              },
            },
          ]
        : []),
    ]
    return [
      {
        headerName: 'Actions',
        colId: '__actions',
        pinned: 'left',
        width: canDeleteIndex ? 420 : 340,
        minWidth: canDeleteIndex ? 400 : 320,
        filter: false,
        floatingFilter: false,
        sortable: false,
        cellRenderer: ActionsCell,
        cellRendererParams: { actions },
      },
    ]
  }, [canDeleteIndex, conn, navigate, openIndexTab])

  const doDelete = async () => {
    if (!conn || !deleteIndex || confirmName !== deleteIndex) return
    setDeleting(true)
    setError(null)
    try {
      await api.deleteIndex(conn.id, deleteIndex)
      setDeleteIndex(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDeleting(false)
    }
  }

  if (!conn) {
    return (
      <div className="page">
        <p className="muted">Select or open a connection to view cluster details.</p>
      </div>
    )
  }

  const st = statusClass(cluster?.status)

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>{conn.name}</h1>
          <p className="muted">{conn.host_url}</p>
        </div>
        <div className="row gap">
          {cluster && (
            <span className={`pill ${st}`}>
              <span className={`status-dot ${st}`} />
              {cluster.status || 'unknown'}
            </span>
          )}
          <button type="button" className="btn" onClick={load} disabled={loading}>
            {loading ? <span className="spinner" /> : 'Refresh'}
          </button>
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}

      {cluster && (
        <section className="metrics">
          <div className={`metric status-${cluster.status}`}>
            <span className="label">Cluster</span>
            <strong>
              <span className={`status-dot ${st}`} />
              {cluster.status}
            </strong>
            <span className="muted sm">
              {cluster.cluster_name} · v{cluster.version || '?'}
            </span>
          </div>
          <div className="metric">
            <span className="label">Nodes</span>
            <strong>{cluster.number_of_nodes}</strong>
            <span className="muted sm">{cluster.number_of_data_nodes} data</span>
          </div>
          <div className="metric">
            <span className="label">Indices</span>
            <strong>{cluster.indices_count}</strong>
          </div>
          <div className="metric">
            <span className="label">Shards</span>
            <strong>{cluster.active_shards}</strong>
            <span className="muted sm">
              pri {cluster.active_primary_shards} · rep{' '}
              {Math.max(0, cluster.active_shards - cluster.active_primary_shards)} · unassigned{' '}
              {cluster.unassigned_shards}
            </span>
          </div>
          <div className="metric">
            <span className="label">Docs</span>
            <strong>{cluster.docs_count.toLocaleString()}</strong>
            <span className="muted sm">{prettyBytes(cluster.store_size_bytes)}</span>
          </div>
        </section>
      )}

      <section className="card">
        <div className="toolbar">
          <h2 style={{ margin: 0 }}>Nodes</h2>
          <span className="muted sm">{nodes.length} nodes</span>
        </div>
        <div className="nodes-grid">
          {nodes.map(n => (
            <article key={n.id} className="node-card">
              <h3>
                {n.master && <span title="master">★</span>}
                {n.name}
              </h3>
              <div className="node-meta">
                <div>IP {n.ip || '—'}</div>
                <div>
                  Shards {n.shard_count ?? '—'} · Mappings {n.mapping_count ?? '—'}
                </div>
                <div>{n.roles.join(', ') || '—'}</div>
              </div>
              <div className="gauges">
                <Gauge label="HEAP" value={n.heap_percent} />
                <Gauge label="RAM" value={n.ram_percent} />
                <Gauge label="DISK" value={n.disk_percent} />
              </div>
            </article>
          ))}
        </div>
      </section>

      {topStore.length > 0 && (
        <section className="card">
          <h2>Largest indices by store size</h2>
          <div className="shard-bars">
            {topStore.map(row => (
              <div key={row.name} className="shard-bar-row">
                <span className="muted" title={row.name}>
                  {row.name.length > 18 ? `${row.name.slice(0, 16)}…` : row.name}
                </span>
                <div className="shard-bar-track">
                  <div className="shard-bar-fill" style={{ width: `${row.pct}%` }} />
                </div>
                <span className="sm">{row.label}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <div className="toolbar">
          <h2 style={{ margin: 0 }}>Indices ({indices.length})</h2>
          {!canDeleteIndex && (
            <span className="muted sm">Delete hidden — OpenSearch index_delete not granted</span>
          )}
        </div>
        <StudioGrid
          rows={indexRows}
          columns={[
            'index',
            'health',
            'status',
            'docs_count',
            'store_size',
            'shards',
            'aliases',
          ]}
          leadingColumns={leadingColumns}
          height="420px"
        />
      </section>

      {schemaIndex && (
        <div className="modal-backdrop" onClick={() => setSchemaIndex(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <SchemaViewer connectionId={conn.id} indexName={schemaIndex} />
            <button type="button" className="btn mt" onClick={() => setSchemaIndex(null)}>
              Close
            </button>
          </div>
        </div>
      )}

      {deleteIndex && (
        <div className="modal-backdrop" onClick={() => setDeleteIndex(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Delete index permanently?</h2>
            <p className="muted">
              This cannot be undone. Type <strong>{deleteIndex}</strong> to confirm.
            </p>
            <input
              className="input"
              value={confirmName}
              onChange={e => setConfirmName(e.target.value)}
              placeholder={deleteIndex}
            />
            <div className="row gap mt">
              <button
                type="button"
                className="btn danger"
                disabled={confirmName !== deleteIndex || deleting}
                onClick={doDelete}
              >
                {deleting ? 'Deleting…' : 'Delete forever'}
              </button>
              <button type="button" className="btn ghost" onClick={() => setDeleteIndex(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
