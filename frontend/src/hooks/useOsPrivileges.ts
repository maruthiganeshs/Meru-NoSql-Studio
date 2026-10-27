import { useCallback, useEffect, useState } from 'react'
import { api, type OsPrivileges } from '../api/client'

const DEFAULT: OsPrivileges = {
  cluster_monitor: true,
  index_read: true,
  index_create: true,
  index_delete: false,
  document_read: true,
  document_write: true,
  bulk_write: true,
}

export const useOsPrivileges = (connectionId: number | null) => {
  const [privileges, setPrivileges] = useState<OsPrivileges>(DEFAULT)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (connectionId == null) {
      setPrivileges(DEFAULT)
      return
    }
    setLoading(true)
    try {
      const privs = await api.privileges(connectionId)
      setPrivileges(privs)
    } catch {
      setPrivileges(DEFAULT)
    } finally {
      setLoading(false)
    }
  }, [connectionId])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { privileges, loading, refresh, canDeleteIndex: privileges.index_delete, canWriteDocs: privileges.document_write }
}
