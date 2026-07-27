import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Banknote, Camera, Car, ChevronRight, ClipboardList,
  CreditCard, FileText, Loader2, LogOut, MapPin,
  Plus, RefreshCw, Search, Sparkles, Users, X,
} from 'lucide-react'
import { getRole, getToken, getUsername, clearAuth } from '../../api/client'
import logoGeneral from '../../../logos/logogeneral.png'
import { useClock } from '../../hooks/useClock'
import {
  getParkingState,
  type ParkingState,
} from '../../api/parking'
import {
  getActiveStays, lookupStay, createStay, closeCash,
  getEmployeeTariff, generateTodayStays,
  getCashClosingPreview, createCashClosing, listCashClosings, EMPLOYEES,
  type ActiveStay, type StayLookupResponse, type TariffInfo,
  type CashClosingPreview, type CashClosing,
} from '../../api/employee'
import { ParkingMap } from '../../components/ParkingMap'
import { CameraFeed } from '../../components/CameraFeed'
import { useToast } from '../../components/ui/Toast'
import {
  formatCurrency, formatDateTime,
  getStatusBadge, getStatusLabel,
} from '../../lib/utils'

type Tab = 'map' | 'camera' | 'stays' | 'new' | 'cash'

const TABS: { id: Tab; icon: React.ReactNode; label: string }[] = [
  { id: 'map',    icon: <MapPin        className="w-5 h-5" />, label: 'Mapa en vivo' },
  { id: 'camera', icon: <Camera        className="w-5 h-5" />, label: 'Cámara'       },
  { id: 'stays',  icon: <ClipboardList className="w-5 h-5" />, label: 'Estadías'     },
  { id: 'new',    icon: <Plus          className="w-5 h-5" />, label: 'Nueva estadía' },
  { id: 'cash',   icon: <Banknote      className="w-5 h-5" />, label: 'Caja'         },
]

