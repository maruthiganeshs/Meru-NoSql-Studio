import Editor from '@monaco-editor/react'
import { useEffect, useState } from 'react'
import { useCopied } from '../hooks/useCopied'
import { useTheme } from '../state/theme'

type Props = {
  title: string
  value: Record<string, unknown>
  canSave?: boolean
  saving?: boolean
  onClose: () => void
  onSave?: (source: Record<string, unknown>) => Promise<void> | void
}

export const DocumentModal = ({ title, value, canSave, saving, onClose, onSave }: Props) => {
  const { theme } = useTheme()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { copied, markCopied } = useCopied()

  useEffect(() => {
    const editable = Object.fromEntries(Object.entries(value).filter(([k]) => k !== '_id'))
    setText(JSON.stringify(editable, null, 2))
    setError(null)
  }, [value])

  const save = async () => {
    if (!onSave) return
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>
      setError(null)
      await onSave(parsed)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <strong>{title}</strong>
          <div className="row gap">
            <button
              type="button"
              className={`btn ghost ${copied ? 'btn-copied' : ''}`}
              onClick={() => markCopied(text)}
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
            {canSave && onSave && (
              <button type="button" className="btn primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            )}
            <button type="button" className="btn ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        {error && <div className="banner error">{error}</div>}
        <div className="editor-wrap">
          <Editor
            height="420px"
            defaultLanguage="json"
            theme={theme === 'dark' ? 'vs-dark' : 'light'}
            value={text}
            onChange={v => setText(v || '')}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              tabSize: 2,
              automaticLayout: true,
              formatOnPaste: true,
            }}
          />
        </div>
      </div>
    </div>
  )
}
