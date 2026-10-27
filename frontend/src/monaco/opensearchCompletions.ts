import type { Monaco } from '@monaco-editor/react'
import type * as MonacoNs from 'monaco-editor'

/** Dedicated language so built-in JSON completions (often blank rows) never compete. */
export const OS_JSON_LANG = 'opensearch-json'

const DSL_KEYWORDS: Array<{ label: string; insertText: string; detail: string }> = [
  { label: 'query', insertText: '"query": {\n\t$0\n}', detail: 'Top-level query clause' },
  { label: 'bool', insertText: '"bool": {\n\t$0\n}', detail: 'Boolean query' },
  { label: 'must', insertText: '"must": [\n\t$0\n]', detail: 'Bool must' },
  { label: 'should', insertText: '"should": [\n\t$0\n]', detail: 'Bool should' },
  { label: 'filter', insertText: '"filter": [\n\t$0\n]', detail: 'Bool filter' },
  { label: 'must_not', insertText: '"must_not": [\n\t$0\n]', detail: 'Bool must_not' },
  { label: 'match_all', insertText: '"match_all": {}', detail: 'Match all documents' },
  { label: 'match', insertText: '"match": {\n\t"${1:field}": "${2:value}"\n}', detail: 'Full-text match' },
  {
    label: 'multi_match',
    insertText: '"multi_match": {\n\t"query": "${1:text}",\n\t"fields": ["${2:field}"]\n}',
    detail: 'Multi-field match',
  },
  { label: 'term', insertText: '"term": {\n\t"${1:field}": "${2:value}"\n}', detail: 'Exact term' },
  {
    label: 'terms',
    insertText: '"terms": {\n\t"${1:field}": ["${2:value}"]\n}',
    detail: 'Exact terms set',
  },
  {
    label: 'range',
    insertText: '"range": {\n\t"${1:field}": {\n\t\t"gte": ${2:0},\n\t\t"lte": ${3:100}\n\t}\n}',
    detail: 'Range query',
  },
  { label: 'exists', insertText: '"exists": {\n\t"field": "${1:field}"\n}', detail: 'Field exists' },
  {
    label: 'wildcard',
    insertText: '"wildcard": {\n\t"${1:field}": "${2:pattern*}"\n}',
    detail: 'Wildcard query',
  },
  { label: 'prefix', insertText: '"prefix": {\n\t"${1:field}": "${2:pre}"\n}', detail: 'Prefix query' },
  {
    label: 'aggs',
    insertText: '"aggs": {\n\t"${1:name}": {\n\t\t"${2:terms}": {\n\t\t\t"field": "${3:field}"\n\t\t}\n\t}\n}',
    detail: 'Aggregations',
  },
  {
    label: 'aggregations',
    insertText:
      '"aggregations": {\n\t"${1:name}": {\n\t\t"${2:terms}": {\n\t\t\t"field": "${3:field}"\n\t\t}\n\t}\n}',
    detail: 'Aggregations (alias)',
  },
  { label: 'sort', insertText: '"sort": [\n\t{ "${1:field}": "${2:asc}" }\n]', detail: 'Sort clause' },
  { label: 'from', insertText: '"from": ${1:0}', detail: 'Pagination offset' },
  { label: 'size', insertText: '"size": ${1:50}', detail: 'Page size' },
  { label: 'track_total_hits', insertText: '"track_total_hits": true', detail: 'Exact hit total' },
  { label: '_source', insertText: '"_source": true', detail: 'Source filtering' },
  {
    label: 'highlight',
    insertText: '"highlight": {\n\t"fields": {\n\t\t"${1:field}": {}\n\t}\n}',
    detail: 'Highlight hits',
  },
]

let disposable: MonacoNs.IDisposable | null = null
let languageReady = false
let fieldNames: string[] = []

export const setCompletionFields = (fields: string[]) => {
  fieldNames = fields
}

export const getCompletionCatalog = () => {
  const keywords = DSL_KEYWORDS.map(k => ({
    label: k.label,
    detail: k.detail,
    insertText: k.insertText,
  }))
  const fields = fieldNames.map(field => ({
    label: field,
    detail: 'Index field',
    insertText: field,
  }))
  return [...keywords, ...fields]
}

