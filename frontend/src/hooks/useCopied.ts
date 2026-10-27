import { useCallback, useRef, useState } from 'react'

export const useCopied = (resetMs = 1500) => {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)

  const markCopied = useCallback(async (text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), resetMs)
  }, [resetMs])

  return { copied, markCopied }
}
