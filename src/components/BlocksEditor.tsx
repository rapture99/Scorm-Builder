import { useRef, type ReactNode } from 'react'
import type { Block, BlockKind, Page } from '../lib/types'
import { putMedia } from '../lib/db'
import { useDispatch } from '../state'
import { useMediaUrl } from '../hooks'
import { useToast } from '../toast'
import { Badge, Button, TextInput } from './ui'

/**
 * Authoring for interactive content blocks. Each editor computes the next
 * immutable `blocks` array and dispatches ONE patchPage — autosave and
 * orphan-GC then run through the existing debounced effect (hotspot images are
 * GC-safe via blockMediaRefs).
 */

const uid = () => crypto.randomUUID()

const KIND_LABEL: Record<BlockKind, string> = {
  accordion: 'Accordion',
  tabs: 'Tabs',
  flashcards: 'Flashcards',
  reveal: 'Click to reveal',
  timeline: 'Timeline',
  hotspots: 'Image hotspots',
}

function newBlock(kind: BlockKind): Block {
  switch (kind) {
    case 'accordion':
    case 'tabs':
      return { id: uid(), kind, items: [{ id: uid(), title: '', body: '' }] }
    case 'flashcards':
      return { id: uid(), kind, cards: [{ id: uid(), front: '', back: '' }] }
    case 'reveal':
      return { id: uid(), kind, prompt: '', body: '' }
    case 'timeline':
      return { id: uid(), kind, items: [{ id: uid(), label: '', title: '', body: '' }] }
    case 'hotspots':
      return { id: uid(), kind, image: null, spots: [] }
  }
}

/** Mirrors projectBlocks' drop rules so authors see why a block won't ship. */
function blockWarning(b: Block): string | null {
  switch (b.kind) {
    case 'accordion':
    case 'tabs':
      return b.items.some((it) => it.title.trim() || it.body.trim()) ? null : 'empty — will not export'
    case 'flashcards':
      return b.cards.some((c) => c.front.trim() || c.back.trim()) ? null : 'empty — will not export'
    case 'reveal':
      return b.body.trim() ? null : 'no content — will not export'
    case 'timeline':
      return b.items.some((it) => it.label.trim() || it.title.trim() || it.body.trim()) ? null : 'empty — will not export'
    case 'hotspots':
      if (!b.image) return 'no image — will not export'
      return b.spots.length ? null : 'no markers yet — click the image to place one'
  }
}

export function BlocksEditor({ page }: { page: Page }) {
  const dispatch = useDispatch()
  const blocks = page.blocks ?? []
  const set = (next: Block[]) => dispatch({ type: 'patchPage', id: page.id, patch: { blocks: next } })
  const patch = (i: number) => (b: Block) => set(blocks.map((x, k) => (k === i ? b : x)))
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= blocks.length) return
    const next = [...blocks]
    ;[next[i], next[j]] = [next[j], next[i]]
    set(next)
  }

  return (
    <div className="mb-4">
      {blocks.map((b, i) => (
        <BlockFrame
          key={b.id}
          label={KIND_LABEL[b.kind]}
          warning={blockWarning(b)}
          canUp={i > 0}
          canDown={i < blocks.length - 1}
          onMove={(dir) => move(i, dir)}
          onRemove={() => set(blocks.filter((_, k) => k !== i))}
        >
          <BlockBody block={b} onChange={patch(i)} />
        </BlockFrame>
      ))}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="lbl mr-1">＋ Block</span>
        {(Object.keys(KIND_LABEL) as BlockKind[]).map((kind) => (
          <button
            key={kind}
            onClick={() => set([...blocks, newBlock(kind)])}
            className="cursor-pointer rounded border border-line bg-panel px-2 py-1 text-[11px] text-mut hover:border-teal hover:text-[#e7eef4]"
          >
            {KIND_LABEL[kind]}
          </button>
        ))}
      </div>
    </div>
  )
}

