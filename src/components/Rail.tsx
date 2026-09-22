import { useState } from 'react'
import { useDispatch, useEditor } from '../state'

export function Rail() {
  const { course, selectedId } = useEditor()
  const dispatch = useDispatch()
  const [dragOver, setDragOver] = useState<number | null>(null)

  return (
    <aside className="flex min-h-0 flex-col border-r border-line bg-rail">
      <div className="flex items-center justify-between px-3.5 pb-2 pt-3.5">
        <span className="lbl">Pages</span>
        <span className="lbl">{course.pages.length}</span>
      </div>
      <div className="flex-1 overflow-auto px-2.5 pb-2.5">
        {course.pages.map((p, i) => {
          const qc = p.quiz?.questions?.length ?? 0
          const hasProblem = (p.quiz?.problems?.length ?? 0) > 0
          return (
            <div
              key={p.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/reorder', String(i))
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('text/reorder')) {
                  e.preventDefault()
                  setDragOver(i)
                }
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => {
                setDragOver(null)
                const from = e.dataTransfer.getData('text/reorder')
                if (from !== '') {
                  e.preventDefault()
                  dispatch({ type: 'movePage', from: parseInt(from, 10), to: i })
                }
              }}
              onClick={() => dispatch({ type: 'select', id: p.id })}
              className={`group relative mb-2 cursor-pointer rounded-[9px] border p-2.5 transition-colors ${
                p.id === selectedId ? 'border-teal bg-teal/10' : 'border-line bg-panel hover:border-line2'
              } ${dragOver === i ? 'border-dashed !border-tealbr' : ''}`}
            >
              <div className="mb-1.5 flex items-center gap-2">
                <span className="flex-none rounded border border-line px-1.5 py-px font-mono text-[10px] text-teal">{i + 1}</span>
                <span className="flex-1 truncate text-[12.5px] font-medium">{p.title || 'Untitled'}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Chip on={!!p.video}>▶ vid</Chip>
                <Chip on={!!p.image}>⛰ img</Chip>
                {p.audio && <Chip on>♫ aud</Chip>}
                {p.doc && <Chip on>⎘ pdf</Chip>}
                {p.captions && <Chip on>cc</Chip>}
                {(p.blocks?.length ?? 0) > 0 && <Chip on>⧉ {p.blocks!.length} blk</Chip>}
                <Chip on={qc > 0} bad={hasProblem}>? {qc || 'quiz'}</Chip>
              </div>
              <button
                title="Delete page"
                onClick={(e) => {
                  e.stopPropagation()
                  dispatch({ type: 'deletePage', id: p.id })
                }}
                className="absolute right-2 top-2 hidden h-5 w-5 place-items-center rounded text-[15px] leading-none text-dim hover:bg-bad/15 hover:text-bad group-hover:grid"
              >
                ×
              </button>
            </div>
          )
        })}
      </div>
      <div className="mx-2.5 mb-3">
        <button
          onClick={() => dispatch({ type: 'addPage' })}
          className="w-full cursor-pointer rounded-[9px] border border-dashed border-line2 px-3 py-2.5 text-[13px] font-medium text-mut hover:border-teal hover:text-tealbr"
        >
          ＋ Add page
        </button>
      </div>
    </aside>
  )
}

function Chip({ on, bad, children }: { on: boolean; bad?: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-px font-mono text-[9.5px] tracking-[.5px] ${
        bad ? 'border-bad/40 text-bad' : on ? 'border-tealbr/35 text-tealbr' : 'border-line text-mut'
      } bg-panel2`}
    >
      {children}
    </span>
  )
}
