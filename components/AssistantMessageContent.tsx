'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'

const PATH_LINK_RE = /(\/[a-z0-9/_\-.]+)/gi
const MARKDOWN_LINK_RE = /\[([^\]]+)\]\((\/[a-z0-9/_\-.]+)\)/gi
const BOLD_RE = /\*\*([^*]+)\*\*/g

function isSafeRelativePath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') && !path.includes('[')
}

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

type LineMatch =
  | { kind: 'markdown'; index: number; length: number; label: string; path: string }
  | { kind: 'path'; index: number; length: number; path: string; isPlaceholder: boolean; bracketSuffix: string }

function findLineMatches(line: string): LineMatch[] {
  const matches: LineMatch[] = []

  const markdownRe = new RegExp(MARKDOWN_LINK_RE.source, 'gi')
  let markdownMatch: RegExpExecArray | null
  while ((markdownMatch = markdownRe.exec(line)) !== null) {
    const path = markdownMatch[2]
    if (!isSafeRelativePath(path)) continue
    matches.push({
      kind: 'markdown',
      index: markdownMatch.index,
      length: markdownMatch[0].length,
      label: markdownMatch[1],
      path,
    })
  }

  const pathRe = new RegExp(PATH_LINK_RE.source, 'gi')
  let pathMatch: RegExpExecArray | null
  while ((pathMatch = pathRe.exec(line)) !== null) {
    const path = pathMatch[1]
    if (!path.startsWith('/') || path.startsWith('//')) continue

    const matchStart = pathMatch.index
    const matchEnd = matchStart + pathMatch[0].length
    const insideMarkdown = matches.some(
      (candidate) =>
        candidate.kind === 'markdown' &&
        matchStart >= candidate.index &&
        matchStart < candidate.index + candidate.length
    )
    if (insideMarkdown) continue

    const afterMatch = line.slice(matchEnd)
    const bracketSuffix = afterMatch.match(/^\[[^\]]+\]/)?.[0] ?? ''
    const isPlaceholderRoute = path.includes('[') || Boolean(bracketSuffix)

    matches.push({
      kind: 'path',
      index: matchStart,
      length: pathMatch[0].length + (isPlaceholderRoute ? bracketSuffix.length : 0),
      path,
      isPlaceholder: isPlaceholderRoute,
      bracketSuffix,
    })
  }

  return matches.sort((a, b) => a.index - b.index)
}

function renderLine(line: string, lineKey: string): ReactNode {
  const matches = findLineMatches(line)
  if (matches.length === 0) {
    return renderBoldSegments(line)
  }

  const segments: ReactNode[] = []
  let lastIndex = 0

  for (const match of matches) {
    if (match.index > lastIndex) {
      segments.push(...renderBoldSegments(line.slice(lastIndex, match.index)))
    }

    if (match.kind === 'markdown') {
      segments.push(
        <Link
          key={`${lineKey}-m-${match.index}`}
          href={match.path}
          className="text-indigo-700 underline underline-offset-2 hover:text-indigo-900"
        >
          {match.label}
        </Link>
      )
    } else if (match.isPlaceholder) {
      const displayPath = match.path.includes('[')
        ? match.path
        : `${match.path}${match.bracketSuffix}`
      segments.push(...renderBoldSegments(displayPath))
    } else {
      segments.push(
        <Link
          key={`${lineKey}-l-${match.index}`}
          href={match.path}
          className="text-indigo-700 underline underline-offset-2 hover:text-indigo-900"
        >
          {match.path}
        </Link>
      )
    }

    lastIndex = match.index + match.length
  }

  if (lastIndex < line.length) {
    segments.push(...renderBoldSegments(line.slice(lastIndex)))
  }

  return segments
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
