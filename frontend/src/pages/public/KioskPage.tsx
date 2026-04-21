import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Loader2, ParkingCircle, Ticket } from 'lucide-react'
import { createPublicEntry, type EntryResponse } from '../../api/parking'
import { formatDateTime } from '../../lib/utils'

type KioskState = 'idle' | 'loading' | 'ticket'

export function KioskPage() {
  const [phase, setPhase] = useState<KioskState>('idle')
  const [entry, setEntry] = useState<EntryResponse | null>(null)
  const [countdown, setCountdown] = useState(10)
  const [error, setError] = useState<string | null>(null)

  /* Auto-countdown after ticket shown */
  useEffect(() => {
    if (phase !== 'ticket') return
    setCountdown(10)
    const t = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) { clearInterval(t); reset(); }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(t)
  }, [phase])

  const reset = () => {
    setPhase('idle')
    setEntry(null)
    setError(null)
  }

  const handleEntry = async () => {
    setError(null)
    setPhase('loading')
    try {
      const res = await createPublicEntry()
      setEntry(res)
      setPhase('ticket')
      // Auto-print
      printTicket(res)
    } catch (e) {
      setError((e as Error).message)
      setPhase('idle')
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

      {/* Brand */}
      <div className="flex items-center gap-3 mb-12">
        <div>
          <p className="font-bold text-white text-xl leading-none"></p>
          <p className="text-slate-500 text-sm"></p>
        </div>
      </div>

      {/* ── IDLE ── */}
      {phase === 'idle' && (
        <div className="text-center animate-fade-in relative flex flex-col items-center">
          <button
            onClick={handleEntry}
            className="relative w-52 h-52 rounded-full bg-gradient-to-br from-blue-600 to-blue-800
                       text-white flex flex-col items-center justify-center
                       shadow-2xl shadow-blue-900/60 border-4 border-blue-500/30
                       hover:from-blue-500 hover:to-blue-700 active:scale-95
                       transition-all duration-200 focus:outline-none
                       after:absolute after:inset-0 after:rounded-full
                       after:border-4 after:border-blue-400/20
                       after:animate-ping after:scale-110"
          >
            <Ticket className="w-16 h-16 mb-2" />
            <span className="font-bold text-xl tracking-wide">INGRESAR</span>
          </button>
          <div className="h-16 mt-6 flex items-start justify-center">
            {error && (
              <div className="bg-red-950/60 border border-red-700/50 text-red-300
                              text-sm px-5 py-3 rounded-xl max-w-sm text-center animate-fade-in">
                {error}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── LOADING ── */}
      {phase === 'loading' && (
        <div className="text-center animate-fade-in">
          <div className="w-32 h-32 rounded-full bg-blue-600/15 border-2 border-blue-500/30
                          flex items-center justify-center mx-auto mb-6">
            <Loader2 className="w-14 h-14 text-blue-400 animate-spin" />
          </div>
          <p className="text-slate-300 text-lg font-medium">Procesando ingreso…</p>
        </div>
      )}

      {/* ── TICKET ── */}
      {phase === 'ticket' && entry && (
        <div className="animate-slide-up w-full max-w-sm">
          <div className="bg-slate-900/80 backdrop-blur border border-slate-700/60 rounded-2xl overflow-hidden shadow-2xl">
            {/* Header */}
            <div className="bg-gradient-to-r from-emerald-900/80 to-emerald-800/60
                            border-b border-emerald-700/50 px-6 py-5 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
              <h2 className="text-white font-bold text-xl">Ingreso Registrado</h2>
              <p className="text-emerald-300/80 text-sm mt-1">Conserve su ticket</p>
            </div>

            {/* Ticket body */}
            <div className="px-6 py-5 space-y-4">
              <div className="text-center">
                <p className="text-slate-500 text-xs uppercase tracking-widest mb-1">Código</p>
                <p className="text-white font-mono font-bold text-2xl tracking-widest">
                  {entry.ticket_code}
                </p>
              </div>

              <div className="text-center">
                <p className="text-slate-500 text-xs uppercase tracking-widest mb-1">Hora de ingreso</p>
                <p className="text-slate-200 font-semibold">{formatDateTime(entry.entry_at)}</p>
              </div>

              {/* Barcode SVG */}
              <div
                className="bg-white rounded-xl p-3 flex justify-center"
                dangerouslySetInnerHTML={{ __html: entry.barcode_svg }}
              />

              {/* Countdown */}
              <div className="text-center">
                <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden mb-2">
                  <div
                    className="h-full bg-blue-500 transition-all duration-1000"
                    style={{ width: `${(countdown / 10) * 100}%` }}
                  />
                </div>
                <p className="text-slate-500 text-xs">
                  Volviendo al inicio en{' '}
                  <span className="text-blue-400 font-semibold">{countdown}s</span>
                </p>
              </div>
            </div>
          </div>

          <button
            onClick={reset}
            className="mt-4 w-full btn-secondary justify-center py-3"
          >
            Volver al inicio
          </button>
        </div>
      )}
    </div>
  )
}

function printTicket(entry: EntryResponse) {
  const win = window.open('', '_blank', 'width=320,height=340')
  if (!win) return
  win.document.write(`<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>Ticket ${entry.ticket_code}</title>
<style>
@page{size:80mm 90mm;margin:0;}
*{box-sizing:border-box;}
body{font-family:Arial,sans-serif;text-align:center;padding:8px 10px;color:#111;width:80mm;margin:0;}
h1{font-size:14px;margin:0 0 2px;}
.sub{color:#666;font-size:10px;margin:0 0 6px;}
.code{font-size:18px;font-weight:700;letter-spacing:2px;margin:4px 0;}
.label{font-size:9px;color:#888;text-transform:uppercase;letter-spacing:1px;margin:0;}
p{margin:2px 0;font-size:12px;}
.barcode svg{width:100%;max-width:240px;height:auto;}
hr{border:none;border-top:1px dashed #ccc;margin:6px 0;}
.footer{font-size:9px;color:#aaa;}
</style>
</head><body>
<h1>Estacionamiento SDG+</h1>
<p class="sub">Sistema Inteligente de Gestión</p>
<hr/>
<p class="label">Código de ticket</p>
<p class="code">${entry.ticket_code}</p>
<p class="label">Ingreso</p>
<p>${new Date(entry.entry_at).toLocaleString('es-AR')}</p>
<div class="barcode">${entry.barcode_svg}</div>
<hr/>
<p class="footer">Conserve este ticket para su retiro</p>
<script>window.onload=()=>{window.print();setTimeout(()=>window.close(),2000)}<\/script>
</body></html>`)
  win.document.close()
}