const poppedCashRequests = new Set<string>()


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

  const [globalCashRequest, setGlobalCashRequest] = useState<{stayId: string, amount: number} | null>(null)

  useEffect(() => {
    if (!getToken()) return
    const id = setInterval(async () => {
      try {
        const stays = await getActiveStays()
        const pendingCash = stays.find(s => s.status === 'PAYMENT_PENDING' && s.payment_method === 'CASH')
        if (pendingCash && !poppedCashRequests.has(pendingCash.id)) {
          poppedCashRequests.add(pendingCash.id)
          toast('success', `Solicitud de cobro en efectivo: ${pendingCash.ticket?.ticket_code}`)
          setActiveTab('stays')
          setGlobalCashRequest({ stayId: pendingCash.id, amount: pendingCash.amount_expected })
        }
      } catch (e) {
        // ignore
      }
    }, 5000)
    return () => clearInterval(id)
  }, [toast])

  return (
    <div className="min-h-screen bg-slate-950 flex">

      {/* ── Sidebar ── */}
      <aside className="w-16 lg:w-60 shrink-0 bg-slate-900/90 border-r border-slate-800/80
                        flex flex-col sticky top-0 h-screen">

        {/* Brand */}
        <div className="px-3 lg:px-5 py-5 border-b border-slate-800/60">
          <div className="flex items-center gap-3">
            <img src={logoGeneral} alt="Sistema de Estacionamiento" className="h-9 w-auto object-contain shrink-0" />
            <div className="hidden lg:block overflow-hidden">
              <p className="font-bold text-white text-sm leading-none truncate">Panel empleado</p>
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
              <p className="text-slate-500 text-[10px]">Empleado</p>
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
          {activeTab === 'stays'  && <StaysTab  toast={toast} globalCashRequest={globalCashRequest} onClearGlobalRequest={() => setGlobalCashRequest(null)} />}
          {activeTab === 'new'    && <NewTab    toast={toast} />}
          {activeTab === 'cash'   && <CashTab   toast={toast} />}
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
    return isNaN(amount) ? 0 : Math.ceil(Math.max(amount, tariff.minimum_charge))
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
function StaysTab({ toast, globalCashRequest, onClearGlobalRequest }: { toast: ReturnType<typeof useToast>, globalCashRequest: {stayId: string, amount: number} | null, onClearGlobalRequest: () => void }) {
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
  const [paying, setPaying]       = useState(false)
  const [notesModal, setNotesModal] = useState<string | null>(null)

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

  useEffect(() => {
    if (globalCashRequest) {
      setCashModal({ stayId: globalCashRequest.stayId, amount: globalCashRequest.amount })
      onClearGlobalRequest()
    }
  }, [globalCashRequest, onClearGlobalRequest])

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
                          {s.notes && (
                            <button
                              onClick={() => setNotesModal(s.notes!)}
                              className="btn-ghost py-1 px-2 text-xs text-amber-400 hover:text-amber-300"
                              title="Ver observaciones"
                            >
                              <FileText className="w-3.5 h-3.5" />
                            </button>
                          )}
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

      {/* ── Notes modal ── */}
      {notesModal && (
        <Modal title="Observaciones" onClose={() => setNotesModal(null)}>
          <p className="text-slate-200 text-sm leading-relaxed whitespace-pre-wrap">{notesModal}</p>
          <div className="flex justify-end mt-5">
            <button onClick={() => setNotesModal(null)} className="btn-secondary">Cerrar</button>
          </div>
        </Modal>
      )}

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
   Tab: Caja
───────────────────────────────────────────────────────────── */
function CashTab({ toast }: { toast: ReturnType<typeof useToast> }) {
  const [preview, setPreview] = useState<CashClosingPreview | null>(null)
  const [history, setHistory] = useState<CashClosing[]>([])
  const [loading, setLoading] = useState(true)
  const [employeeName, setEmployeeName] = useState('')
  const [actualCash, setActualCash] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [p, h] = await Promise.all([getCashClosingPreview(), listCashClosings()])
      setPreview(p)
      setHistory(h)
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { loadData() }, [loadData])

  const actualCashNum = parseFloat(actualCash) || 0
  const liveDiff = preview ? actualCashNum - preview.cash_amount : 0
  const canSubmit = employeeName !== '' && actualCash.trim() !== ''

  const handleClose = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      await createCashClosing({
        employee_name: employeeName,
        actual_cash: actualCashNum,
        notes: notes.trim() || undefined,
      })
      toast('success', 'Caja cerrada correctamente')
      setEmployeeName('')
      setActualCash('')
      setNotes('')
      setConfirming(false)
      loadData()
    } catch (e) {
      toast('error', (e as Error).message)
      setConfirming(false)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="h-40 flex items-center justify-center">
        <Loader2 className="w-7 h-7 animate-spin text-slate-600" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <SectionHeader icon={<Banknote className="w-5 h-5" />} title="Cierre de caja" />

      {/* ── Preview del período actual ── */}
      {preview && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
              Período actual
            </p>
            <button
              onClick={loadData}
              disabled={loading}
              className="btn-secondary py-1 px-3 text-xs flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
              Actualizar
            </button>
          </div>

          <div className="text-[11px] text-slate-500 mb-1">
            Desde:{' '}
            <span className="text-slate-400">
              {preview.period_from === '1970-01-01T00:00:00Z' || new Date(preview.period_from).getFullYear() === 1970
                ? 'Inicio del historial'
                : formatDateTime(preview.period_from)}
            </span>
            {' → '}
            Hasta ahora
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="card px-4 py-3">
              <p className="text-lg font-bold text-emerald-400">{formatCurrency(preview.cash_amount)}</p>
              <p className="text-[11px] text-slate-500 uppercase tracking-widest mt-0.5">Efectivo cobrado</p>
            </div>
            <div className="card px-4 py-3">
              <p className="text-lg font-bold text-purple-400">{formatCurrency(preview.digital_amount)}</p>
              <p className="text-[11px] text-slate-500 uppercase tracking-widest mt-0.5">Digital cobrado</p>
            </div>
            <div className="card px-4 py-3">
              <p className="text-lg font-bold text-white">{formatCurrency(preview.total_amount)}</p>
              <p className="text-[11px] text-slate-500 uppercase tracking-widest mt-0.5">Total combinado</p>
            </div>
            <div className="card px-4 py-3">
              <p className="text-lg font-bold text-blue-400">{preview.stay_count}</p>
              <p className="text-[11px] text-slate-500 uppercase tracking-widest mt-0.5">Estadías del período</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Formulario de cierre ── */}
      <div className="card p-6 space-y-4 border-emerald-700/30">
        <h3 className="font-semibold text-white">Realizar cierre de caja</h3>

        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">
            Empleado que cierra
          </label>
          <select
            value={employeeName}
            onChange={(e) => setEmployeeName(e.target.value)}
            className="input w-full"
          >
            <option value="">— Seleccionar empleado —</option>
            {EMPLOYEES.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">
            Monto en efectivo contado
          </label>
          <input
            type="number"
            value={actualCash}
            onChange={(e) => setActualCash(e.target.value)}
            placeholder="0.00"
            step="0.01"
            className="input w-full"
          />
        </div>

        {actualCash && preview && (
          <div className={`flex justify-between items-center text-sm font-semibold p-2.5 rounded border ${liveDiff >= 0 ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-red-500/20 text-red-300 border-red-500/40'}`}>
            <span>Diferencia (contado vs esperado en efectivo)</span>
            <span>{liveDiff >= 0 ? '+' : ''}{formatCurrency(liveDiff)}</span>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">
            Observaciones (opcional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ej: Diferencia por billete roto..."
            rows={2}
            className="input w-full resize-none"
          />
        </div>

        {!confirming ? (
          <button
            onClick={() => setConfirming(true)}
            disabled={!canSubmit}
            className="btn-success w-full justify-center py-2"
          >
            <CreditCard className="w-4 h-4" />
            Cerrar Caja
          </button>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-amber-300 font-semibold text-center">
              ¿Confirmar cierre de caja por {employeeName}?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirming(false)}
                className="btn-secondary flex-1 justify-center py-2"
              >
                Cancelar
              </button>
              <button
                onClick={handleClose}
                disabled={submitting}
                className="btn-success flex-1 justify-center py-2"
              >
                {submitting
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Cerrando…</>
                  : 'Confirmar'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Historial de cierres ── */}
      {history.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
            Historial de cierres
          </p>
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-700/60 bg-slate-900/40">
                    <th className="th">Fecha y hora</th>
                    <th className="th">Empleado</th>
                    <th className="th">Efectivo esperado</th>
                    <th className="th">Contado</th>
                    <th className="th">Digital</th>
                    <th className="th">Total</th>
                    <th className="th">Diferencia</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((c) => (
                    <tr key={c.id} className="table-row">
                      <td className="td text-slate-300 text-sm">{formatDateTime(c.closed_at)}</td>
                      <td className="td font-semibold text-white">{c.employee_name}</td>
                      <td className="td text-slate-200">{formatCurrency(c.cash_amount)}</td>
                      <td className="td text-slate-200">{formatCurrency(c.actual_cash)}</td>
                      <td className="td text-purple-300">{formatCurrency(c.digital_amount)}</td>
                      <td className="td font-semibold text-white">{formatCurrency(c.total_amount)}</td>
                      <td className={`td font-semibold ${c.difference >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {c.difference >= 0 ? '+' : ''}{formatCurrency(c.difference)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {history.length === 0 && !loading && (
        <p className="text-center text-slate-600 text-sm py-4">No hay cierres registrados aún.</p>
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
  const win = window.open('', '_blank', 'width=320,height=480')
  if (!win) return
  win.document.write(`<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>Ticket ${code}</title>
<style>
@page{size:80mm auto;margin:0;}
*{box-sizing:border-box;}
html,body{margin:0;padding:0;width:100%;background:#fff;}
body{font-family:Arial,sans-serif;color:#111;}
.ticket{width:80mm;margin:0 auto;text-align:center;padding:8px 10px;}
h1{font-size:14px;margin:0 0 2px;}
.sub{color:#666;font-size:10px;margin:0 0 6px;}
.code{font-size:18px;font-weight:700;letter-spacing:2px;margin:4px 0;}
.label{font-size:9px;color:#888;text-transform:uppercase;letter-spacing:1px;margin:0;}
p{margin:2px 0;font-size:12px;}
.barcode svg{width:100%;height:auto;}
hr{border:none;border-top:1px dashed #ccc;margin:6px 0;}
.footer{font-size:9px;color:#aaa;}
</style>
</head><body>
<div class="ticket">
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
</div>
<script>window.onload=()=>{window.print();setTimeout(()=>window.close(),2000)}<\/script>
</body></html>`)
  win.document.close()
}