const readPrefix = (model: MonacoNs.editor.ITextModel, position: MonacoNs.Position) => {
  const line = model.getLineContent(position.lineNumber)
  const before = line.slice(0, position.column - 1)
  const match = before.match(/["']?([A-Za-z0-9_.]*)$/)
  return match?.[1] || ''
}

const injectSuggestVisibilityCss = () => {
  const id = 'meru-monaco-suggest-visibility'
  if (document.getElementById(id)) return
  const style = document.createElement('style')
  style.id = id
  style.textContent = `
    .monaco-editor .suggest-widget .monaco-list-row,
    .suggest-widget .monaco-list-row {
      color: #111827 !important;
      -webkit-text-fill-color: #111827 !important;
      font-size: 13px !important;
      line-height: 22px !important;
      min-height: 22px !important;
    }
    .monaco-editor .suggest-widget .monaco-list-row.focused,
    .suggest-widget .monaco-list-row.focused {
      color: #ffffff !important;
      -webkit-text-fill-color: #ffffff !important;
      background-color: #0d9488 !important;
    }
    .monaco-editor .suggest-widget .monaco-list-row *,
    .suggest-widget .monaco-list-row * {
      color: inherit !important;
      -webkit-text-fill-color: inherit !important;
      opacity: 1 !important;
      visibility: visible !important;
      font-size: 13px !important;
    }
    .monaco-editor.vs-dark .suggest-widget .monaco-list-row:not(.focused),
    [data-theme="dark"] .monaco-editor .suggest-widget .monaco-list-row:not(.focused) {
      color: #f8fafc !important;
      -webkit-text-fill-color: #f8fafc !important;
    }
  `
  document.head.appendChild(style)
}

export const ensureMeruEditorThemes = (monaco: Monaco) => {
  injectSuggestVisibilityCss()
  monaco.editor.defineTheme('meru-light', {
    base: 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editorSuggestWidget.background': '#ffffff',
      'editorSuggestWidget.foreground': '#111827',
      'editorSuggestWidget.selectedBackground': '#0d9488',
      'editorSuggestWidget.selectedForeground': '#ffffff',
      'editorSuggestWidget.selectedIconForeground': '#ffffff',
      'editorSuggestWidget.highlightForeground': '#0f766e',
      'editorSuggestWidget.focusHighlightForeground': '#ecfdf5',
      'editorSuggestWidget.border': '#d8e0ea',
    },
  })
  monaco.editor.defineTheme('meru-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editorSuggestWidget.background': '#1e293b',
      'editorSuggestWidget.foreground': '#f8fafc',
      'editorSuggestWidget.selectedBackground': '#0d9488',
      'editorSuggestWidget.selectedForeground': '#ffffff',
      'editorSuggestWidget.selectedIconForeground': '#ffffff',
      'editorSuggestWidget.highlightForeground': '#5eead4',
      'editorSuggestWidget.focusHighlightForeground': '#ecfdf5',
      'editorSuggestWidget.border': '#334155',
    },
  })
}

const registerOsJsonLanguage = (monaco: Monaco) => {
  if (languageReady) return
  languageReady = true

  const exists = monaco.languages.getLanguages().some(l => l.id === OS_JSON_LANG)
  if (!exists) {
    monaco.languages.register({ id: OS_JSON_LANG, extensions: ['.osjson'], aliases: ['OpenSearch JSON'] })
  }

  monaco.languages.setLanguageConfiguration(OS_JSON_LANG, {
    brackets: [
      ['{', '}'],
      ['[', ']'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '"', close: '"' },
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '"', close: '"' },
    ],
  })

  monaco.languages.setMonarchTokensProvider(OS_JSON_LANG, {
    tokenizer: {
      root: [
        [/[{}]/, 'delimiter.bracket'],
        [/[\[\]]/, 'delimiter.array'],
        [/:/, 'delimiter'],
        [/,/, 'delimiter'],
        [/"([^"\\]|\\.)*"(?=\s*:)/, 'type'],
        [/"([^"\\]|\\.)*"/, 'string'],
        [/\b\d+(\.\d+)?\b/, 'number'],
        [/\b(true|false|null)\b/, 'keyword'],
        [/\/\/.*$/, 'comment'],
      ],
    },
  })
}

export const registerOpenSearchCompletions = (monaco: Monaco) => {
  ensureMeruEditorThemes(monaco)
  registerOsJsonLanguage(monaco)

  disposable?.dispose()
  disposable = monaco.languages.registerCompletionItemProvider(OS_JSON_LANG, {
    triggerCharacters: ['"', "'", ':', '{', ',', ' ', '.', 's', 'q', 'm', 'a', 'b', 't', 'f'],
    provideCompletionItems: (model, position) => {
      const prefix = readPrefix(model, position).toLowerCase()
      const word = model.getWordUntilPosition(position)
      const range: MonacoNs.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      }

      const keywordItems: MonacoNs.languages.CompletionItem[] = DSL_KEYWORDS.filter(
        k => !prefix || k.label.toLowerCase().startsWith(prefix),
      ).map(k => ({
        label: k.label,
        kind: monaco.languages.CompletionItemKind.Keyword,
        detail: k.detail,
        documentation: k.detail,
        insertText: k.insertText,
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        filterText: k.label,
        sortText: `0_${k.label}`,
        range,
      }))

      const fieldItems: MonacoNs.languages.CompletionItem[] = fieldNames
        .filter(f => !prefix || f.toLowerCase().includes(prefix))
        .slice(0, 40)
        .map(field => ({
          label: field,
          kind: monaco.languages.CompletionItemKind.Field,
          detail: 'Index field',
          insertText: field,
          filterText: field,
          sortText: `1_${field}`,
          range,
        }))

      return { suggestions: [...keywordItems, ...fieldItems] }
    },
  })
}
