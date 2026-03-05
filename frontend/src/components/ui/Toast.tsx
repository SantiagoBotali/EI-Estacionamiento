import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'

type ToastType = 'success' | 'error' | 'info'

interface ToastItem {
  id: string
  type: ToastType
  message: string
}

type ToastFn = (type: ToastType, message: string) => void

const Ctx = createContext<ToastFn | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const addToast: ToastFn = useCallback((type, message) => {
    const id = Math.random().toString(36).slice(2)
    setToasts((p) => [...p, { id, type, message }])
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 4500)
  }, [])

  const dismiss = (id: string) => setToasts((p) => p.filter((t) => t.id !== id))

  return (
    <Ctx.Provider value={addToast}>
      {children}
      <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 w-80 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-3 px-4 py-3.5 rounded-xl border
              shadow-2xl animate-slide-up text-sm font-medium backdrop-blur-sm
              ${t.type === 'success' ? 'bg-emerald-950/95 border-emerald-700/50 text-emerald-100' : ''}
              ${t.type === 'error'   ? 'bg-red-950/95    border-red-700/50    text-red-100'    : ''}
              ${t.type === 'info'    ? 'bg-blue-950/95   border-blue-700/50   text-blue-100'   : ''}
            `}
          >
            {t.type === 'success' && <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400" />}
            {t.type === 'error'   && <AlertCircle  className="w-4 h-4 mt-0.5 shrink-0 text-red-400"     />}
            {t.type === 'info'    && <Info          className="w-4 h-4 mt-0.5 shrink-0 text-blue-400"    />}
            <span className="flex-1 leading-snug">{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              className="opacity-50 hover:opacity-100 transition-opacity mt-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export function useToast(): ToastFn {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast must be inside ToastProvider')
  return ctx
}
