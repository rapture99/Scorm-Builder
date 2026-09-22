import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

export type ToastKind = 'ok' | 'err' | 'warn'

interface Toast {
  id: number
  msg: string
  kind: ToastKind
}

type ToastFn = (msg: string, kind?: ToastKind) => void

const ToastCtx = createContext<ToastFn>(() => {})

export function useToast(): ToastFn {
  return useContext(ToastCtx)
}

const DOT: Record<ToastKind, string> = { ok: 'bg-tealbr', err: 'bg-bad', warn: 'bg-amber' }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const push = useCallback<ToastFn>((msg, kind = 'ok') => {
    const id = nextId.current++
    setToasts((t) => [...t, { id, msg, kind }])
    // errors linger longer — they name the page/question to fix
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 7000 : 3500)
  }, [])

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-5 left-1/2 z-[80] flex w-full max-w-lg -translate-x-1/2 flex-col items-center gap-2 px-4 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex items-start gap-2.5 rounded-[10px] border border-line2 bg-panel2 px-4 py-2.5 text-[13px] shadow-[0_12px_30px_rgba(0,0,0,.4)]"
          >
            <span className={`mt-1.5 h-2 w-2 flex-none rounded-full ${DOT[t.kind]}`} />
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
