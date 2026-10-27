import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import type { CustomHeaderProps } from 'ag-grid-react'
import { api } from '../api/client'

type FacetValue = { value: string | number | boolean; count: number }

export type FacetContext = {
  connectionId: number
  indexName: string
  onServerFilterChange?: (field: string, values: Array<string | number | boolean>) => void
  selectedByField?: Record<string, Array<string | number | boolean>>
}

type FacetPanelProps = {
  connectionId: number
  indexName: string
  field: string
  selected: Array<string | number | boolean>
  onChange: (values: Array<string | number | boolean>) => void
}

export const FacetPanel = ({
  connectionId,
  indexName,
  field,
  selected,
  onChange,
}: FacetPanelProps) => {
  const [search, setSearch] = useState('')
  const [options, setOptions] = useState<FacetValue[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const handle = window.setTimeout(() => {
      api
        .fieldValues(connectionId, indexName, field, {
          size: 10,
          search: search || undefined,
        })
        .then(res => {
          if (!cancelled) setOptions(res.values)
        })
        .catch(err => {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : String(err))
            setOptions([])
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, search ? 250 : 0)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [connectionId, indexName, field, search])

  const selectedSet = useMemo(() => new Set(selected.map(String)), [selected])

  const toggle = (value: string | number | boolean) => {
    const exists = selected.some(v => String(v) === String(value))
    const next = exists ? selected.filter(v => String(v) !== String(value)) : [...selected, value]
    onChange(next)
  }

  return (
    <div className="facet-filter">
      <div className="facet-filter-title">Top values — {field}</div>
      <input
        type="search"
        placeholder="Search values…"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      {loading && <div className="muted sm">Loading…</div>}
      {error && <div className="muted sm">{error}</div>}
      <div className="facet-options">
        {options.map(opt => (
          <label key={String(opt.value)} className="facet-option">
            <input
              type="checkbox"
              checked={selectedSet.has(String(opt.value))}
              onChange={() => toggle(opt.value)}
            />
            <span>{String(opt.value)}</span>
            <span className="count">{opt.count}</span>
          </label>
        ))}
        {!loading && !error && options.length === 0 && (
          <div className="muted sm">No values</div>
        )}
      </div>
      {selected.length > 0 && (
        <button type="button" className="btn sm ghost" onClick={() => onChange([])}>
          Clear ({selected.length})
        </button>
      )}
    </div>
  )
}

type FacetHeaderProps = CustomHeaderProps & {
  facet?: FacetContext
  field: string
  showFacet?: boolean
}

export const FacetHeader = (props: FacetHeaderProps) => {
  const [open, setOpen] = useState(false)
  const [sort, setSort] = useState<'asc' | 'desc' | null>(null)
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const selected = props.facet?.selectedByField?.[props.field] || []
  const showFacet = Boolean(props.showFacet && props.facet)

  useEffect(() => {
    const sync = () => {
      const dir = props.column.getSort()
      setSort(dir === 'asc' || dir === 'desc' ? dir : null)
    }
    sync()
    props.column.addEventListener('sortChanged', sync)
    return () => props.column.removeEventListener('sortChanged', sync)
  }, [props.column])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || popoverRef.current?.contains(t)) return
      setOpen(false)
    }
    // Only close on scroll outside the popover — scrolling facet values must not dismiss it
    const onScroll = (e: Event) => {
      const t = e.target
      if (t instanceof Node && popoverRef.current?.contains(t)) return
      if (t === popoverRef.current) return
      setOpen(false)
    }
    const onResize = () => setOpen(false)
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  const openPopover = (e: ReactMouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const rect = btnRef.current?.getBoundingClientRect()
    if (rect) {
      const left = Math.min(rect.left, window.innerWidth - 300)
      const top = Math.min(rect.bottom + 4, window.innerHeight - 280)
      setPopoverPos({ top, left: Math.max(8, left) })
    }
    setOpen(v => !v)
  }

  const onSortClick = (e: ReactMouseEvent) => {
    if (!props.enableSorting) return
    e.stopPropagation()
    props.progressSort(e.shiftKey)
  }

  return (
    <div className="facet-header">
      <button
        type="button"
        className="facet-header-label sort-label"
        title={props.displayName}
        onClick={onSortClick}
      >
        <span>{props.displayName}</span>
        {sort === 'asc' && <span className="sort-ind" aria-hidden>↑</span>}
        {sort === 'desc' && <span className="sort-ind" aria-hidden>↓</span>}
      </button>
      {showFacet && props.facet && (
        <>
          <button
            ref={btnRef}
            type="button"
            className={`facet-header-btn ${selected.length ? 'active' : ''}`}
            title="Filter by values"
            onClick={openPopover}
          >
            ☰
          </button>
          {open &&
            popoverPos &&
            createPortal(
              <div
                ref={popoverRef}
                className="facet-popover portal"
                style={{ top: popoverPos.top, left: popoverPos.left }}
                onMouseDown={e => e.stopPropagation()}
                onClick={e => e.stopPropagation()}
                onWheel={e => e.stopPropagation()}
                onScroll={e => e.stopPropagation()}
              >
                <FacetPanel
                  connectionId={props.facet.connectionId}
                  indexName={props.facet.indexName}
                  field={props.field}
                  selected={selected}
                  onChange={values => props.facet?.onServerFilterChange?.(props.field, values)}
                />
              </div>,
              document.body,
            )}
        </>
      )}
    </div>
  )
}

export const OBJECT_MAPPING_TYPES = new Set(['object', 'nested'])

export const isFacetableMappingType = (type: string | undefined | null) => {
  if (!type) return true
  return !OBJECT_MAPPING_TYPES.has(type)
}

export const flattenMappingTypes = (
  mappings: Record<string, unknown>,
  prefix = '',
): Record<string, string> => {
  const out: Record<string, string> = {}
  const props = (mappings.properties || mappings) as Record<string, unknown> | undefined
  if (!props || typeof props !== 'object') return out
  Object.entries(props).forEach(([key, raw]) => {
    if (!raw || typeof raw !== 'object') return
    const node = raw as Record<string, unknown>
    const path = prefix ? `${prefix}.${key}` : key
    const type = typeof node.type === 'string' ? node.type : undefined
    if (type) out[path] = type
    if (node.properties && typeof node.properties === 'object') {
      if (!type || type === 'object' || type === 'nested') {
        Object.assign(out, flattenMappingTypes({ properties: node.properties }, path))
      }
    }
  })
  return out
}
