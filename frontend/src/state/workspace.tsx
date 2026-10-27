import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Connection } from '../api/client'

export type TabMode = 'docs' | 'query' | 'schema' | 'import-export'

export type WorkspaceTab = {
  id: string
  connectionId: number
  connectionName: string
  indexName: string
  mode: TabMode
}

type WorkspaceState = {
  connections: Connection[]
  setConnections: (c: Connection[]) => void
  activeConnectionId: number | null
  setActiveConnectionId: (id: number | null) => void
  tabs: WorkspaceTab[]
  activeTabId: string | null
  openIndexTab: (conn: Connection, indexName: string, mode?: TabMode) => void
  closeTab: (tabId: string) => void
  setActiveTabId: (id: string | null) => void
  setTabMode: (tabId: string, mode: TabMode) => void
}

const WorkspaceContext = createContext<WorkspaceState | null>(null)

export const WorkspaceProvider = ({ children }: { children: ReactNode }) => {
  const [connections, setConnections] = useState<Connection[]>([])
  const [activeConnectionId, setActiveConnectionId] = useState<number | null>(null)
  const [tabs, setTabs] = useState<WorkspaceTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)

  const openIndexTab = useCallback(
    (conn: Connection, indexName: string, mode: TabMode = 'docs') => {
      const id = `${conn.id}::${indexName}`
      setTabs(prev => {
        const existing = prev.find(t => t.id === id)
        if (existing) {
          return prev.map(t => (t.id === id ? { ...t, mode } : t))
        }
        return [
          ...prev,
          {
            id,
            connectionId: conn.id,
            connectionName: conn.name,
            indexName,
            mode,
          },
        ]
      })
      setActiveTabId(id)
      setActiveConnectionId(conn.id)
    },
    [],
  )

  const closeTab = useCallback((tabId: string) => {
    setTabs(prev => {
      const next = prev.filter(t => t.id !== tabId)
      setActiveTabId(current => {
        if (current !== tabId) return current
        return next.length ? next[next.length - 1].id : null
      })
      return next
    })
  }, [])

  const setTabMode = useCallback((tabId: string, mode: TabMode) => {
    setTabs(prev => prev.map(t => (t.id === tabId ? { ...t, mode } : t)))
  }, [])

  const value = useMemo(
    () => ({
      connections,
      setConnections,
      activeConnectionId,
      setActiveConnectionId,
      tabs,
      activeTabId,
      openIndexTab,
      closeTab,
      setActiveTabId,
      setTabMode,
    }),
    [
      connections,
      activeConnectionId,
      tabs,
      activeTabId,
      openIndexTab,
      closeTab,
      setTabMode,
    ],
  )

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export const useWorkspace = () => {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider')
  return ctx
}
