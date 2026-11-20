'use client'
import { Fragment, type ReactNode } from 'react'

// Minimal markdown for meeting summaries: headings, bullet/numbered lists,
// **bold**, `code`, paragraphs. Nested list items are indented by their spaces.
// ponytail: no tables/links; switch to react-markdown if summaries start using them.
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i} className="text-gray-100 font-semibold">{part.slice(2, -2)}</strong>
      : part.startsWith('`') && part.endsWith('`') ? <code key={i} className="bg-gray-800 rounded px-1 text-[0.9em]">{part.slice(1, -1)}</code>
      : <Fragment key={i}>{part}</Fragment>)
}

type Block = { kind: 'h'; text: string } | { kind: 'li'; indent: number; marker: string; text: string } | { kind: 'p'; text: string }

export function Markdown({ text }: { text: string }) {
  const blocks: Block[] = []
  let para: string[] = []
  const flush = () => { if (para.length) blocks.push({ kind: 'p', text: para.join(' ') }); para = [] }
  for (const line of text.split('\n')) {
    const h = line.match(/^(#{1,4})\s+(.*)/)
    const li = line.match(/^(\s*)([-*]|\d+[.)])\s+(.*)/)
    const last = blocks.at(-1)
    if (h) { flush(); blocks.push({ kind: 'h', text: h[2] }) }
    else if (li) { flush(); blocks.push({ kind: 'li', indent: li[1].length, marker: li[2], text: li[3] }) }
    else if (!line.trim()) flush()
    // An indented line right after a bullet continues that bullet (wrapped text)
    else if (!para.length && last?.kind === 'li' && /^\s+\S/.test(line)) last.text += ' ' + line.trim()
    else para.push(line.trim())
  }
  flush()
  return (
    <div className="text-sm text-gray-300 leading-relaxed">
      {blocks.map((b, i) => b.kind === 'h'
        ? <h3 key={i} className="text-xs font-semibold text-gray-400 uppercase tracking-wide mt-5 mb-2 first:mt-0">{inline(b.text)}</h3>
        : b.kind === 'li'
          ? <div key={i} className="flex gap-2 mb-1.5" style={{ paddingLeft: Math.min(b.indent, 8) * 8 }}>
              <span className="text-gray-500 flex-shrink-0 w-4 text-right">{/\d/.test(b.marker) ? b.marker : '•'}</span>
              <span>{inline(b.text)}</span>
            </div>
          : <p key={i} className="mb-3">{inline(b.text)}</p>)}
    </div>
  )
}
