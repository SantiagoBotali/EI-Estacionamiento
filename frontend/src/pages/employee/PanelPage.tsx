import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Activity, Camera, Car, ChevronRight, ClipboardList,
  CreditCard, Loader2, LogOut, MapPin,
  ParkingCircle, Plus, RefreshCw, Search, Sparkles, Users, X,
} from 'lucide-react'
import QRCode from 'react-qr-code'
import { getRole, getToken, getUsername, clearAuth } from '../../api/client'
import { useClock } from '../../hooks/useClock'
import {
  getParkingState, createMPPreference, checkMPPaymentStatus,
  type ParkingState, type MPPreferenceResponse,
} from '../../api/parking'
import {
  getActiveStays, lookupStay, createStay, closeCash,
  getEmployeeTariff, generateTodayStays,
  type ActiveStay, type StayLookupResponse, type TariffInfo,
} from '../../api/employee'
import { ParkingMap } from '../../components/ParkingMap'
import { CameraFeed } from '../../components/CameraFeed'
import { useToast } from '../../components/ui/Toast'
import {
  formatCurrency, formatDateTime,
  getStatusBadge, getStatusLabel,
} from '../../lib/utils'

type Tab = 'map' | 'camera' | 'stays' | 'new'

const TABS: { id: Tab; icon: React.ReactNode; label: string }[] = [
  { id: 'map',    icon: <MapPin        className="w-5 h-5" />, label: 'Mapa en vivo' },
  { id: 'camera', icon: <Camera        className="w-5 h-5" />, label: 'Cámara'       },
  { id: 'stays',  icon: <ClipboardList className="w-5 h-5" />, label: 'Estadías'     },
  { id: 'new',    icon: <Plus          className="w-5 h-5" />, label: 'Nueva estadía' },
]

