import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useCopied } from '../hooks/useCopied'

type Props = {
  connectionId: number
  indexName: string
}

export const SchemaViewer = ({ connectionId, indexName }: Props) => {
  const [mapping, setMapping] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const { copied, markCopied } = useCopied()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .mapping(connectionId, indexName)
      .then(res => {
        if (!cancelled) setMapping(res.mappings)
      })
      .catch(err => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [connectionId, indexName])

  if (loading) return <p className="muted">Loading schema…</p>
  if (error) return <p className="banner error">{error}</p>
  return (
    <div className="schema-viewer">
      <div className="toolbar">
        <h3 style={{ margin: 0 }}>Schema — {indexName}</h3>
        <button
          type="button"
          className={`btn ${copied ? 'btn-copied' : ''}`}
          onClick={() => mapping && markCopied(JSON.stringify(mapping, null, 2))}
        >
          {copied ? 'Copied!' : 'Copy schema'}
        </button>
      </div>
      <pre className="json-block">{JSON.stringify(mapping, null, 2)}</pre>
    </div>
  )
}
