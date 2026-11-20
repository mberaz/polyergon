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

export function Markdown({ text }: { text: string }) {
  const out: ReactNode[] = []
  let para: string[] = []
  const flush = () => { if (para.length) out.push(<p key={out.length} className="mb-3">{inline(para.join(' '))}</p>); para = [] }
  for (const line of text.split('\n')) {
    const h = line.match(/^(#{1,4})\s+(.*)/)
    const li = line.match(/^(\s*)([-*]|\d+[.)])\s+(.*)/)
    if (h) {
      flush()
      out.push(<h3 key={out.length} className="text-xs font-semibold text-gray-400 uppercase tracking-wide mt-5 mb-2 first:mt-0">{inline(h[2])}</h3>)
    } else if (li) {
      flush()
      const numbered = /\d/.test(li[2])
      out.push(
        <div key={out.length} className="flex gap-2 mb-1.5" style={{ paddingLeft: Math.min(li[1].length, 8) * 8 }}>
          <span className="text-gray-500 flex-shrink-0 w-4 text-right">{numbered ? li[2] : '•'}</span>
          <span>{inline(li[3])}</span>
        </div>)
    } else if (!line.trim()) flush()
    else para.push(line.trim())
  }
  flush()
  return <div className="text-sm text-gray-300 leading-relaxed">{out}</div>
}