function BlockFrame({
  label, warning, canUp, canDown, onMove, onRemove, children,
}: {
  label: string
  warning: string | null
  canUp: boolean
  canDown: boolean
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
  children: ReactNode
}) {
  return (
    <div className="mb-3 overflow-hidden rounded-[11px] border border-line bg-panel">
      <div className="flex items-center gap-2 border-b border-line bg-panel2 px-3.5 py-2">
        <span className="lbl flex-1">{label}</span>
        {warning && <Badge tone="warn">{warning}</Badge>}
        <NudgeBtn label="Move block up" disabled={!canUp} onClick={() => onMove(-1)}>▲</NudgeBtn>
        <NudgeBtn label="Move block down" disabled={!canDown} onClick={() => onMove(1)}>▼</NudgeBtn>
        <button
          onClick={onRemove}
          className="cursor-pointer rounded px-2 py-1 font-mono text-xs uppercase tracking-wider text-dim hover:bg-bad/15 hover:text-bad"
        >
          Remove
        </button>
      </div>
      <div className="p-3.5">{children}</div>
    </div>
  )
}

function NudgeBtn({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="cursor-pointer rounded border border-line bg-panel px-1.5 py-0.5 text-[10px] text-mut hover:border-teal disabled:cursor-default disabled:opacity-30"
    >
      {children}
    </button>
  )
}

function MdArea({ value, placeholder, onChange }: { value: string; placeholder: string; onChange: (v: string) => void }) {
  return (
    <textarea
      value={value}
      rows={2}
      spellCheck={false}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full resize-y rounded-lg border border-line bg-panel2 px-2.5 py-2 text-[13px] leading-relaxed text-[#cdd8e2] outline-none placeholder:text-dim focus:border-teal"
    />
  )
}

function RowShell({ index, canUp, canDown, onMove, onRemove, children }: {
  index: number
  canUp: boolean
  canDown: boolean
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
  children: ReactNode
}) {
  return (
    <div className="mb-2 rounded-lg border border-line bg-panel2/40 p-2.5">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="font-mono text-[10px] text-dim">#{index + 1}</span>
        <span className="flex-1" />
        <NudgeBtn label="Move item up" disabled={!canUp} onClick={() => onMove(-1)}>▲</NudgeBtn>
        <NudgeBtn label="Move item down" disabled={!canDown} onClick={() => onMove(1)}>▼</NudgeBtn>
        <NudgeBtn label="Remove item" onClick={onRemove}>✕</NudgeBtn>
      </div>
      {children}
    </div>
  )
}

/** Generic ordered-row editor: handles move/remove/add; `render` draws one row's fields. */
function Rows<T extends { id: string }>({
  rows, onChange, make, addLabel, render,
}: {
  rows: T[]
  onChange: (rows: T[]) => void
  make: () => T
  addLabel: string
  render: (row: T, patch: (p: Partial<T>) => void) => ReactNode
}) {
  const patchRow = (i: number) => (p: Partial<T>) => onChange(rows.map((r, k) => (k === i ? { ...r, ...p } : r)))
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= rows.length) return
    const next = [...rows]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  return (
    <div>
      {rows.map((r, i) => (
        <RowShell
          key={r.id}
          index={i}
          canUp={i > 0}
          canDown={i < rows.length - 1}
          onMove={(dir) => move(i, dir)}
          onRemove={() => onChange(rows.filter((_, k) => k !== i))}
        >
          {render(r, patchRow(i))}
        </RowShell>
      ))}
      <Button onClick={() => onChange([...rows, make()])}>＋ {addLabel}</Button>
    </div>
  )
}