export function EmployeePanelPage() {
  const nav = useNavigate()
  const toast = useToast()
  const [activeTab, setActiveTab] = useState<Tab>('map')
  const username = getUsername()
  const role = getRole()
  const clock = useClock()

  const logout = () => {
    clearAuth()
    nav('/employee/login', { replace: true })
    toast('info', 'Sesión cerrada')
  }

  useEffect(() => {
    if (!getToken()) nav('/employee/login', { replace: true })
  }, [nav])

  return (
    <div className="min-h-screen bg-slate-950 flex">

      {/* ── Sidebar ── */}
      <aside className="w-16 lg:w-60 shrink-0 bg-slate-900/90 border-r border-slate-800/80
                        flex flex-col sticky top-0 h-screen">

        {/* Brand */}
        <div className="px-3 lg:px-5 py-5 border-b border-slate-800/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-blue-700 rounded-xl
                            flex items-center justify-center shrink-0">
              <ParkingCircle className="w-5 h-5 text-white" />
            </div>
            <div className="hidden lg:block overflow-hidden">
              <p className="font-bold text-white text-sm leading-none truncate">SDG+</p>
              <p className="text-[11px] text-slate-500 leading-none mt-0.5">Empleados</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium
                         transition-all duration-150 ${
                           activeTab === t.id
                             ? 'text-white bg-blue-600/25 border border-blue-500/30'
                             : 'text-slate-400 hover:text-slate-100 hover:bg-slate-700/50'
                         }`}
              title={t.label}
            >
              <span className="shrink-0">{t.icon}</span>
              <span className="hidden lg:block truncate">{t.label}</span>
            </button>
          ))}
        </nav>

        {/* User + logout */}
        <div className="px-2 py-3 border-t border-slate-800/60">
          {/* Clock */}
          <div className="hidden lg:flex flex-col items-center gap-0.5 px-3 py-2.5 mb-1
                          bg-slate-800/40 border border-slate-700/40 rounded-xl mx-1">
            <span className="text-white font-bold text-xl tabular-nums tracking-tight leading-none">
              {clock.time}
            </span>
            <span className="text-slate-500 text-[10px] tracking-wide mt-0.5">
              {clock.date}
            </span>
          </div>
          <div className="hidden lg:flex items-center gap-2.5 px-3 py-2 mb-1">
            <div className="w-7 h-7 rounded-full bg-blue-600/30 border border-blue-500/40
                            flex items-center justify-center shrink-0">
              <Users className="w-3.5 h-3.5 text-blue-400" />
            </div>
            <div className="overflow-hidden">
              <p className="text-slate-200 text-xs font-semibold truncate">{username}</p>
              <p className="text-slate-500 text-[10px]">{role}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium
                       text-slate-500 hover:text-red-400 hover:bg-red-900/20 transition-all duration-150"
            title="Cerrar sesión"
          >
            <LogOut className="w-5 h-5 shrink-0" />
            <span className="hidden lg:block">Cerrar sesión</span>
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 overflow-auto">
        <div className="p-5 lg:p-7 animate-fade-in">
          {activeTab === 'map'    && <MapTab    toast={toast} />}
          {activeTab === 'camera' && <CameraTab />}
          {activeTab === 'stays'  && <StaysTab  toast={toast} />}
          {activeTab === 'new'    && <NewTab    toast={toast} />}
        </div>
      </main>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
   Tab: Mapa
───────────────────────────────────────────────────────────── */
function MapTab({ toast }: { toast: ReturnType<typeof useToast> }) {
  const [state, setState] = useState<ParkingState | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const s = await getParkingState()
      setState(s)
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
    const id = setInterval(load, 2000)
    return () => clearInterval(id)
  }, [load])

  const free     = state?.free ?? 0
  const total    = state?.total ?? 0
  const occupied = total - free
  const pct      = total ? Math.round(((total - free) / total) * 100) : 0

  return (
    <div className="space-y-5">
      <SectionHeader icon={<MapPin className="w-5 h-5" />} title="Mapa en vivo" />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiMini label="Libres"    value={free}     color="text-emerald-400" />
        <KpiMini label="Ocupados"  value={occupied}  color="text-red-400"     />
        <KpiMini label="Total"     value={total}     color="text-slate-200"   />
        <KpiMini label="Ocupación" value={`${pct}%`} color={pct < 50 ? 'text-emerald-400' : pct < 80 ? 'text-amber-400' : 'text-red-400'} />
      </div>

      {loading ? (
        <div className="h-64 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-slate-600" />
        </div>
      ) : state ? (
        <ParkingMap spots={state.spots} minHeight={380} />
      ) : null}

      {state && (
        <p className="text-slate-700 text-xs text-right">
          Actualizado: {new Date(state.last_updated).toLocaleTimeString('es-AR')}
        </p>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
   Tab: Cámara
───────────────────────────────────────────────────────────── */
function CameraTab() {
  return (
    <div className="space-y-5">
      <SectionHeader icon={<Camera className="w-5 h-5" />} title="Cámara en vivo" />
      <CameraFeed className="w-full" style={{ aspectRatio: '16/9', maxHeight: 'calc(100vh - 7rem)' } as React.CSSProperties} />
    </div>
  )
}

/** Mirror of the Python tariff calculation. Returns 0 on any parse error. */
function computeLiveAmount(entryAtStr: string, tariff: TariffInfo | null): number {
  if (!tariff) return 0
  try {
    const entryMs = new Date(entryAtStr).getTime()
    if (isNaN(entryMs)) return 0
    const durationMin = Math.max(0, (Date.now() - entryMs) / 60_000)
    if (durationMin <= tariff.grace_period_minutes) return 0
    const billableHours = (durationMin - tariff.grace_period_minutes) / 60
    const billableRounded = Math.ceil(billableHours * 4) / 4   // round up to ¼ hr
    const amount = billableRounded * tariff.rate_per_hour
    return isNaN(amount) ? 0 : Math.max(amount, tariff.minimum_charge)
  } catch {
    return 0
  }
}

/* ─────────────────────────────────────────────────────────────
   Tab: Estadías — unified view (active list + search/lookup)

   Data layer:
   - activeStays: polled every 10s via getActiveStays()
   - tariff: fetched once on mount (used for live amount computation)
   - tick: flips every 30s to trigger re-render of live amounts
   - lookupResult: on-demand via lookupStay(), cleared on new search
   - cashModal: shared between both list actions and lookup result
───────────────────────────────────────────────────────────── */
function StaysTab({ toast }: { toast: ReturnType<typeof useToast> }) {
  // ── Active stays ─────────────────────────────────────────
  const [stays, setStays]           = useState<ActiveStay[]>([])
  const [staysLoading, setStaysLoading] = useState(true)

  const loadStays = useCallback(async () => {
    try {
      setStays(await getActiveStays())
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setStaysLoading(false)
    }
  }, [toast])

  useEffect(() => {
    loadStays()
    const id = setInterval(loadStays, 10000)
    return () => clearInterval(id)
  }, [loadStays])

  // ── Tariff (for client-side live amount) ─────────────────
  const [tariff, setTariff] = useState<TariffInfo | null>(null)
  useEffect(() => {
    getEmployeeTariff().then(setTariff).catch(() => { /* silent — falls back to 0 */ })
  }, [])

  // ── Generate today's stays ───────────────────────────────
  const [generating, setGenerating] = useState(false)

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      const result = await generateTodayStays()
      toast('success', `${result.generated} estadías generadas para ${result.occupied_spots} lugares ocupados`)
      loadStays()
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setGenerating(false)
    }
  }

  // ── 30-second tick to refresh displayed live amounts ─────
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  // ── Lookup / search ──────────────────────────────────────
  const [query, setQuery]             = useState('')
  const [searchLoading, setSearchLoading] = useState(false)
  const [lookupResult, setLookupResult]   = useState<StayLookupResponse | null>(null)

  const handleSearch = async () => {
    if (!query.trim()) return
    setSearchLoading(true)
    setLookupResult(null)
    try {
      setLookupResult(await lookupStay(query.trim()))
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setSearchLoading(false)
    }
  }

  const clearSearch = () => {
    setQuery('')
    setLookupResult(null)
  }

  // ── Shared payment handlers ──────────────────────────────
  const [cashModal, setCashModal] = useState<{ stayId: string; amount: number } | null>(null)
  const [mpModal, setMpModal]     = useState<{ stayId: string; amount: number } | null>(null)
  const [paying, setPaying]       = useState(false)

  const handleCash = async () => {
    if (!cashModal) return
    setPaying(true)
    try {
      await closeCash(cashModal.stayId)
      toast('success', 'Pago en efectivo registrado')
      setCashModal(null)
      clearSearch()
      loadStays()
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setPaying(false)
    }
  }

  const openCashModal = (stayId: string, amount: number) => setCashModal({ stayId, amount })
  const openMpModal   = (stayId: string, amount: number) => setMpModal({ stayId, amount })

  // ── Render ───────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <SectionHeader icon={<ClipboardList className="w-5 h-5" />} title="Estadías" />

      {/* ── Search bar ── */}
      <div className="flex gap-2 max-w-xl">
        <div className="relative flex-1">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Buscar por código de ticket o UUID…"
            className="input pr-8"
          />
          {query && (
            <button
              onClick={clearSearch}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <button onClick={handleSearch} disabled={searchLoading} className="btn-primary shrink-0">
          {searchLoading
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <Search   className="w-4 h-4" />}
          Buscar
        </button>
      </div>

      {/* ── Lookup result ── */}
      {lookupResult && (
        <div className="card p-5 space-y-4 animate-slide-up border-blue-700/30 max-w-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Search className="w-4 h-4 text-blue-400" />
              <h3 className="font-bold text-white">{lookupResult.ticket.ticket_code}</h3>
            </div>
            <div className="flex items-center gap-2">
              <span className={getStatusBadge(lookupResult.stay.status)}>
                {getStatusLabel(lookupResult.stay.status)}
              </span>
              <button onClick={clearSearch} className="text-slate-500 hover:text-slate-300">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <InfoRow label="Ingreso" value={formatDateTime(lookupResult.stay.entry_at)} />
            {lookupResult.stay.exit_at && (
              <InfoRow label="Salida" value={formatDateTime(lookupResult.stay.exit_at)} />
            )}
            {(lookupResult.stay.status === 'ACTIVE' || lookupResult.stay.status === 'PAYMENT_PENDING') && (
              <InfoRow label="Monto actual" value={formatCurrency(computeLiveAmount(lookupResult.stay.entry_at, tariff))} />
            )}
            {lookupResult.stay.status === 'CLOSED' && (
              <InfoRow label="Monto cobrado" value={formatCurrency(lookupResult.stay.amount_paid ?? 0)} />
            )}
            {lookupResult.stay.notes && (
              <InfoRow label="Notas" value={lookupResult.stay.notes} />
            )}
          </div>

          {(lookupResult.stay.status === 'ACTIVE' || lookupResult.stay.status === 'PAYMENT_PENDING') && (
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => openCashModal(lookupResult.stay.id, computeLiveAmount(lookupResult.stay.entry_at, tariff))}
                className="btn-success"
                disabled={paying}
              >
                <CreditCard className="w-4 h-4" />
                Cobrar efectivo
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Active stays list ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
            Estadías activas
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={handleGenerate}
              disabled={generating || staysLoading}
              className="btn-primary py-1.5 px-3 text-xs bg-indigo-600 hover:bg-indigo-500 border-indigo-500/40"
              title="Cierra las activas y crea una por cada lugar ocupado actualmente"
            >
              {generating
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Sparkles className="w-3.5 h-3.5" />}
              Generar estadías de hoy
            </button>
            <button onClick={loadStays} className="btn-ghost text-xs" disabled={staysLoading}>
              <RefreshCw className={`w-3.5 h-3.5 ${staysLoading ? 'animate-spin' : ''}`} />
              Actualizar
            </button>
          </div>
        </div>

        {staysLoading ? (
          <div className="h-40 flex items-center justify-center">
            <Loader2 className="w-7 h-7 animate-spin text-slate-600" />
          </div>
        ) : stays.length === 0 ? (
          <div className="card px-6 py-12 text-center text-slate-600">
            <Car className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>No hay estadías activas en este momento</p>
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-700/60 bg-slate-900/40">
                    <th className="th">Ticket</th>
                    <th className="th">Ingreso</th>
                    <th className="th">Estado</th>
                    <th className="th">
                      <span className="flex items-center gap-1">
                        Monto actual
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" title="Actualiza cada 30s" />
                      </span>
                    </th>
                    <th className="th">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {stays.map((s) => {
                    const liveAmount = computeLiveAmount(s.entry_at, tariff)
                    return (
                    <tr key={s.id} className="table-row">
                      <td className="td font-mono text-blue-400 font-semibold">
                        {s.ticket?.ticket_code ?? '—'}
                      </td>
                      <td className="td text-slate-400">{formatDateTime(s.entry_at)}</td>
                      <td className="td">
                        <span className={getStatusBadge(s.status)}>
                          {getStatusLabel(s.status)}
                        </span>
                      </td>
                      <td className="td font-semibold text-emerald-400">
                        {formatCurrency(liveAmount)}
                      </td>
                      <td className="td">
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => openCashModal(s.id, liveAmount)}
                            className="btn-success py-1 px-2 text-xs"
                            disabled={paying}
                          >
                            <CreditCard className="w-3.5 h-3.5" />
                            Efectivo
                          </button>
                        </div>
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── Cash modal (shared) ── */}
      {cashModal && (
        <Modal title="Cobro en efectivo" onClose={() => setCashModal(null)}>
          <p className="text-slate-400 text-sm mb-1">Monto a cobrar</p>
          <p className="text-3xl font-bold text-white mb-6">{formatCurrency(cashModal.amount)}</p>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setCashModal(null)} className="btn-secondary">Cancelar</button>
            <button onClick={handleCash} disabled={paying} className="btn-success">
              {paying
                ? <Loader2    className="w-4 h-4 animate-spin" />
                : <CreditCard className="w-4 h-4" />}
              Cobrar
            </button>
          </div>
        </Modal>
      )}

      {/* MercadoPago modal */}
      {mpModal && (
        <EmployeeMPModal
          stayId={mpModal.stayId}
          amount={mpModal.amount}
          onClose={() => setMpModal(null)}
          onPaid={() => { setMpModal(null); clearSearch(); loadStays() }}
          toast={toast}
        />
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
   MercadoPago QR modal (employee)
───────────────────────────────────────────────────────────── */
function EmployeeMPModal({
  stayId, amount, onClose, onPaid, toast,
}: {
  stayId: string
  amount: number
  onClose: () => void
  onPaid: () => void
  toast: ReturnType<typeof useToast>
}) {
  type Phase = 'loading' | 'qr' | 'polling' | 'approved' | 'rejected' | 'error'
  const [phase, setPhase] = useState<Phase>('loading')
  const [pref, setPref]   = useState<MPPreferenceResponse | null>(null)
  const pollRef            = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    createMPPreference(stayId)
      .then((p) => { setPref(p); setPhase('qr') })
      .catch((e) => { toast('error', (e as Error).message); setPhase('error') })
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [stayId, toast])

  const startPolling = () => {
    setPhase('polling')
    pollRef.current = setInterval(async () => {
      try {
        const s = await checkMPPaymentStatus(stayId)
        if (s.status === 'approved') {
          clearInterval(pollRef.current!)
          setPhase('approved')
          setTimeout(onPaid, 1500)
        } else if (s.status === 'rejected') {
          clearInterval(pollRef.current!)
          setPhase('rejected')
        }
      } catch { /* keep polling */ }
    }, 5000)
  }

  const overlayRef = useRef<HTMLDivElement>(null)

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={(e) => e.target === overlayRef.current && onClose()}
    >
      <div className="bg-slate-900 border border-slate-700/60 rounded-2xl p-6 w-full max-w-sm shadow-2xl space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-white text-base">Pago MercadoPago</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X className="w-5 h-5" /></button>
        </div>

        <p className="text-slate-400 text-sm">Monto: <span className="text-white font-bold">{formatCurrency(amount)}</span></p>

        {phase === 'loading' && (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
          </div>
        )}

        {(phase === 'qr' || phase === 'polling') && pref && (
          <div className="space-y-3">
            {pref.qr_data && (
              <div className="bg-white p-3 rounded-xl flex items-center justify-center">
                <QRCode value={pref.qr_data} size={180} />
              </div>
            )}
            <p className="text-xs text-slate-500 text-center">
              {phase === 'polling' ? 'Esperando confirmación de pago…' : 'Escaneá con la app de MercadoPago'}
            </p>
            {pref.checkout_url && (
              <a href={pref.checkout_url} target="_blank" rel="noreferrer"
                className="btn-primary w-full justify-center text-sm">
                Abrir en MercadoPago
              </a>
            )}
            {phase === 'qr' && (
              <button onClick={startPolling} className="btn-ghost w-full text-sm text-slate-400">
                Ya pagué — verificar
              </button>
            )}
            {phase === 'polling' && (
              <div className="flex items-center justify-center gap-2 text-amber-400 text-xs">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Verificando pago…
              </div>
            )}
          </div>
        )}

        {phase === 'approved' && (
          <div className="flex flex-col items-center gap-3 py-4">
            <div className="w-14 h-14 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <Activity className="w-7 h-7 text-emerald-400" />
            </div>
            <p className="text-emerald-400 font-bold">¡Pago aprobado!</p>
          </div>
        )}

        {phase === 'rejected' && (
          <div className="flex flex-col items-center gap-3 py-4">
            <p className="text-red-400 font-bold">Pago rechazado</p>
            <button onClick={onClose} className="btn-ghost text-sm">Cerrar</button>
          </div>
        )}

        {phase === 'error' && (
          <div className="flex flex-col items-center gap-3 py-4">
            <p className="text-red-400 text-sm">No se pudo iniciar el pago</p>
            <button onClick={onClose} className="btn-ghost text-sm">Cerrar</button>
          </div>
        )}
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
   Tab: Nueva estadía
───────────────────────────────────────────────────────────── */
function NewTab({ toast }: { toast: ReturnType<typeof useToast> }) {
  const [notes, setNotes]   = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState<Awaited<ReturnType<typeof createStay>> | null>(null)

  const handleCreate = async () => {
    setLoading(true)
    try {
      const r = await createStay(notes || undefined)
      setResult(r)
      setNotes('')
      printTicket(r.ticket.ticket_code, r.stay.entry_at, r.barcode_svg)
      toast('success', `Estadía ${r.ticket.ticket_code} creada`)
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-5 max-w-md">
      <SectionHeader icon={<Plus className="w-5 h-5" />} title="Nueva estadía" />

      <div className="card p-6 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase
                           tracking-widest mb-2">
            Notas (opcional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ej: Patente AB 123 CD"
            rows={3}
            className="input resize-none"
          />
        </div>

        <button
          onClick={handleCreate}
          disabled={loading}
          className="btn-primary w-full justify-center py-3 text-base"
        >
          {loading
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Creando…</>
            : <><Plus    className="w-4 h-4" /> Registrar ingreso</>}
        </button>
      </div>

      {result && (
        <div className="card p-5 space-y-4 animate-slide-up border-emerald-700/30">
          <div className="flex items-center gap-2 text-emerald-400">
            <ChevronRight className="w-4 h-4" />
            <span className="font-semibold text-sm">Estadía creada exitosamente</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <InfoRow label="Código"  value={result.ticket.ticket_code} mono />
            <InfoRow label="Ingreso" value={formatDateTime(result.stay.entry_at)} />
          </div>
          <div className="bg-white rounded-xl p-3 flex justify-center"
               dangerouslySetInnerHTML={{ __html: result.barcode_svg }} />
          <button
            onClick={() => printTicket(result.ticket.ticket_code, result.stay.entry_at, result.barcode_svg)}
            className="btn-secondary w-full justify-center"
          >
            Reimprimir ticket
          </button>
          <button onClick={() => setResult(null)} className="btn-ghost w-full justify-center text-xs">
            <X className="w-3.5 h-3.5" /> Cerrar
          </button>
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
   Shared helpers
───────────────────────────────────────────────────────────── */
function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-1">
      <div className="text-blue-400">{icon}</div>
      <h2 className="text-lg font-bold text-white">{title}</h2>
    </div>
  )
}

function KpiMini({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="card px-4 py-3">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-[11px] text-slate-500 uppercase tracking-widest mt-0.5">{label}</p>
    </div>
  )
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-0.5">{label}</p>
      <p className={`text-slate-200 text-sm font-medium ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  )
}

function Modal({ title, onClose, children }: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  const overlayRef = useRef<HTMLDivElement>(null)
  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={(e) => e.target === overlayRef.current && onClose()}
    >
      <div className="bg-slate-900 border border-slate-700/60 rounded-2xl p-6 w-full max-w-sm
                      shadow-2xl animate-slide-up">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-white text-base">{title}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function printTicket(code: string, entryAt: string, barcodeSvg: string) {
  const win = window.open('', '_blank', 'width=320,height=340')
  if (!win) return
  win.document.write(`<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>Ticket ${code}</title>
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
<p class="code">${code}</p>
<p class="label">Ingreso</p>
<p>${new Date(entryAt).toLocaleString('es-AR')}</p>
<div class="barcode">${barcodeSvg}</div>
<hr/>
<p class="footer">Conserve este ticket para su retiro</p>
<script>window.onload=()=>{window.print();setTimeout(()=>window.close(),2000)}<\/script>
</body></html>`)
  win.document.close()
}
