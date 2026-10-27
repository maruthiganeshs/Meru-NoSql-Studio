import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../api/client'
import { DocumentModal } from '../../components/DocumentModal'
import { flattenMappingTypes } from '../../components/FacetFilter'
import { SchemaViewer } from '../../components/SchemaViewer'
import { StudioGrid, type StudioGridHandle } from '../../components/StudioGrid'
import { useOsPrivileges } from '../../hooks/useOsPrivileges'
import type { WorkspaceTab } from '../../state/workspace'

type Props = { tab: WorkspaceTab }

const PAGE_SIZES = [25, 50, 100, 200] as const

const FILTER_OPS = [
  { value: 'contains', label: 'Contains' },
  { value: 'equals', label: 'Equals' },
  { value: 'startsWith', label: 'Starts with' },
  { value: 'endsWith', label: 'Ends with' },
  { value: 'notContains', label: 'Not contains' },
] as const

type FilterOp = (typeof FILTER_OPS)[number]['value']
type JoinOp = 'AND' | 'OR'

type AdvClause = {
  id: string
  field: string
  op: FilterOp
  value: string
  join: JoinOp
}

const newClause = (field = ''): AdvClause => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  field,
  op: 'contains',
  value: '',
  join: 'AND',
})

const resolveFilterField = (field: string, fieldTypes: Record<string, string>) =>
  fieldTypes[field] === 'text' ? `${field}.keyword` : field

const clauseToOsQuery = (
  clause: AdvClause,
  fieldTypes: Record<string, string>,
): Record<string, unknown> | null => {
  if (!clause.field || !clause.value.trim()) return null
  const field = resolveFilterField(clause.field, fieldTypes)
  const value = clause.value.trim()
  switch (clause.op) {
    case 'equals':
      return { term: { [field]: value } }
    case 'startsWith':
      return { prefix: { [field]: value } }
    case 'endsWith':
      return { wildcard: { [field]: `*${value}` } }
    case 'notContains':
      return { bool: { must_not: [{ wildcard: { [field]: `*${value}*` } }] } }
    case 'contains':
    default:
      return { wildcard: { [field]: `*${value}*` } }
  }
}

const buildSearchBody = (
  facetFilters: Record<string, Array<string | number | boolean>>,
  fieldTypes: Record<string, string>,
  advClauses: AdvClause[],
) => {
  const facetClauses = Object.entries(facetFilters)
    .filter(([, values]) => values.length > 0)
    .map(([field, values]) => ({
      terms: { [resolveFilterField(field, fieldTypes)]: values },
    }))

  const activeAdv = advClauses
    .map(c => ({ clause: c, query: clauseToOsQuery(c, fieldTypes) }))
    .filter((x): x is { clause: AdvClause; query: Record<string, unknown> } => x.query != null)

  if (!facetClauses.length && !activeAdv.length) {
    return { query: { match_all: {} } }
  }

  // Flatten same-level AND/OR: group consecutive OR runs under should, AND via filter.
  const pieces: Array<{ join: JoinOp; query: Record<string, unknown> }> = [
    ...facetClauses.map(q => ({ join: 'AND' as JoinOp, query: q })),
    ...activeAdv.map(({ clause, query }) => ({ join: clause.join, query })),
  ]

  // First piece has no join; subsequent use their join relative to prior result.
  let combined: Record<string, unknown> | null = null
  pieces.forEach((piece, idx) => {
    if (idx === 0 || combined == null) {
      combined = piece.query
      return
    }
    if (piece.join === 'OR') {
      combined = {
        bool: {
          should: [combined, piece.query],
          minimum_should_match: 1,
        },
      }
    } else {
      combined = {
        bool: {
          filter: [combined, piece.query],
        },
      }
    }
  })

  return { query: combined || { match_all: {} } }
}

