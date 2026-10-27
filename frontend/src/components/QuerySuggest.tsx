import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { getCompletionCatalog } from '../monaco/opensearchCompletions'

type SuggestItem = {
  label: string
  detail: string
  insertText: string
}

type Props = {
  editor: MonacoEditor.IStandaloneCodeEditor | null
  open: boolean
  items: SuggestItem[]
  activeIndex: number
  position: { top: number; left: number } | null
  onHover: (index: number) => void
  onPick: (item: SuggestItem) => void
  onClose: () => void
}

export const QuerySuggest = ({
  editor: _editor,
  open,
  items,
  activeIndex,
  position,
  onHover,
  onPick,
  onClose,
}: Props) => {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (listRef.current?.contains(e.target as Node)) return
      onClose()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open, onClose])

  if (!open || !position || items.length === 0) return null

  return (
    <div
      ref={listRef}
      className="query-suggest"
      style={{ top: position.top, left: position.left }}
      role="listbox"
      onMouseDown={e => e.preventDefault()}
    >
      {items.map((item, idx) => (
        <button
          key={`${item.label}-${idx}`}
          type="button"
          data-idx={idx}
          role="option"
          aria-selected={idx === activeIndex}
          className={`query-suggest-item ${idx === activeIndex ? 'active' : ''}`}
          onMouseEnter={() => onHover(idx)}
          onClick={() => onPick(item)}
        >
          <span className="query-suggest-label">{item.label}</span>
          <span className="query-suggest-detail">{item.detail}</span>
        </button>
      ))}
    </div>
  )
}

const readPrefix = (model: MonacoEditor.ITextModel, position: MonacoEditor.IPosition) => {
  const line = model.getLineContent(position.lineNumber)
  const before = line.slice(0, position.column - 1)
  const match = before.match(/([A-Za-z0-9_.]*)$/)
  return {
    prefix: match?.[1] || '',
    startColumn: (match?.index ?? before.length) + 1,
  }
}

const snippetToPlain = (insertText: string) =>
  insertText
    .replace(/\$\{\d+:([^}]*)\}/g, '$1')
    .replace(/\$\d+/g, '')
    .replace(/\$0/g, '')

export const useQuerySuggest = (editor: MonacoEditor.IStandaloneCodeEditor | null) => {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<SuggestItem[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const rangeRef = useRef<{ startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } | null>(null)

  const refresh = useCallback(() => {
    if (!editor) return
    const model = editor.getModel()
    const pos = editor.getPosition()
    if (!model || !pos) {
      setOpen(false)
      return
    }

    const { prefix, startColumn } = readPrefix(model, pos)
    const catalog = getCompletionCatalog()
    const filtered = catalog.filter(item =>
      !prefix || item.label.toLowerCase().startsWith(prefix.toLowerCase()),
    )

    if (!prefix || filtered.length === 0) {
      setOpen(false)
      setItems([])
      return
    }

    rangeRef.current = {
      startLineNumber: pos.lineNumber,
      startColumn,
      endLineNumber: pos.lineNumber,
      endColumn: pos.column,
    }

    const coords = editor.getScrolledVisiblePosition(pos)
    const dom = editor.getDomNode()
    if (!coords || !dom) {
      setOpen(false)
      return
    }
    const rect = dom.getBoundingClientRect()
    setItems(filtered.slice(0, 12))
    setActiveIndex(0)
    setPosition({
      top: rect.top + coords.top + coords.height + 4,
      left: Math.min(rect.left + coords.left, window.innerWidth - 320),
    })
    setOpen(true)
  }, [editor])

  const applyItem = useCallback(
    (item: SuggestItem) => {
      if (!editor || !rangeRef.current) return
      const text = snippetToPlain(item.insertText)
      editor.executeEdits('meru-suggest', [
        {
          range: rangeRef.current,
          text,
          forceMoveMarkers: true,
        },
      ])
      editor.focus()
      setOpen(false)
    },
    [editor],
  )

  const onClose = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!editor) return

    const subs = [
      editor.onDidChangeCursorPosition(() => {
        // keep open only while typing a word prefix
        window.setTimeout(refresh, 0)
      }),
      editor.onDidChangeModelContent(() => {
        window.setTimeout(refresh, 0)
      }),
      editor.onDidBlurEditorWidget(() => {
        window.setTimeout(() => setOpen(false), 150)
      }),
      editor.onDidScrollChange(() => setOpen(false)),
      editor.onKeyDown(e => {
        if (!open || items.length === 0) return
        // Monaco KeyCode: DownArrow=18, UpArrow=16, Enter=3, Escape=9, Tab=2
        if (e.keyCode === 18) {
          e.preventDefault()
          e.stopPropagation()
          setActiveIndex(i => (i + 1) % items.length)
        } else if (e.keyCode === 16) {
          e.preventDefault()
          e.stopPropagation()
          setActiveIndex(i => (i - 1 + items.length) % items.length)
        } else if (e.keyCode === 3 || e.keyCode === 2) {
          e.preventDefault()
          e.stopPropagation()
          applyItem(items[activeIndex])
        } else if (e.keyCode === 9) {
          e.preventDefault()
          e.stopPropagation()
          setOpen(false)
        }
      }),
    ]

    return () => subs.forEach(s => s.dispose())
  }, [editor, open, items, activeIndex, refresh, applyItem])

  const widget = useMemo(
    () => (
      <QuerySuggest
        editor={editor}
        open={open}
        items={items}
        activeIndex={activeIndex}
        position={position}
        onHover={setActiveIndex}
        onPick={applyItem}
        onClose={onClose}
      />
    ),
    [editor, open, items, activeIndex, position, applyItem, onClose],
  )

  return { suggestUi: widget, closeSuggest: onClose }
}
