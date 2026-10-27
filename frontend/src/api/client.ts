const API_BASE = '/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  })
  if (!response.ok) {
    let detail = response.statusText
    try {
      const body = await response.json()
      detail = body.detail
        ? typeof body.detail === 'string'
          ? body.detail
          : JSON.stringify(body.detail)
        : detail
    } catch {
      /* ignore */
    }
    throw new Error(detail)
  }
  if (response.status === 204) {
    return undefined as T
  }
  return response.json() as Promise<T>
}

export type OsPrivileges = {
  cluster_monitor: boolean
  index_read: boolean
  index_create: boolean
  index_delete: boolean
  document_read: boolean
  document_write: boolean
  bulk_write: boolean
  source?: string
  probe_available?: boolean
  probe_error?: string | null
}

export type Connection = {
  id: number
  name: string
  engine_type: string
  host_url: string
  auth_mode: string
  ssl_verify: boolean
  has_secrets: boolean
  os_privileges?: OsPrivileges | null
  last_tested_at: string | null
  last_test_ok: boolean | null
  created_at: string
  updated_at: string
}

export type ConnectionInput = {
  name: string
  engine_type: 'opensearch' | 'elasticsearch'
  host_url: string
  auth_mode: 'none' | 'basic' | 'apiKey'
  ssl_verify: boolean
  username?: string
  password?: string
  api_key?: string
  os_privileges?: Partial<OsPrivileges>
}

export type ClusterOverview = {
  cluster_name: string
  status: string
  version: string | null
  number_of_nodes: number
  number_of_data_nodes: number
  active_primary_shards: number
  active_shards: number
  relocating_shards: number
  initializing_shards: number
  unassigned_shards: number
  docs_count: number
  store_size_bytes: number
  indices_count: number
}

export type NodeSummary = {
  id: string
  name: string
  ip: string | null
  version: string | null
  roles: string[]
  master: boolean
  heap_percent: number | null
  ram_percent: number | null
  disk_percent: number | null
  cpu_percent: number | null
  shard_count?: number | null
  mapping_count?: number | null
}

export type IndexSummary = {
  index: string
  uuid: string | null
  health: string | null
  status: string | null
  docs_count: number | null
  store_size: string | null
  store_size_bytes: number | null
  pri: number | null
  rep: number | null
  aliases: string[]
}

export type SearchResult = {
  took: number | null
  timed_out: boolean | null
  hits_total: number | null
  hits: Array<{ _id: string; _source?: Record<string, unknown>; [key: string]: unknown }>
  aggregations?: Record<string, unknown> | null
  raw: Record<string, unknown>
}

export type SampleQuery = {
  id: number
  name: string
  body: string
  description: string | null
  connection_id: number | null
  engine_type: string
  created_at: string
}

export const api = {
  health: () => request<{ status: string }>('/health'),
  listConnections: () => request<Connection[]>('/connections'),
  createConnection: (body: ConnectionInput) =>
    request<Connection>('/connections', { method: 'POST', body: JSON.stringify(body) }),
  updateConnection: (id: number, body: Partial<ConnectionInput> & { clear_secrets?: boolean }) =>
    request<Connection>(`/connections/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteConnection: (id: number) => request<void>(`/connections/${id}`, { method: 'DELETE' }),
  testConnection: (id: number) =>
    request<{
      ok: boolean
      message: string
      cluster_name?: string
      version?: string
      privileges?: OsPrivileges
    }>(`/connections/${id}/test`, { method: 'POST' }),
  testDraft: (body: ConnectionInput) =>
    request<{
      ok: boolean
      message: string
      cluster_name?: string
      version?: string
      privileges?: OsPrivileges
    }>('/connections/test-draft', { method: 'POST', body: JSON.stringify(body) }),
  privileges: (id: number) => request<OsPrivileges>(`/os/${id}/privileges`),
  cluster: (id: number) => request<ClusterOverview>(`/os/${id}/cluster`),
  nodes: (id: number) => request<NodeSummary[]>(`/os/${id}/nodes`),
  indices: (id: number) => request<IndexSummary[]>(`/os/${id}/indices`),
  deleteIndex: (id: number, index: string) =>
    request<Record<string, unknown>>(`/os/${id}/indices/${encodeURIComponent(index)}`, {
      method: 'DELETE',
    }),
  mapping: (id: number, index: string) =>
    request<{ index: string; mappings: Record<string, unknown> }>(
      `/os/${id}/indices/${encodeURIComponent(index)}/mapping`,
    ),
  fieldValues: (
    id: number,
    index: string,
    field: string,
    opts?: { size?: number; search?: string },
  ) =>
    request<{ field: string; values: Array<{ value: string | number | boolean; count: number }> }>(
      `/os/${id}/indices/${encodeURIComponent(index)}/field-values`,
      {
        method: 'POST',
        body: JSON.stringify({
          field,
          size: opts?.size ?? 10,
          search: opts?.search || null,
        }),
      },
    ),
  search: (id: number, index: string, body: object, from = 0, size = 50) =>
    request<SearchResult>(`/os/${id}/indices/${encodeURIComponent(index)}/search`, {
      method: 'POST',
      body: JSON.stringify({ body, from, size }),
    }),
  query: (id: number, index: string, body: object, from = 0, size = 50) =>
    request<SearchResult>(`/os/${id}/indices/${encodeURIComponent(index)}/query`, {
      method: 'POST',
      body: JSON.stringify({ body, from, size }),
    }),
  getDocument: (id: number, index: string, docId: string) =>
    request<{ index: string; id: string; source: Record<string, unknown>; found: boolean }>(
      `/os/${id}/indices/${encodeURIComponent(index)}/docs/${encodeURIComponent(docId)}`,
    ),
  updateDocument: (id: number, index: string, docId: string, source: Record<string, unknown>) =>
    request<{ index: string; id: string; source: Record<string, unknown>; found: boolean }>(
      `/os/${id}/indices/${encodeURIComponent(index)}/docs/${encodeURIComponent(docId)}`,
      { method: 'PUT', body: JSON.stringify({ source }) },
    ),
  sampleQueries: (connectionId?: number) =>
    request<SampleQuery[]>(
      `/sample-queries${connectionId != null ? `?connection_id=${connectionId}` : ''}`,
    ),
  createSampleQuery: (body: {
    name: string
    body: string
    description?: string
    connection_id?: number
  }) => request<SampleQuery>('/sample-queries', { method: 'POST', body: JSON.stringify(body) }),
  inferTypesFor: (connectionId: number, documents: Record<string, unknown>[]) =>
    request<{ suggestions: Array<{ field: string; suggested_type: string }>; note: string }>(
      `/os/${connectionId}/infer-types`,
      { method: 'POST', body: JSON.stringify({ documents }) },
    ),
  importDocs: (
    connectionId: number,
    body: {
      index: string
      documents: Record<string, unknown>[]
      field_mappings: Array<{ field: string; type: string }>
      create_index?: boolean
    },
  ) =>
    request<{ indexed: number; errors: string[] }>(`/os/${connectionId}/import`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  exportDocs: async (
    connectionId: number,
    body: {
      index: string
      query?: object | null
      format: 'json' | 'jsonl' | 'csv'
      include_schema?: boolean
    },
  ) => {
    const response = await fetch(`/api/os/${connectionId}/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      throw new Error(await response.text())
    }
    return response.blob()
  },
}
