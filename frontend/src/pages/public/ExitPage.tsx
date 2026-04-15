import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle,
  ArrowLeft,
  Banknote,
  CheckCircle2,
  Loader2,
  QrCode,
  Search,
} from 'lucide-react'
import {
  exitLookup,
  exitPayCash,
  exitPaySimulate,
  type ExitLookupResponse,
  type ExitPayResponse,
} from '../../api/parking'
import { formatCurrency, formatDateTime, formatDuration } from '../../lib/utils'

type ExitState = 'idle' | 'loading' | 'found' | 'qr' | 'paying' | 'success'

function elapsedMinutes(entryAt: string): number {
  return (Date.now() - new Date(entryAt).getTime()) / 60000
}

export function ExitPage() {
  const [phase, setPhase] = useState<ExitState>('idle')
  const [query, setQuery] = useState('')
  const [lookupData, setLookupData] = useState<ExitLookupResponse | null>(null)
  const [payResult, setPayResult] = useState<ExitPayResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [countdown, setCountdown] = useState(10)
  const inputRef = useRef<HTMLInputElement>(null)

  /* Auto-countdown after success */
  useEffect(() => {
    if (phase !== 'success') return
    setCountdown(10)
    const t = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) { clearInterval(t); reset() }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(t)
  }, [phase])

  const reset = () => {
    setPhase('idle')
    setQuery('')
    setLookupData(null)
    setPayResult(null)
    setError(null)
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  const handleLookup = async () => {
    if (!query.trim()) return
    setError(null)
    setPhase('loading')
    try {
      const res = await exitLookup(query.trim().toUpperCase())
      setLookupData(res)
      setPhase('found')
    } catch (e) {
      setError((e as Error).message)
      setPhase('idle')
    }
  }

  const handleCash = async () => {
    if (!lookupData) return
    setError(null)
    setPhase('paying')
    try {
      const res = await exitPayCash(lookupData.stay_id)
      setPayResult(res)
      setPhase('success')
    } catch (e) {
      setError((e as Error).message)
      setPhase('found')
    }
  }

  const handleConfirmQR = async () => {
    if (!lookupData) return
    setError(null)
    setPhase('paying')
    try {
      const res = await exitPaySimulate(lookupData.stay_id)
      setPayResult(res)
      setPhase('success')
    } catch (e) {
      setError((e as Error).message)
      setPhase('qr')
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950
                    flex flex-col items-center justify-center p-6">

      {/* Back link */}
      <Link
        to="/"
        className="absolute top-6 left-6 flex items-center gap-2 text-slate-500
                   hover:text-slate-300 text-sm transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Mapa público
      </Link>

      {/* ── IDLE ── */}
      {phase === 'idle' && (
        <div className="w-full max-w-sm animate-fade-in">
          <div className="text-center mb-8">
            <h1 className="text-white font-bold text-3xl tracking-wider">SALIDA</h1>
            <p className="text-slate-400 text-sm mt-2">Ingrese el código de su ticket</p>
          </div>

          {error && (
            <div className="mb-4 bg-red-950/60 border border-red-700/50 text-red-300
                            text-sm px-5 py-3 rounded-xl flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <div className="bg-slate-900/80 backdrop-blur border border-slate-700/60 rounded-2xl p-6 shadow-2xl">
            <label className="block text-slate-400 text-xs uppercase tracking-widest mb-2">
              Código de ticket
            </label>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
              placeholder="EST-20250409-0001"
              className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-3
                         text-white font-mono text-lg tracking-widest placeholder:text-slate-600
                         focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30
                         transition-colors uppercase"
              autoFocus
            />
            <button
              onClick={handleLookup}
              disabled={!query.trim()}
              className="mt-4 w-full flex items-center justify-center gap-2
                         bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed
                         text-white font-semibold py-3 rounded-xl transition-colors"
            >
              <Search className="w-5 h-5" />
              Buscar ticket
            </button>
          </div>
        </div>
      )}

      {/* ── LOADING ── */}
      {phase === 'loading' && (
        <div className="text-center animate-fade-in">
          <div className="w-24 h-24 rounded-full bg-blue-600/15 border-2 border-blue-500/30
                          flex items-center justify-center mx-auto mb-6">
            <Loader2 className="w-12 h-12 text-blue-400 animate-spin" />
          </div>
          <p className="text-slate-300 font-medium">Buscando ticket…</p>
        </div>
      )}

      {/* ── FOUND ── */}
      {phase === 'found' && lookupData && (
        <div className="w-full max-w-sm animate-slide-up">
          <div className="bg-slate-900/80 backdrop-blur border border-slate-700/60 rounded-2xl overflow-hidden shadow-2xl">
            {/* Header */}
            <div className="bg-gradient-to-r from-slate-800/80 to-slate-700/60
                            border-b border-slate-600/50 px-6 py-4">
              <p className="text-slate-500 text-xs uppercase tracking-widest mb-1">Ticket encontrado</p>
              <p className="text-white font-mono font-bold text-xl tracking-widest">
                {lookupData.ticket_code}
              </p>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-slate-500 text-xs uppercase tracking-widest mb-1">Ingreso</p>
                  <p className="text-slate-200 text-sm font-medium">{formatDateTime(lookupData.entry_at)}</p>
                </div>
                <div>
                  <p className="text-slate-500 text-xs uppercase tracking-widest mb-1">Tiempo</p>
                  <p className="text-slate-200 text-sm font-medium">
                    {formatDuration(elapsedMinutes(lookupData.entry_at))}
                  </p>
                </div>
              </div>

              {/* Amount */}
              <div className="bg-blue-950/50 border border-blue-800/50 rounded-xl px-5 py-4 text-center">
                <p className="text-slate-400 text-xs uppercase tracking-widest mb-1">Total a pagar</p>
                <p className="text-blue-300 font-bold text-3xl">
                  {lookupData.amount === 0 ? 'GRATIS' : formatCurrency(lookupData.amount)}
                </p>
                {lookupData.amount === 0 && (
                  <p className="text-slate-500 text-xs mt-1">Dentro del período de gracia (15 min)</p>
                )}
              </div>

              {error && (
                <div className="bg-red-950/60 border border-red-700/50 text-red-300
                                text-sm px-4 py-2 rounded-lg flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </div>
              )}

              {/* Payment buttons */}
              <div className="space-y-3 pt-1">
                <button
                  onClick={handleCash}
                  className="w-full flex items-center justify-center gap-3
                             bg-emerald-700 hover:bg-emerald-600
                             text-white font-semibold py-4 rounded-xl transition-colors"
                >
                  <Banknote className="w-6 h-6" />
                  Pagar en Efectivo
                </button>
                <button
                  onClick={() => setPhase('qr')}
                  className="w-full flex items-center justify-center gap-3
                             bg-sky-700 hover:bg-sky-600
                             text-white font-semibold py-4 rounded-xl transition-colors"
                >
                  <QrCode className="w-6 h-6" />
                  Pagar con QR / Mercado Pago
                </button>
              </div>
            </div>
          </div>

          <button
            onClick={reset}
            className="mt-3 w-full text-slate-500 hover:text-slate-300 text-sm py-2 transition-colors"
          >
            Cancelar
          </button>
        </div>
      )}

      {/* ── QR ── */}
      {phase === 'qr' && lookupData && (
        <div className="w-full max-w-sm animate-slide-up">
          <div className="bg-slate-900/80 backdrop-blur border border-slate-700/60 rounded-2xl overflow-hidden shadow-2xl">
            <div className="bg-gradient-to-r from-sky-900/80 to-sky-800/60
                            border-b border-sky-700/50 px-6 py-4 text-center">
              <QrCode className="w-8 h-8 text-sky-400 mx-auto mb-1" />
              <p className="text-white font-semibold">Mercado Pago</p>
              <p className="text-sky-300/70 text-sm">Escanee el código con la app</p>
            </div>

            <div className="px-6 py-5 space-y-4">
              {/* Placeholder QR */}
              <div className="bg-white rounded-2xl p-5 flex items-center justify-center">
                <svg
                  viewBox="0 0 110 110"
                  className="w-48 h-48"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  {/* Top-left finder */}
                  <rect x="8"  y="8"  width="30" height="30" rx="3" fill="none" stroke="#111" strokeWidth="3"/>
                  <rect x="15" y="15" width="16" height="16" rx="1" fill="#111"/>
                  {/* Top-right finder */}
                  <rect x="72" y="8"  width="30" height="30" rx="3" fill="none" stroke="#111" strokeWidth="3"/>
                  <rect x="79" y="15" width="16" height="16" rx="1" fill="#111"/>
                  {/* Bottom-left finder */}
                  <rect x="8"  y="72" width="30" height="30" rx="3" fill="none" stroke="#111" strokeWidth="3"/>
                  <rect x="15" y="79" width="16" height="16" rx="1" fill="#111"/>
                  {/* Timing / data modules */}
                  {[
                    [46,8],[54,8],[62,8],[46,15],[62,15],[46,22],[54,22],
                    [46,40],[54,40],[62,40],[54,46],[46,54],[62,54],
                    [46,62],[54,62],[62,62],[46,70],[62,70],
                    [72,46],[79,46],[86,46],[93,46],[72,54],[86,54],
                    [72,62],[79,62],[93,62],[72,70],[86,70],[93,70],
                    [46,79],[54,79],[62,79],[46,86],[62,86],[54,93],[62,93],
                  ].map(([x, y], i) => (
                    <rect key={i} x={x} y={y} width="6" height="6" fill="#111" />
                  ))}
                  {/* MP label */}
                  <text x="55" y="107" textAnchor="middle" fontSize="5" fill="#0070f3" fontWeight="bold">
                    Mercado Pago
                  </text>
                </svg>
              </div>

              {/* Amount */}
              <div className="bg-sky-950/50 border border-sky-800/50 rounded-xl px-5 py-3 text-center">
                <p className="text-slate-400 text-xs uppercase tracking-widest mb-1">Monto</p>
                <p className="text-sky-300 font-bold text-2xl">
                  {lookupData.amount === 0 ? 'GRATIS' : formatCurrency(lookupData.amount)}
                </p>
              </div>

              {error && (
                <div className="bg-red-950/60 border border-red-700/50 text-red-300
                                text-sm px-4 py-2 rounded-lg flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </div>
              )}

              <button
                onClick={handleConfirmQR}
                className="w-full bg-sky-600 hover:bg-sky-500 text-white font-semibold
                           py-3 rounded-xl transition-colors"
              >
                Confirmar pago
              </button>
              <button
                onClick={() => { setError(null); setPhase('found') }}
                className="w-full text-slate-500 hover:text-slate-300 text-sm py-2 transition-colors"
              >
                Volver
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── PAYING ── */}
      {phase === 'paying' && (
        <div className="text-center animate-fade-in">
          <div className="w-24 h-24 rounded-full bg-emerald-600/15 border-2 border-emerald-500/30
                          flex items-center justify-center mx-auto mb-6">
            <Loader2 className="w-12 h-12 text-emerald-400 animate-spin" />
          </div>
          <p className="text-slate-300 font-medium">Procesando pago…</p>
        </div>
      )}

      {/* ── SUCCESS ── */}
      {phase === 'success' && payResult && (
        <div className="w-full max-w-sm animate-slide-up">
          <div className="bg-slate-900/80 backdrop-blur border border-slate-700/60 rounded-2xl overflow-hidden shadow-2xl">
            <div className="bg-gradient-to-r from-emerald-900/80 to-emerald-800/60
                            border-b border-emerald-700/50 px-6 py-5 text-center">
              <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-2" />
              <h2 className="text-white font-bold text-xl">¡Pago exitoso!</h2>
              <p className="text-emerald-300/70 text-sm mt-1">Puede retirar su vehículo</p>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center">
                  <p className="text-slate-500 text-xs uppercase tracking-widest mb-1">Pagado</p>
                  <p className="text-emerald-300 font-bold text-2xl">
                    {payResult.amount_paid === 0 ? 'GRATIS' : formatCurrency(payResult.amount_paid)}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-slate-500 text-xs uppercase tracking-widest mb-1">Salida</p>
                  <p className="text-slate-200 text-sm font-medium">
                    {formatDateTime(payResult.exit_at)}
                  </p>
                </div>
              </div>

              {/* Countdown bar */}
              <div className="text-center">
                <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden mb-2">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-1000"
                    style={{ width: `${(countdown / 10) * 100}%` }}
                  />
                </div>
                <p className="text-slate-500 text-xs">
                  Volviendo al inicio en{' '}
                  <span className="text-emerald-400 font-semibold">{countdown}s</span>
                </p>
              </div>
            </div>
          </div>

          <button onClick={reset} className="mt-3 w-full btn-secondary justify-center py-3">
            Volver al inicio
          </button>
        </div>
      )}
    </div>
  )
}
