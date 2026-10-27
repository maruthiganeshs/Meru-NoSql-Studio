import { useMemo, useState } from 'react'

export type ColumnFilter = {
  mode: 'contains' | 'equals' | 'empty' | 'not_empty' | 'gte' | 'lte'
  value: string
}

type Props = {
  columns: string[]
  rows: Array<Record<string, unknown>>
  onView?: (row: Record<string, unknown>) => void
  idKey?: string
}

const applyFilter = (cell: unknown, filter: ColumnFilter): boolean => {
  const text = cell == null ? '' : typeof cell === 'object' ? JSON.stringify(cell) : String(cell)
  switch (filter.mode) {
    case 'empty':
      return cell == null || text === ''
    case 'not_empty':
      return !(cell == null || text === '')
    case 'equals':
      return text === filter.value
    case 'gte': {
      const n = Number(cell)
      const t = Number(filter.value)
      return !Number.isNaN(n) && !Number.isNaN(t) && n >= t
    }
    case 'lte': {
      const n = Number(cell)
      const t = Number(filter.value)
      return !Number.isNaN(n) && !Number.isNaN(t) && n <= t
    }
    case 'contains':
    default:
      return text.toLowerCase().includes(filter.value.toLowerCase())
  }
}

export const DataTable = ({ columns, rows, onView, idKey = '_id' }: Props) => {
  const [global, setGlobal] = useState('')
  const [filters, setFilters] = useState<Record<string, ColumnFilter>>({})

  const filtered = useMemo(() => {
    return rows.filter(row => {
      if (global) {
        const blob = JSON.stringify(row).toLowerCase()
        if (!blob.includes(global.toLowerCase())) return false
      }
      return Object.entries(filters).every(([col, filter]) => {
        if (!filter.value && filter.mode !== 'empty' && filter.mode !== 'not_empty') return true
        return applyFilter(row[col], filter)
      })
    })
  }, [rows, filters, global])

  const activeChips = Object.entries(filters).filter(
    ([, f]) => f.mode === 'empty' || f.mode === 'not_empty' || f.value,
  )

  const clearAll = () => {
    setFilters({})
    setGlobal('')
  }

  const setColFilter = (col: string, patch: Partial<ColumnFilter>) => {
    setFilters(prev => ({
      ...prev,
      [col]: {
        mode: prev[col]?.mode || 'contains',
        value: prev[col]?.value || '',
        ...patch,
      },
    }))
  }

  return (
    <div className="data-table">
      <div className="toolbar">
        <input
          className="input"
          placeholder="Global search…"
          value={global}
          onChange={e => setGlobal(e.target.value)}
        />
        <button type="button" className="btn ghost" onClick={clearAll} disabled={!activeChips.length && !global}>
          Clear filters
        </button>
        <span className="muted">
          {filtered.length} / {rows.length} rows
        </span>
      </div>
      {activeChips.length > 0 && (
        <div className="chips">
          {activeChips.map(([col, f]) => (
            <button
              key={col}
              type="button"
              className="chip"
              onClick={() =>
                setFilters(prev => {
                  const next = { ...prev }
                  delete next[col]
                  return next
                })
              }
            >
              {col}: {f.mode}
              {f.value ? ` “${f.value}”` : ''} ×
            </button>
          ))}
        </div>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {onView && <th />}
              {columns.map(col => (
                <th key={col}>
                  <div className="th-stack">
                    <span>{col}</span>
                    <select
                      value={filters[col]?.mode || 'contains'}
                      onChange={e =>
                        setColFilter(col, { mode: e.target.value as ColumnFilter['mode'] })
                      }
                    >
                      <option value="contains">contains</option>
                      <option value="equals">equals</option>
                      <option value="empty">empty</option>
                      <option value="not_empty">not empty</option>
                      <option value="gte">≥</option>
                      <option value="lte">≤</option>
                    </select>
                    {filters[col]?.mode !== 'empty' && filters[col]?.mode !== 'not_empty' && (
                      <input
                        className="input sm"
                        placeholder="filter"
                        value={filters[col]?.value || ''}
                        onChange={e => setColFilter(col, { value: e.target.value })}
                      />
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, idx) => (
              <tr key={String(row[idKey] ?? idx)}>
                {onView && (
                  <td>
                    <button type="button" className="btn ghost sm" onClick={() => onView(row)}>
                      View
                    </button>
                  </td>
                )}
                {columns.map(col => (
                  <td key={col}>
                    {row[col] == null
                      ? ''
                      : typeof row[col] === 'object'
                        ? JSON.stringify(row[col])
                        : String(row[col])}
                  </td>
                ))}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={columns.length + (onView ? 1 : 0)} className="muted">
                  No rows match filters
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
