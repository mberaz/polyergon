'use client'
import type { Pipeline } from '@/lib/pipelines'
import { isRunning, pipelineSummary } from '@/lib/pipelineView'
import { PrCard } from './AutomateDialog'

// Every session automation in one place: running first, then finished.
export function AutomationsPage({ pipelines, nameOf, onOpen, onStop }: {
  pipelines: Pipeline[]
  nameOf: (liveId: string) => string
  onOpen: (liveId: string) => void
  onStop: (id: string) => void
}) {
  const sorted = [...pipelines].sort((a, b) => Number(isRunning(b)) - Number(isRunning(a)) || b.updatedAt - a.updatedAt)
  return (
    <div className="absolute inset-0 flex flex-col bg-gray-950 text-gray-100">
      <div className="px-6 pt-5 pb-4 flex items-baseline gap-3 flex-shrink-0">
        <h1 className="text-lg font-semibold">Automations</h1>
        <span className="text-xs text-gray-500">{pipelines.filter(isRunning).length} running</span>
      </div>
      <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-5">
        {sorted.length === 0 && <p className="text-sm text-gray-500 text-center mt-20">No automations yet. Hover a session card and click ⚡ to start one.</p>}
        {sorted.map(p => (
          <section key={p.id} className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
            <div className="flex items-center gap-3 mb-3">
              <span className={`w-2 h-2 rounded-full ${isRunning(p) ? 'bg-blue-400 animate-pulse' : 'bg-gray-600'}`} />
              <button onClick={() => onOpen(p.liveId)} className="text-sm font-medium hover:underline truncate">{nameOf(p.liveId)}</button>
              <span className="text-xs text-gray-500 truncate">⚡ {pipelineSummary(p)}</span>
              <span className="ml-auto flex gap-2 flex-shrink-0">
                <button onClick={() => onOpen(p.liveId)} className="text-xs px-2.5 py-1 rounded-md border border-gray-700 hover:bg-gray-800">Open session</button>
                {isRunning(p) && <button onClick={() => onStop(p.id)} className="text-xs px-2.5 py-1 rounded-md border border-gray-700 text-red-400 hover:bg-red-950/40">Stop</button>}
              </span>
            </div>
            {p.prs.length > 0
              ? <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))' }}>{p.prs.map(t => <PrCard key={t.url} t={t} slackSet={!!p.config.slackChannel} max={p.config.maxRounds} />)}</div>
              : <p className="text-xs text-gray-500">{p.log.at(-1)?.text}</p>}
          </section>
        ))}
      </div>
    </div>
  )
}