export const DocsBrowser = ({ tab }: Props) => {
  const { canWriteDocs } = useOsPrivileges(tab.connectionId)
  const gridRef = useRef<StudioGridHandle>(null)
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([])
  const [total, setTotal] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [viewRow, setViewRow] = useState<Record<string, unknown> | null>(null)
  const [showSchema, setShowSchema] = useState(false)
  const [saving, setSaving] = useState(false)
  const [from, setFrom] = useState(0)
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(50)
  const [fieldTypes, setFieldTypes] = useState<Record<string, string>>({})
  const [facetFilters, setFacetFilters] = useState<
    Record<string, Array<string | number | boolean>>
  >({})
  const [showAdv, setShowAdv] = useState(false)
  const [advClauses, setAdvClauses] = useState<AdvClause[]>([newClause()])

  const page = Math.floor(from / pageSize) + 1
  const totalPages = total != null && total > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1

  const fieldOptions = useMemo(() => {
    const keys = Object.keys(fieldTypes).sort((a, b) => a.localeCompare(b))
    return ['_id', ...keys.filter(k => k !== '_id')]
  }, [fieldTypes])

  const columns = useMemo(() => {
    if (!Object.keys(fieldTypes).length) return undefined
    return fieldOptions
  }, [fieldTypes, fieldOptions])

  const load = useCallback(
    async (
      offset = 0,
      size = pageSize,
      filters = facetFilters,
      types = fieldTypes,
      adv = advClauses,
    ) => {
      setLoading(true)
      setError(null)
      try {
        const result = await api.search(
          tab.connectionId,
          tab.indexName,
          buildSearchBody(filters, types, adv),
          offset,
          size,
        )
        const mapped = result.hits.map(h => ({
          _id: h._id,
          ...(h._source || {}),
        }))
        setRows(mapped)
        setTotal(result.hits_total)
        setFrom(offset)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    },
    [tab.connectionId, tab.indexName, pageSize, facetFilters, fieldTypes, advClauses],
  )

  useEffect(() => {
    setFacetFilters({})
    setAdvClauses([newClause()])
    setShowAdv(false)
    setFrom(0)
    setPageSize(50)
    let cancelled = false
    api
      .mapping(tab.connectionId, tab.indexName)
      .then(res => {
        if (!cancelled) setFieldTypes(flattenMappingTypes(res.mappings || {}))
      })
      .catch(() => {
        if (!cancelled) setFieldTypes({})
      })
    return () => {
      cancelled = true
    }
  }, [tab.connectionId, tab.indexName])

  useEffect(() => {
    void load(0, pageSize, facetFilters, fieldTypes, advClauses)
    // Adv clauses apply via Apply button — do not reload on every keystroke
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.connectionId, tab.indexName, pageSize, facetFilters])

  const onServerFilterChange = useCallback(
    (field: string, values: Array<string | number | boolean>) => {
      setFacetFilters(prev => {
        if (!values.length) {
          const { [field]: _removed, ...rest } = prev
          return rest
        }
        return { ...prev, [field]: values }
      })
    },
    [],
  )

  const facet = useMemo(
    () => ({
      connectionId: tab.connectionId,
      indexName: tab.indexName,
      onServerFilterChange,
      selectedByField: facetFilters,
    }),
    [tab.connectionId, tab.indexName, onServerFilterChange, facetFilters],
  )

  const clearAllFilters = () => {
    const emptyAdv = [newClause()]
    setFacetFilters({})
    setAdvClauses(emptyAdv)
    gridRef.current?.clearColumnFilters()
    void load(0, pageSize, {}, fieldTypes, emptyAdv)
  }

  const applyAdv = () => {
    setFrom(0)
    void load(0, pageSize, facetFilters, fieldTypes, advClauses)
  }

  const onSave = async (source: Record<string, unknown>) => {
    if (!viewRow?._id) return
    setSaving(true)
    try {
      await api.updateDocument(tab.connectionId, tab.indexName, String(viewRow._id), source)
      setViewRow({ _id: viewRow._id, ...source })
      await load(from, pageSize, facetFilters, fieldTypes, advClauses)
    } finally {
      setSaving(false)
    }
  }

  const updateClause = (id: string, patch: Partial<AdvClause>) => {
    setAdvClauses(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)))
  }

  return (
    <div className="panel">
      <div className="toolbar">
        <h2>
          Documents — {tab.indexName}
          {total != null && <span className="muted"> · {total.toLocaleString()} hits</span>}
        </h2>
        <div className="row gap page-controls">
          <button type="button" className="btn ghost" onClick={() => setShowSchema(s => !s)}>
            {showSchema ? 'Hide schema' : 'View schema'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => load(from, pageSize, facetFilters, fieldTypes, advClauses)}
            disabled={loading}
          >
            {loading ? <span className="spinner" /> : 'Refresh'}
          </button>
          <label className="row gap muted sm">
            Rows
            <select
              value={pageSize}
              onChange={e => {
                setPageSize(Number(e.target.value) as (typeof PAGE_SIZES)[number])
                setFrom(0)
              }}
              disabled={loading}
            >
              {PAGE_SIZES.map(n => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <span className="muted sm">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            className="btn ghost"
            disabled={from === 0 || loading}
            onClick={() => load(Math.max(0, from - pageSize), pageSize, facetFilters, fieldTypes, advClauses)}
          >
            Prev
          </button>
          <button
            type="button"
            className="btn ghost"
            disabled={loading || (total != null && from + pageSize >= total)}
            onClick={() => load(from + pageSize, pageSize, facetFilters, fieldTypes, advClauses)}
          >
            Next
          </button>
          <button
            type="button"
            className={`btn ${showAdv ? 'primary' : 'ghost'}`}
            onClick={() => setShowAdv(s => !s)}
          >
            Adv filter
          </button>
          <button type="button" className="btn ghost" onClick={clearAllFilters}>
            Clear filters
          </button>
        </div>
      </div>

      {showAdv && (
        <div className="adv-filter-bar">
          <div className="adv-filter-clauses">
            {advClauses.map((clause, idx) => (
              <div key={clause.id} className="adv-filter-clause">
                {idx > 0 && (
                  <select
                    className="join"
                    value={clause.join}
                    onChange={e => updateClause(clause.id, { join: e.target.value as JoinOp })}
                  >
                    <option value="AND">AND</option>
                    <option value="OR">OR</option>
                  </select>
                )}
                <label>
                  Field
                  <select
                    value={clause.field}
                    onChange={e => updateClause(clause.id, { field: e.target.value })}
                  >
                    <option value="">Select field…</option>
                    {fieldOptions.map(f => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Type
                  <select
                    value={clause.op}
                    onChange={e => updateClause(clause.id, { op: e.target.value as FilterOp })}
                  >
                    {FILTER_OPS.map(op => (
                      <option key={op.value} value={op.value}>
                        {op.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Value
                  <input
                    value={clause.value}
                    onChange={e => updateClause(clause.id, { value: e.target.value })}
                    placeholder="Filter value"
                  />
                </label>
                {advClauses.length > 1 && (
                  <button
                    type="button"
                    className="btn sm ghost"
                    onClick={() => setAdvClauses(prev => prev.filter(c => c.id !== clause.id))}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn sm ghost"
            onClick={() => setAdvClauses(prev => [...prev, newClause(fieldOptions[0] || '')])}
          >
            Add condition
          </button>
          <button type="button" className="btn sm primary" onClick={applyAdv} disabled={loading}>
            Apply
          </button>
        </div>
      )}

      {error && <div className="banner error">{error}</div>}
      {showSchema && (
        <div className="card">
          <SchemaViewer connectionId={tab.connectionId} indexName={tab.indexName} />
        </div>
      )}
      <StudioGrid
        ref={gridRef}
        rows={rows}
        columns={columns}
        fieldTypes={fieldTypes}
        facet={facet}
        onView={setViewRow}
      />

      {viewRow && (
        <DocumentModal
          title={`Document ${String(viewRow._id ?? '')}`}
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
