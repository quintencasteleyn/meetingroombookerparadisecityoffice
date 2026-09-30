import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react'

type Kind = 'success' | 'error' | 'info'

interface Toast {
  id: number
  kind: Kind
  message: string
}

type ShowToast = (message: string, kind?: Kind) => void

const ToastContext = createContext<ShowToast | null>(null)

let counter = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), [])

  const show = useCallback<ShowToast>(
    (message, kind = 'success') => {
      const id = ++counter
      setToasts((all) => [...all, { id, kind, message }])
      setTimeout(() => dismiss(id), kind === 'error' ? 7000 : 4500)
    },
    [dismiss],
  )

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => {
          const Icon = t.kind === 'success' ? CheckCircle2 : t.kind === 'error' ? AlertTriangle : Info
          const tone =
            t.kind === 'success' ? 'text-emerald-500' : t.kind === 'error' ? 'text-red-500' : 'text-primary'
          return (
            <div
              key={t.id}
              role="status"
              className="toast-in pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-fg shadow-lg"
            >
              <Icon className={`mt-0.5 size-5 shrink-0 ${tone}`} />
              <p className="flex-1 leading-snug">{t.message}</p>
              <button
                onClick={() => dismiss(t.id)}
                className="rounded p-0.5 text-muted hover:text-fg"
                aria-label="Dismiss"
              >
                <X className="size-4" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ShowToast {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}
