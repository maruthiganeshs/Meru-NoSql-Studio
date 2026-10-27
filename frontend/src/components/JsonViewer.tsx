type Props = {
  value: unknown
  title?: string
  onClose?: () => void
}

export const JsonViewer = ({ value, title = 'Document', onClose }: Props) => {
  const text = JSON.stringify(value, null, 2)

  const copy = async () => {
    await navigator.clipboard.writeText(text)
  }

  return (
    <aside className="drawer">
      <div className="drawer-header">
        <strong>{title}</strong>
        <div className="row gap">
          <button type="button" className="btn ghost" onClick={copy}>
            Copy
          </button>
          {onClose && (
            <button type="button" className="btn ghost" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>
      <pre className="json-block">{text}</pre>
    </aside>
  )
}
