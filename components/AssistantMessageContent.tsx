'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'

const PATH_LINK_RE = /(\/[a-z0-9/_\-.]+)/gi
const BOLD_RE = /\*\*([^*]+)\*\*/g

function renderBoldSegments(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  const re = new RegExp(BOLD_RE.source, 'g')

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    parts.push(
      <strong key={`b-${match.index}`} className="font-semibold">
        {match[1]}
      </strong>
    )
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts.length > 0 ? parts : [text]
}

function renderLine(line: string, lineKey: string): ReactNode {
  const segments: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  const re = new RegExp(PATH_LINK_RE.source, 'gi')

  while ((match = re.exec(line)) !== null) {
    const path = match[1]
    if (!path.startsWith('/') || path.startsWith('//')) continue

    const afterMatch = line.slice(match.index + match[0].length)
    const bracketSuffix = afterMatch.match(/^\[[^\]]+\]/)?.[0] ?? ''
    const isPlaceholderRoute = path.includes('[') || Boolean(bracketSuffix)

    if (match.index > lastIndex) {
      segments.push(...renderBoldSegments(line.slice(lastIndex, match.index)))
    }

    if (isPlaceholderRoute) {
      const displayPath = path.includes('[') ? path : `${path}${bracketSuffix}`
      segments.push(...renderBoldSegments(displayPath))
      lastIndex = match.index + path.length + bracketSuffix.length
      re.lastIndex = lastIndex
    } else {
      segments.push(
        <Link
          key={`${lineKey}-l-${match.index}`}
          href={path}
          className="text-indigo-700 underline underline-offset-2 hover:text-indigo-900"
        >
          {path}
        </Link>
      )
      lastIndex = match.index + match[0].length
    }
  }

  if (lastIndex < line.length) {
    segments.push(...renderBoldSegments(line.slice(lastIndex)))
  }

  return segments.length > 0 ? segments : renderBoldSegments(line)
}

export default function AssistantMessageContent({ content }: { content: string }) {
  const lines = content.split('\n')

  return (
    <>
      {lines.map((line, index) => (
        <span key={index}>
          {renderLine(line, `line-${index}`)}
          {index < lines.length - 1 ? <br /> : null}
        </span>
      ))}
    </>
  )
}
