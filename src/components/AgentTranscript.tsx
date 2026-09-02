'use client'

import { useEffect, useRef } from 'react'

/**
 * A LOG, not a chat UI.
 *
 * Tool calls render as monospace call signatures because the audience is
 * engineers — this should look like an operator's console, not a chatbot.
 * Auto-scrolls, and streams over SSE so it never needs a spinner.
 */
export type TranscriptLine =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string; input: Record<string, unknown> }
  | { kind: 'system'; text: string }

export function AgentTranscript({ lines }: { lines: TranscriptLine[] }) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [lines.length])

  if (lines.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No run yet. An agent with no mandate can spend nothing.
      </p>
    )
  }

  return (
    <div className="space-y-2 text-sm">
      {lines.map((line, i) => {
        if (line.kind === 'tool') {
          return (
            <div key={i} className="font-mono text-xs text-muted-foreground break-all">
              <span className="text-foreground">▸ {line.name}</span>
              {`(${JSON.stringify(line.input)})`}
            </div>
          )
        }
        if (line.kind === 'system') {
          return (
            <div key={i} className="font-mono text-xs text-muted-foreground">
              {line.text}
            </div>
          )
        }
        return (
          <p key={i} className="leading-relaxed">
            {line.text}
          </p>
        )
      })}
      <div ref={endRef} />
    </div>
  )
}