function BlockBody({ block, onChange }: { block: Block; onChange: (b: Block) => void }) {
  switch (block.kind) {
    case 'accordion':
    case 'tabs':
      return (
        <Rows
          rows={block.items}
          onChange={(items) => onChange({ ...block, items })}
          make={() => ({ id: uid(), title: '', body: '' })}
          addLabel={block.kind === 'tabs' ? 'Add tab' : 'Add section'}
          render={(it, patch) => (
            <>
              <TextInput
                value={it.title}
                placeholder={block.kind === 'tabs' ? 'Tab title' : 'Section title'}
                spellCheck={false}
                onChange={(e) => patch({ title: e.target.value })}
                className="mb-1.5"
              />
              <MdArea value={it.body} placeholder="Content…  **bold**  - list  [link](https://…)" onChange={(body) => patch({ body })} />
            </>
          )}
        />
      )
    case 'flashcards':
      return (
        <Rows
          rows={block.cards}
          onChange={(cards) => onChange({ ...block, cards })}
          make={() => ({ id: uid(), front: '', back: '' })}
          addLabel="Add card"
          render={(c, patch) => (
            <div className="grid grid-cols-2 gap-2">
              <MdArea value={c.front} placeholder="Front (question)…" onChange={(front) => patch({ front })} />
              <MdArea value={c.back} placeholder="Back (answer)…" onChange={(back) => patch({ back })} />
            </div>
          )}
        />
      )
    case 'reveal':
      return (
        <>
          <TextInput
            value={block.prompt}
            placeholder='Button label (default: "Reveal")'
            spellCheck={false}
            onChange={(e) => onChange({ ...block, prompt: e.target.value })}
            className="mb-1.5"
          />
          <MdArea value={block.body} placeholder="Hidden content…" onChange={(body) => onChange({ ...block, body })} />
        </>
      )
    case 'timeline':
      return (
        <Rows
          rows={block.items}
          onChange={(items) => onChange({ ...block, items })}
          make={() => ({ id: uid(), label: '', title: '', body: '' })}
          addLabel="Add entry"
          render={(it, patch) => (
            <>
              <div className="mb-1.5 grid grid-cols-[110px_1fr] gap-2">
                <TextInput value={it.label} placeholder="1912 / Step 1" spellCheck={false} onChange={(e) => patch({ label: e.target.value })} />
                <TextInput value={it.title} placeholder="Entry title" spellCheck={false} onChange={(e) => patch({ title: e.target.value })} />
              </div>
              <MdArea value={it.body} placeholder="What happened…" onChange={(body) => patch({ body })} />
            </>
          )}
        />
      )
    case 'hotspots':
      return <HotspotEditor block={block} onChange={onChange} />
  }
}

function HotspotEditor({ block, onChange }: { block: Extract<Block, { kind: 'hotspots' }>; onChange: (b: Block) => void }) {
  const toast = useToast()
  const url = useMediaUrl(block.image)
  const fileRef = useRef<HTMLInputElement>(null)

  async function pick(f: File) {
    const mediaId = uid()
    try {
      await putMedia(mediaId, f)
    } catch (err) {
      toast(`Could not store ${f.name}: ${(err as Error).message}`, 'err')
      return
    }
    onChange({ ...block, image: { mediaId, name: f.name, size: f.size, type: f.type } })
  }

  return (
    <div>
      {block.image && url ? (
        <div className="relative mb-2">
          {/* click-to-place: percentages of the rendered box track responsive scaling */}
          <img
            src={url}
            alt=""
            className="block w-full cursor-crosshair rounded-lg border border-line"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              const x = +(((e.clientX - rect.left) / rect.width) * 100).toFixed(1)
              const y = +(((e.clientY - rect.top) / rect.height) * 100).toFixed(1)
              onChange({ ...block, spots: [...block.spots, { id: uid(), x, y, title: '', body: '' }] })
            }}
          />
          {block.spots.map((s, i) => (
            <span
              key={s.id}
              style={{ left: `${s.x}%`, top: `${s.y}%` }}
              className="pointer-events-none absolute grid h-6 w-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white bg-teal font-mono text-[11px] font-bold text-[#04222a] shadow"
            >
              {i + 1}
            </span>
          ))}
          <div className="mt-1 font-mono text-[10.5px] text-dim">Click the image to place a marker · {block.image.name}</div>
        </div>
      ) : (
        <button
          onClick={() => fileRef.current?.click()}
          className="mb-2 w-full cursor-pointer rounded-lg border-[1.5px] border-dashed border-line2 bg-panel2/40 px-4 py-6 text-center text-xs text-mut hover:border-teal"
        >
          Upload the image to mark up (PNG / JPG / WEBP)
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept=".png,.jpg,.jpeg,.webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void pick(f)
          e.target.value = ''
        }}
      />
      {block.image && (
        <div className="mb-2">
          <Button onClick={() => fileRef.current?.click()}>Replace image…</Button>
        </div>
      )}
      <Rows
        rows={block.spots}
        onChange={(spots) => onChange({ ...block, spots })}
        make={() => ({ id: uid(), x: 50, y: 50, title: '', body: '' })}
        addLabel="Add marker (center)"
        render={(s, patch) => (
          <>
            <div className="mb-1.5 flex items-center gap-2">
              <span className="font-mono text-[10px] text-dim">{s.x}% · {s.y}%</span>
              <TextInput value={s.title} placeholder="Marker title" spellCheck={false} onChange={(e) => patch({ title: e.target.value })} className="flex-1" />
            </div>
            <MdArea value={s.body} placeholder="What this marker explains…" onChange={(body) => patch({ body })} />
          </>
        )}
      />
    </div>
  )
}
