import { forwardRef, useImperativeHandle, useMemo, useRef, type ReactNode } from 'react'
import { AgGridReact } from 'ag-grid-react'
import {
  AllCommunityModule,
  ModuleRegistry,
  type ColDef,
  type GridApi,
  type ICellRendererParams,
  type RowClickedEvent,
} from 'ag-grid-community'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-quartz.css'
import { FacetHeader, isFacetableMappingType, type FacetContext } from './FacetFilter'

ModuleRegistry.registerModules([AllCommunityModule])

export type { FacetContext }

export type StudioGridHandle = {
  clearColumnFilters: () => void
  getApi: () => GridApi | null
}

type Props = {
  rows: Array<Record<string, unknown>>
  columns?: string[]
  fieldTypes?: Record<string, string>
  facet?: FacetContext
  onView?: (row: Record<string, unknown>) => void
  leadingColumns?: ColDef[]
  height?: string | number
}

const cellValue = (value: unknown) => {
  if (value == null) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

const defaultWidthForField = (field: string) => {
  if (field === '_id') return 220
  if (field === 'index') return 260
  if (field === 'aliases' || field === 'store_size') return 160
  if (field === 'health' || field === 'status' || field === 'shards') return 120
  if (field === 'docs_count') return 140
  return 200
}

const TEXT_FILTER_PARAMS = {
  maxNumConditions: 1,
  numAlwaysVisibleConditions: 1,
  filterOptions: ['contains', 'equals', 'startsWith', 'endsWith', 'notContains', 'notEqual', 'blank'],
  defaultOption: 'contains',
  buttons: ['apply', 'reset'],
  closeOnApply: true,
}

const ViewCell = (props: ICellRendererParams & { onView?: (row: Record<string, unknown>) => void }) => {
  if (!props.data || !props.onView) return null
  return (
    <button
      type="button"
      className="btn sm ghost"
      onClick={e => {
        e.stopPropagation()
        props.onView?.(props.data as Record<string, unknown>)
      }}
    >
      View
    </button>
  )
}

export const StudioGrid = forwardRef<StudioGridHandle, Props>(function StudioGrid(
  { rows, columns, fieldTypes, facet, onView, leadingColumns, height },
  ref,
) {
  const apiRef = useRef<GridApi | null>(null)

  useImperativeHandle(ref, () => ({
    clearColumnFilters: () => {
      apiRef.current?.setFilterModel(null)
    },
    getApi: () => apiRef.current,
  }))

  const inferredCols = useMemo(() => {
    if (columns?.length) return columns
    const keys = new Set<string>()
    rows.forEach(r => Object.keys(r).forEach(k => keys.add(k)))
    const ordered = Array.from(keys)
    ordered.sort((a, b) => {
      if (a === '_id') return -1
      if (b === '_id') return 1
      return a.localeCompare(b)
    })
    return ordered
  }, [rows, columns])

  const columnDefs = useMemo<ColDef[]>(() => {
    const defs: ColDef[] = [...(leadingColumns || [])]
    if (onView) {
      defs.push({
        headerName: '',
        colId: '__view',
        width: 120,
        minWidth: 110,
        pinned: 'left',
        filter: false,
        floatingFilter: false,
        sortable: false,
        cellRenderer: ViewCell,
        cellRendererParams: { onView },
      })
    }
    inferredCols.forEach(field => {
      const mappingType = fieldTypes?.[field]
      const showFacet =
        Boolean(facet) && field !== '_id' && isFacetableMappingType(mappingType)

      defs.push({
        field,
        filter: 'agTextColumnFilter',
        filterParams: TEXT_FILTER_PARAMS,
        floatingFilter: true,
        sortable: true,
        unSortIcon: true,
        resizable: true,
        minWidth: 180,
        width: defaultWidthForField(field),
        comparator: (a, b) => {
          const left = a == null ? '' : typeof a === 'object' ? JSON.stringify(a) : String(a)
          const right = b == null ? '' : typeof b === 'object' ? JSON.stringify(b) : String(b)
          return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
        },
        valueFormatter: p => cellValue(p.value),
        headerComponent: FacetHeader,
        headerComponentParams: {
          facet,
          field,
          showFacet,
        },
      })
    })
    return defs
  }, [inferredCols, onView, leadingColumns, fieldTypes, facet])

  return (
    <div className="studio-grid-wrap" style={height != null ? { height } : undefined}>
      <div className="ag-theme-quartz ag-theme-meru" style={{ height: '100%', width: '100%' }}>
        <AgGridReact
          theme="legacy"
          rowData={rows}
          columnDefs={columnDefs}
          rowHeight={56}
          headerHeight={48}
          floatingFiltersHeight={44}
          defaultColDef={{
            flex: 0,
            filter: true,
            floatingFilter: true,
            resizable: true,
            sortable: true,
            unSortIcon: true,
            minWidth: 180,
            filterParams: TEXT_FILTER_PARAMS,
          }}
          animateRows
          suppressCellFocus
          onGridReady={e => {
            apiRef.current = e.api
          }}
          onRowDoubleClicked={(e: RowClickedEvent) => {
            if (onView && e.data) onView(e.data as Record<string, unknown>)
          }}
        />
      </div>
    </div>
  )
})

export type ActionButton = {
  label: string
  className?: string
  onClick: (row: Record<string, unknown>) => void
}

export const ActionsCell = (
  props: ICellRendererParams & { actions?: ActionButton[] },
): ReactNode => {
  if (!props.data || !props.actions?.length) return null
  return (
    <div className="actions-cell">
      {props.actions.map(action => (
        <button
          key={action.label}
          type="button"
          className={action.className || 'btn sm ghost'}
          onClick={e => {
            e.stopPropagation()
            action.onClick(props.data as Record<string, unknown>)
          }}
        >
          {action.label}
        </button>
      ))}
    </div>
  )
}
