import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Activity, Banknote, BarChart2, Calendar, Camera, Car, ClipboardList, Clock, CreditCard,
  DollarSign, Download, FileText, Loader2, LogOut, MapPin, Plus, Printer,
  RefreshCw, Search, Settings, ShieldCheck, Sparkles, TrendingUp, Users, Wifi, WifiOff, X, Zap,
} from 'lucide-react'
import {
  Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis, Legend, Line, LineChart,
} from 'recharts'
import { clearAuth, getRole, getUsername } from '../../api/client'
import logoAdmin from '../../../logos/logoadmin.png'
import {
  getOperationsKPI, getFinanceKPI, getTariffSettings, updateTariff, getRollupKPI, getFinancialReport,
  type FinanceKPI, type OperationsKPI, type TariffSettings, type RollupKPI, type FinancialReportData,
} from '../../api/admin'
import {
  getActiveStays, lookupStay, closeCash,
  getEmployeeTariff, generateTodayStays,
  listCashClosings,
  type ActiveStay, type StayLookupResponse, type TariffInfo, type CashClosing,
} from '../../api/employee'
import {
  getParkingState,
  type ParkingState,
} from '../../api/parking'
import { CameraFeed } from '../../components/CameraFeed'
import { ParkingMap } from '../../components/ParkingMap'
import { FinancialReportPrint } from '../../components/FinancialReportPrint'
import { Modal } from '../../components/Modal'
import { useParkingSSE } from '../../hooks/useParkingSSE'
import { useClock } from '../../hooks/useClock'
import { useToast } from '../../components/ui/Toast'
import { formatCurrency, formatDateTime, formatDuration, getStatusBadge, getStatusLabel } from '../../lib/utils'

type Tab = 'operations' | 'finance' | 'camera' | 'live' | 'dashboards' | 'stays' | 'reports' | 'cashclosings'

const TABS: { id: Tab; icon: React.ReactNode; label: string }[] = [
  { id: 'operations',   icon: <BarChart2    className="w-5 h-5" />, label: 'Operaciones'     },
  { id: 'finance',      icon: <DollarSign   className="w-5 h-5" />, label: 'Finanzas'        },
  { id: 'cashclosings', icon: <Banknote     className="w-5 h-5" />, label: 'Cierres de caja' },
  { id: 'stays',        icon: <ClipboardList className="w-5 h-5" />, label: 'Estadías'       },
  { id: 'dashboards',   icon: <Calendar     className="w-5 h-5" />, label: 'Dashboards'      },
  { id: 'reports',      icon: <TrendingUp   className="w-5 h-5" />, label: 'Reportes'        },
  { id: 'camera',       icon: <Camera       className="w-5 h-5" />, label: 'Cámara'          },
  { id: 'live',         icon: <MapPin       className="w-5 h-5" />, label: 'En vivo'         },
]

const CHART_THEME = {
  grid: '#1e293b',
  axis: '#475569',
  text: '#94a3b8',
  tooltip: { bg: '#0f172a', border: '#334155' },
}

const METHOD_COLORS: Record<string, string> = {
  CASH: '#22c55e',
  MERCADOPAGO: '#a855f7',
}

export function AdminDashboardPage() {
  const nav = useNavigate()
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('operations')
  const username = getUsername()
  const role = getRole()
  const clock = useClock()

  const logout = () => {
    clearAuth()
    nav('/admin/login', { replace: true })
    toast('info', 'Sesión cerrada')
  }

  useEffect(() => {
    if (role !== 'ADMIN') nav('/admin/login', { replace: true })
  }, [nav, role])

  return (
    <div className="min-h-screen bg-slate-950 flex">

      {/* ── Sidebar ── */}
      <aside className="w-16 lg:w-64 shrink-0 bg-slate-900/90 border-r border-slate-800/80
                        flex flex-col sticky top-0 h-screen">

        {/* Brand */}
        <div className="px-3 lg:px-5 py-5 border-b border-slate-800/60">
          <div className="flex items-center gap-3">
            <img src={logoAdmin} alt="Panel de Administración" className="h-9 w-auto object-contain shrink-0" />
            <div className="hidden lg:block overflow-hidden">
              <p className="font-bold text-white text-sm leading-none truncate">Panel de admin</p>
              <p className="text-[11px] text-slate-500 leading-none mt-0.5">Administración</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium
                         transition-all duration-150 ${tab === t.id
                  ? 'text-white bg-purple-600/25 border border-purple-500/30'
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
            <div className="w-7 h-7 rounded-full bg-purple-600/30 border border-purple-500/40
                            flex items-center justify-center shrink-0">
              <ShieldCheck className="w-3.5 h-3.5 text-purple-400" />
            </div>
            <div className="overflow-hidden">
              <p className="text-slate-200 text-xs font-semibold truncate">{username}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium
                       text-slate-500 hover:text-red-400 hover:bg-red-900/20 transition-all"
            title="Cerrar sesión"
          >
            <LogOut className="w-5 h-5 shrink-0" />
            <span className="hidden lg:block">Cerrar sesión</span>
          </button>
        </div>
      </aside>

      {/* ── Content ── */}
      <main className="flex-1 overflow-auto">
        <div className="p-5 lg:p-7 animate-fade-in">
          {tab === 'operations'   && <OperationsTab    toast={toast} />}
          {tab === 'finance'      && <FinanceTab       toast={toast} />}
          {tab === 'cashclosings' && <CashClosingsTab  toast={toast} />}
          {tab === 'stays'        && <StaysTab         toast={toast} />}
          {tab === 'dashboards' && <DashboardsTab toast={toast} />}
          {tab === 'reports' && <ReportsTab toast={toast} />}
          {tab === 'camera' && <CameraTab toast={toast} />}
          {tab === 'live' && <LiveTab />}
        </div>
      </main>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
   Tab: Operaciones
───────────────────────────────────────────────────────────── */
const HIGH_RATE_THRESHOLD = 10_000

function OperationsTab({ toast }: { toast: ReturnType<typeof useToast> }) {
  const [kpi, setKpi] = useState<OperationsKPI | null>(null)
  const [tariff, setTariff] = useState<TariffSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  // Per-field tariff inputs
  const [newRate, setNewRate] = useState('')
  const [newMin, setNewMin] = useState('')
  const [newGrace, setNewGrace] = useState('')
  const [rateError, setRateError] = useState('')
  const [minError, setMinError] = useState('')
  const [graceError, setGraceError] = useState('')
  const [savingField, setSavingField] = useState<'rate' | 'min' | 'grace' | null>(null)
  const [confirmRate, setConfirmRate] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      const [k, t] = await Promise.all([getOperationsKPI(), getTariffSettings()])
      setKpi(k)
      setTariff(t)
      setLastRefresh(new Date())
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
    const id = setInterval(load, 30000)
    return () => clearInterval(id)
  }, [load])

  const doSaveField = async (fields: Partial<TariffSettings>, field: 'rate' | 'min' | 'grace') => {
    setConfirmRate(null)
    setSavingField(field)
    try {
      await updateTariff(fields)
      const updated = await getTariffSettings()
      setTariff(updated)
      if (field === 'rate') setNewRate('')
      if (field === 'min') setNewMin('')
      if (field === 'grace') setNewGrace('')
      toast('success', 'Tarifa actualizada')
    } catch (err) {
      toast('error', (err as Error).message)
    } finally {
      setSavingField(null)
    }
  }

  const saveRate = (e: FormEvent) => {
    e.preventDefault()
    const v = parseFloat(newRate.trim())
    if (!newRate.trim() || isNaN(v) || v <= 0) { setRateError('Ingresá un valor mayor a 0'); return }
    setRateError('')
    if (v > HIGH_RATE_THRESHOLD) { setConfirmRate(v); return }
    doSaveField({ rate_per_hour: v }, 'rate')
  }

  const saveMin = (e: FormEvent) => {
    e.preventDefault()
    const v = parseFloat(newMin.trim())
    if (!newMin.trim() || isNaN(v) || v < 0) { setMinError('Ingresá un valor válido'); return }
    setMinError('')
    doSaveField({ minimum_charge: v }, 'min')
  }

  const saveGrace = (e: FormEvent) => {
    e.preventDefault()
    const v = parseInt(newGrace.trim(), 10)
    if (!newGrace.trim() || isNaN(v) || v < 0) { setGraceError('Ingresá un valor válido en minutos'); return }
    setGraceError('')
    doSaveField({ grace_period_minutes: v }, 'grace')
  }

  if (loading) return <LoadingScreen />

  return (
    <div className="space-y-6">
      <AdminHeader
        icon={<BarChart2 className="w-5 h-5" />}
        title="Operaciones"
        lastRefresh={lastRefresh}
        onRefresh={load}
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={<Car className="w-5 h-5" />} label="Autos hoy" value={kpi?.autos_hoy ?? 0} color="blue" />
        <KpiCard icon={<Clock className="w-5 h-5" />} label="Duración promedio" value={formatDuration(kpi?.duracion_promedio_min ?? 0)} color="purple" />
        <KpiCard icon={<Zap className="w-5 h-5" />} label="Hora pico" value={kpi?.hora_pico ?? '—'} color="amber" />
        <KpiCard icon={<Activity className="w-5 h-5" />} label="Ocupación actual" value={`${Math.round(kpi?.tasa_ocupacion_pct ?? 0)}%`} color="emerald" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <ChartCard title="Ingresos de autos por hora (hoy)">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={kpi?.autos_por_hora ?? []} barSize={10}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
              <XAxis dataKey="hour" stroke={CHART_THEME.axis} tick={{ fill: CHART_THEME.text, fontSize: 11 }} interval={3} />
              <YAxis stroke={CHART_THEME.axis} tick={{ fill: CHART_THEME.text, fontSize: 11 }} />
              <Tooltip contentStyle={{ backgroundColor: CHART_THEME.tooltip.bg, border: `1px solid ${CHART_THEME.tooltip.border}`, borderRadius: 8, color: '#f1f5f9' }} itemStyle={{ color: '#f1f5f9' }} labelStyle={{ color: '#94a3b8' }} />
              <Bar dataKey="count" fill="#3b82f6" radius={[3, 3, 0, 0]} name="Autos" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Ingresos de autos por día (últimos 7 días)">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={kpi?.autos_por_dia ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
              <XAxis dataKey="date" stroke={CHART_THEME.axis} tick={{ fill: CHART_THEME.text, fontSize: 11 }} />
              <YAxis stroke={CHART_THEME.axis} tick={{ fill: CHART_THEME.text, fontSize: 11 }} />
              <Tooltip contentStyle={{ backgroundColor: CHART_THEME.tooltip.bg, border: `1px solid ${CHART_THEME.tooltip.border}`, borderRadius: 8, color: '#f1f5f9' }} itemStyle={{ color: '#f1f5f9' }} labelStyle={{ color: '#94a3b8' }} />
              <Line type="monotone" dataKey="count" stroke="#818cf8" strokeWidth={2.5} dot={{ fill: '#818cf8', r: 4 }} name="Autos" />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Tariff config — each field editable separately */}
      {tariff && (
        <div className="card p-5 space-y-5">
          <div className="flex items-center gap-2 text-slate-300 font-semibold">
            <Settings className="w-4 h-4 text-slate-500" />
            Configuración de tarifas
          </div>

          {/* Tarifa / hora */}
          <div className="space-y-2">
            <p className="text-slate-500 text-xs uppercase tracking-wider">Tarifa / hora</p>
            <p className="text-white font-bold text-lg">{formatCurrency(tariff.rate_per_hour)}</p>
            <form onSubmit={saveRate} className="flex gap-2">
              <div className="flex flex-col gap-1 max-w-xs w-full">
                <input
                  type="text" inputMode="decimal" value={newRate}
                  onChange={(e) => { setNewRate(e.target.value); setRateError('') }}
                  placeholder="Nueva tarifa/hora (ARS)"
                  className={`input w-full ${rateError ? 'border-red-500/60' : ''}`}
                  disabled={savingField !== null}
                />
                {rateError && <p className="text-red-400 text-xs">{rateError}</p>}
              </div>
              <button type="submit" disabled={savingField !== null} className="btn-primary shrink-0 self-start">
                {savingField === 'rate' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Settings className="w-4 h-4" />}
                Guardar
              </button>
            </form>
          </div>

          <div className="border-t border-slate-800" />

          {/* Mínimo */}
          <div className="space-y-2">
            <p className="text-slate-500 text-xs uppercase tracking-wider">Cargo mínimo</p>
            <p className="text-white font-bold text-lg">{formatCurrency(tariff.minimum_charge)}</p>
            <form onSubmit={saveMin} className="flex gap-2">
              <div className="flex flex-col gap-1 max-w-xs w-full">
                <input
                  type="text" inputMode="decimal" value={newMin}
                  onChange={(e) => { setNewMin(e.target.value); setMinError('') }}
                  placeholder="Nuevo mínimo (ARS)"
                  className={`input w-full ${minError ? 'border-red-500/60' : ''}`}
                  disabled={savingField !== null}
                />
                {minError && <p className="text-red-400 text-xs">{minError}</p>}
              </div>
              <button type="submit" disabled={savingField !== null} className="btn-primary shrink-0 self-start">
                {savingField === 'min' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Settings className="w-4 h-4" />}
                Guardar
              </button>
            </form>
          </div>

          <div className="border-t border-slate-800" />

          {/* Período de gracia */}
          <div className="space-y-2">
            <p className="text-slate-500 text-xs uppercase tracking-wider">Período de gracia</p>
            <p className="text-white font-bold text-lg">{tariff.grace_period_minutes} min</p>
            <form onSubmit={saveGrace} className="flex gap-2">
              <div className="flex flex-col gap-1 max-w-xs w-full">
                <input
                  type="text" inputMode="numeric" value={newGrace}
                  onChange={(e) => { setNewGrace(e.target.value); setGraceError('') }}
                  placeholder="Nuevo período de gracia (min)"
                  className={`input w-full ${graceError ? 'border-red-500/60' : ''}`}
                  disabled={savingField !== null}
                />
                {graceError && <p className="text-red-400 text-xs">{graceError}</p>}
              </div>
              <button type="submit" disabled={savingField !== null} className="btn-primary shrink-0 self-start">
                {savingField === 'grace' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Settings className="w-4 h-4" />}
                Guardar
              </button>
            </form>
          </div>
        </div>
      )}

      {/* High-rate confirmation modal */}
      {confirmRate !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-amber-500/40 rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0">
                <Zap className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <p className="text-white font-semibold text-sm">Tarifa inusualmente alta</p>
                <p className="text-slate-400 text-xs mt-1">
                  Estás por guardar{' '}
                  <span className="text-amber-300 font-bold">{formatCurrency(confirmRate)}/hr</span>.
                  Esto supera el umbral normal. ¿Confirmar el cambio?
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmRate(null)} className="btn-ghost text-sm">Cancelar</button>
              <button
                onClick={() => doSaveField({ rate_per_hour: confirmRate }, 'rate')}
                className="btn-primary text-sm bg-amber-600 hover:bg-amber-500 border-amber-500/40"
              >
                Confirmar igual
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
   Tab: Cierres de caja
───────────────────────────────────────────────────────────── */
function CashClosingsTab({ toast }: { toast: ReturnType<typeof useToast> }) {
  const [history, setHistory]       = useState<CashClosing[]>([])
  const [loading, setLoading]       = useState(true)
  const [filterMonth, setFilterMonth] = useState('') // YYYY-MM
  const [filterDate, setFilterDate]   = useState('') // YYYY-MM-DD
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setHistory(await listCashClosings())
      setLastRefresh(new Date())
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  const filtered = history.filter((c) => {
    const d = new Date(c.closed_at)
    if (filterDate) {
      const fd = new Date(filterDate + 'T00:00:00')
      return d.getFullYear() === fd.getFullYear() &&
             d.getMonth()    === fd.getMonth()    &&
             d.getDate()     === fd.getDate()
    }
    if (filterMonth) {
      const [y, m] = filterMonth.split('-').map(Number)
      return d.getFullYear() === y && d.getMonth() + 1 === m
    }
    return true
  })

  const totals = filtered.reduce(
    (acc, c) => ({
      cash:    acc.cash    + c.cash_amount,
      actual:  acc.actual  + c.actual_cash,
      digital: acc.digital + c.digital_amount,
      total:   acc.total   + c.total_amount,
      diff:    acc.diff    + c.difference,
      stays:   acc.stays   + c.stay_count,
    }),
    { cash: 0, actual: 0, digital: 0, total: 0, diff: 0, stays: 0 },
  )

  return (
    <div className="space-y-6">
      <AdminHeader
        icon={<Banknote className="w-5 h-5" />}
        title="Cierres de caja"
        lastRefresh={lastRefresh}
        onRefresh={load}
      />

      {/* ── Filtros ── */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-widest shrink-0">Mes</label>
          <input
            type="month"
            value={filterMonth}
            onChange={(e) => { setFilterMonth(e.target.value); setFilterDate('') }}
            className="input py-1.5 px-3 text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-widest shrink-0">Fecha</label>
          <input
            type="date"
            value={filterDate}
            onChange={(e) => { setFilterDate(e.target.value); setFilterMonth('') }}
            className="input py-1.5 px-3 text-sm"
          />
        </div>
        {(filterMonth || filterDate) && (
          <button
            onClick={() => { setFilterMonth(''); setFilterDate('') }}
            className="btn-ghost text-xs flex items-center gap-1.5"
          >
            <X className="w-3 h-3" /> Limpiar filtro
          </button>
        )}
      </div>

      {loading ? (
        <LoadingScreen />
      ) : filtered.length === 0 ? (
        <div className="card px-6 py-12 text-center text-slate-600">
          <Banknote className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>{history.length === 0
            ? 'No hay cierres registrados aún.'
            : 'No hay cierres para el período seleccionado.'}</p>
        </div>
      ) : (
        <>
          {/* ── KPIs de resumen (solo cuando hay más de un resultado) ── */}
          {filtered.length > 1 && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="card px-4 py-3">
                <p className="text-lg font-bold text-emerald-400">{formatCurrency(totals.total)}</p>
                <p className="text-[11px] text-slate-500 uppercase tracking-widest mt-0.5">Total cobrado</p>
              </div>
              <div className="card px-4 py-3">
                <p className="text-lg font-bold text-blue-400">{totals.stays}</p>
                <p className="text-[11px] text-slate-500 uppercase tracking-widest mt-0.5">Estadías</p>
              </div>
              <div className="card px-4 py-3">
                <p className="text-lg font-bold text-purple-400">{formatCurrency(totals.digital)}</p>
                <p className="text-[11px] text-slate-500 uppercase tracking-widest mt-0.5">Digital</p>
              </div>
              <div className="card px-4 py-3">
                <p className={`text-lg font-bold ${totals.diff >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {totals.diff >= 0 ? '+' : ''}{formatCurrency(totals.diff)}
                </p>
                <p className="text-[11px] text-slate-500 uppercase tracking-widest mt-0.5">Diferencia neta</p>
              </div>
            </div>
          )}

          {/* ── Tabla ── */}
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-700/60 bg-slate-900/40">
                    <th className="th">Fecha y hora</th>
                    <th className="th">Empleado</th>
                    <th className="th">Estadías</th>
                    <th className="th">Efectivo esperado</th>
                    <th className="th">Contado</th>
                    <th className="th">Digital</th>
                    <th className="th">Total</th>
                    <th className="th">Diferencia</th>
                    <th className="th">Observaciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr key={c.id} className="table-row">
                      <td className="td text-slate-300 text-sm">{formatDateTime(c.closed_at)}</td>
                      <td className="td font-semibold text-white">{c.employee_name}</td>
                      <td className="td text-slate-400">{c.stay_count}</td>
                      <td className="td text-slate-200">{formatCurrency(c.cash_amount)}</td>
                      <td className="td text-slate-200">{formatCurrency(c.actual_cash)}</td>
                      <td className="td text-purple-300">{formatCurrency(c.digital_amount)}</td>
                      <td className="td font-semibold text-white">{formatCurrency(c.total_amount)}</td>
                      <td className={`td font-semibold ${c.difference >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {c.difference >= 0 ? '+' : ''}{formatCurrency(c.difference)}
                      </td>
                      <td className="td text-slate-400 text-xs max-w-[200px]">
                        {c.notes
                          ? <span title={c.notes} className="truncate block">{c.notes}</span>
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
   Tab: Finanzas
───────────────────────────────────────────────────────────── */
function FinanceTab({ toast }: { toast: ReturnType<typeof useToast> }) {
  const [granularity, setGranularity] = useState<Granularity>(() =>
    (sessionStorage.getItem('financeGranularity') as Granularity) ?? 'monthly'
  )
  const [selectedMonth, setSelectedMonth] = useState<string>('') // YYYY-MM (daily)
  const [selectedYear, setSelectedYear] = useState<string>('') // YYYY    (monthly)
  const [kpi, setKpi] = useState<FinanceKPI | null>(null)
  const [rollup, setRollup] = useState<RollupKPI | null>(null)
  const [yearlyTotal, setYearlyTotal] = useState<number>(0)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [chartKey, setChartKey] = useState(0) // increments on every successful fetch → forces pie remount

  const load = useCallback(async (gran: Granularity, month: string, yr: string) => {
    try {
      // Fetch yearly total separately only when no specific filter is active
      const needYearly = gran !== 'yearly' && !month && !yr
      const [k, r, y] = await Promise.all([
        getFinanceKPI(),
        getRollupKPI(gran, month || undefined, yr || undefined),
        needYearly ? getRollupKPI('yearly') : Promise.resolve(null),
      ])
      setKpi(k)
      setRollup(r)
      setChartKey(prev => prev + 1)
      // yearly total sources:
      //   granularity=yearly   → r is already historical
      //   selectedYear active  → r.total_revenue is that year's total
      //   otherwise            → y is the separate yearly fetch
      setYearlyTotal(gran === 'yearly' || yr ? r.total_revenue : (y?.total_revenue ?? 0))
      setLastRefresh(new Date())
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load(granularity, selectedMonth, selectedYear)
    const id = setInterval(() => load(granularity, selectedMonth, selectedYear), 30000)
    return () => clearInterval(id)
  }, [load, granularity, selectedMonth, selectedYear])  // eslint-disable-line

  const switchGran = (g: Granularity) => {
    sessionStorage.setItem('financeGranularity', g)
    setGranularity(g)
    setSelectedMonth('')
    setSelectedYear('')
  }

  if (loading) return <LoadingScreen />

  const pieData = (rollup?.by_method ?? [])
    .filter((m) => m.method !== 'SIMULATED')
    .map((m) => ({
      name: m.method === 'CASH' ? 'Efectivo' : 'MercadoPago',
      value: m.amount,
      color: METHOD_COLORS[m.method] ?? '#64748b',
    }))

  const chartBarSize = granularity === 'yearly' ? 40 : granularity === 'monthly' ? 14 : 12

  const activeFilter = selectedMonth || selectedYear
  const defaultLabel = granularity === 'daily' ? 'Últimos 30 días' : granularity === 'monthly' ? 'Últimos 12 meses' : ''
  const resetFilter = () => { setSelectedMonth(''); setSelectedYear('') }

  const revenueData = fillPeriodGaps(
    rollup?.revenue_by_period ?? [],
    granularity,
    selectedMonth || undefined,
    selectedYear || undefined,
  )

  const xInterval = calcXInterval(revenueData.length)

  const periodBadge = rollup?.period_label ?? ''

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center gap-4 flex-wrap">
        {/* Title — left */}
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <div className="text-purple-400"><DollarSign className="w-5 h-5" /></div>
          <h2 className="text-lg font-bold text-white">Finanzas</h2>
        </div>
        {/* Refresh — center */}
        <div className="flex items-center gap-2 justify-center">
          {lastRefresh && (
            <span className="text-slate-600 text-xs hidden sm:block">
              Act. {lastRefresh.toLocaleTimeString('es-AR')}
            </span>
          )}
          <button onClick={() => load(granularity, selectedMonth, selectedYear)} className="btn-ghost text-xs">
            <RefreshCw className="w-3.5 h-3.5" />
            Actualizar
          </button>
        </div>
        {/* Granularity + filter — right */}
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <div className="flex items-center gap-1 bg-slate-900/60 border border-slate-800 rounded-xl p-1">
            {(Object.keys(GRAN_LABELS) as Granularity[]).map((g) => (
              <button
                key={g}
                onClick={() => switchGran(g)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 ${granularity === g && !activeFilter
                  ? 'bg-purple-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
                  }`}
              >
                {GRAN_LABELS[g]}
              </button>
            ))}
          </div>
          {granularity === 'daily' && <MonthPicker value={selectedMonth} onChange={setSelectedMonth} />}
          {granularity === 'monthly' && <YearPicker value={selectedYear} onChange={setSelectedYear} />}
        </div>
      </div>

      {/* Period badge + reset */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="px-2.5 py-1 bg-slate-800 border border-slate-700 rounded-full text-xs font-medium text-slate-400">
          {periodBadge}
        </span>
        {activeFilter && granularity !== 'yearly' && (
          <button
            onClick={resetFilter}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium text-amber-400 border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            {defaultLabel}
          </button>
        )}
      </div>

      {/* KPIs */}
      {(() => {
        const currentYear = new Date().getFullYear()
        const yearlyLabel =
          granularity === 'yearly' ? 'Total histórico' :
            selectedYear ? `Total ${selectedYear}` :
              `Total ${currentYear}`
        return (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard icon={<DollarSign className="w-5 h-5" />} label="Ingresos hoy" value={formatCurrency(kpi?.ingresos_hoy ?? 0)} color="emerald" />
            <KpiCard icon={<TrendingUp className="w-5 h-5" />} label="Ingresos del mes" value={formatCurrency(kpi?.ingresos_mes ?? 0)} color="blue" />
            <KpiCard icon={<CreditCard className="w-5 h-5" />} label="Ticket promedio hoy" value={formatCurrency(kpi?.ticket_promedio ?? 0)} color="purple" />
            <KpiCard icon={<TrendingUp className="w-5 h-5" />} label={yearlyLabel} value={formatCurrency(yearlyTotal)} color="amber" />
          </div>
        )
      })()}

      {/* Charts */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <ChartCard title={`Ingresos por período (${activeFilter ? activeFilter : GRAN_LABELS[granularity].toLowerCase()})`}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={revenueData} barSize={chartBarSize}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
              <XAxis dataKey="label" stroke={CHART_THEME.axis} tick={{ fill: CHART_THEME.text, fontSize: 11 }} interval={xInterval} />
              <YAxis stroke={CHART_THEME.axis} tick={{ fill: CHART_THEME.text, fontSize: 11 }} tickFormatter={(v) => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`} />
              <Tooltip contentStyle={{ backgroundColor: CHART_THEME.tooltip.bg, border: `1px solid ${CHART_THEME.tooltip.border}`, borderRadius: 8, color: '#f1f5f9' }} itemStyle={{ color: '#f1f5f9' }} labelStyle={{ color: '#94a3b8' }} formatter={(v: number) => [formatCurrency(v), 'Ingresos']} labelFormatter={(l) => `Período: ${l}`} />
              <Bar dataKey="amount" fill="#22c55e" radius={[3, 3, 0, 0]} name="Ingresos" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title={`Distribución por método de pago${activeFilter ? ` (${periodBadge})` : ''}`}>
          {pieData.length === 0 ? (
            <div className="h-60 flex items-center justify-center text-slate-600 text-sm">Sin datos de pagos registrados</div>
          ) : (
            <ResponsiveContainer key={chartKey} width="100%" height={240}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={65} outerRadius={100} paddingAngle={3} dataKey="value" isAnimationActive={false}>
                  {pieData.map((entry, i) => <Cell key={i} fill={entry.color} stroke="transparent" />)}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: CHART_THEME.tooltip.bg, border: `1px solid ${CHART_THEME.tooltip.border}`, borderRadius: 8, color: '#f1f5f9' }} itemStyle={{ color: '#f1f5f9' }} labelStyle={{ color: '#94a3b8' }} formatter={(v: number) => [formatCurrency(v)]} />
                <Legend formatter={(v) => <span style={{ color: '#94a3b8', fontSize: 12 }}>{v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
   Tab: Cámara
───────────────────────────────────────────────────────────── */
function CameraTab({ toast }: { toast: ReturnType<typeof useToast> }) {
  const [parkState, setParkState] = useState<ParkingState | null>(null)

  const load = useCallback(async () => {
    try {
      setParkState(await getParkingState())
    } catch (e) {
      toast('error', (e as Error).message)
    }
  }, [toast])

  useEffect(() => {
    load()
    const id = setInterval(load, 2000)
    return () => clearInterval(id)
  }, [load])

  const free = parkState?.free ?? '—'
  const occupied = parkState ? parkState.total - parkState.free : '—'
  const pct = parkState ? Math.round(parkState.occupancy_rate * 100) : '—'

  return (
    <div className="space-y-5">
      <SectionHeader icon={<Camera className="w-5 h-5" />} title="Cámara en vivo" />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Camera */}
        <div className="xl:col-span-2">
          <CameraFeed className="w-full" style={{ aspectRatio: '16/9', maxHeight: 'calc(100vh - 7rem)' } as React.CSSProperties} />
        </div>

        {/* Stats panel */}
        <div className="space-y-3">
          <div className="card p-5 space-y-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
              Estado actual
            </p>
            <div className="space-y-3">
              <StatRow label="Lugares libres" value={free} color="text-emerald-400" />
              <StatRow label="Lugares ocupados" value={occupied} color="text-red-400" />
              <StatRow label="Tasa de ocupación" value={typeof pct === 'number' ? `${pct}%` : pct}
                color={typeof pct === 'number' ? (pct < 50 ? 'text-emerald-400' : pct < 80 ? 'text-amber-400' : 'text-red-400') : 'text-slate-400'} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
   Tab: En vivo
───────────────────────────────────────────────────────────── */
function LiveTab() {
  const { state, status } = useParkingSSE()

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <SectionHeader icon={<MapPin className="w-5 h-5" />} title="Mapa en vivo" />
        <div className="flex items-center gap-1.5 text-xs">
          {status === 'connected' && <Wifi className="w-3.5 h-3.5 text-emerald-400" />}
          {status === 'connecting' && <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />}
          {status === 'error' && <WifiOff className="w-3.5 h-3.5 text-red-400" />}
          <span className={`font-medium text-xs
            ${status === 'connected' ? 'text-emerald-400' : ''}
            ${status === 'connecting' ? 'text-amber-400' : ''}
            ${status === 'error' ? 'text-red-400' : ''}
          `}>
            {status === 'connected' ? 'En línea' : ''}
            {status === 'connecting' ? 'Conectando…' : ''}
            {status === 'error' ? 'Sin conexión' : ''}
          </span>
        </div>
      </div>

      {!state ? (
        <div className="card h-64 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-slate-600" />
        </div>
      ) : (
        <div className="card p-4">
          <ParkingMap spots={state.spots} minHeight={500} className="w-full" />
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
   Tab: Dashboards Operacionales
───────────────────────────────────────────────────────────── */
type Granularity = 'daily' | 'monthly' | 'yearly'

const GRAN_LABELS: Record<Granularity, string> = {
  daily: 'Diario',
  monthly: 'Mensual',
  yearly: 'Anual',
}

const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const MONTH_NAMES_FULL = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

function YearPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const currentYear = new Date().getFullYear()
  const years: number[] = []
  for (let y = 2024; y <= currentYear; y++) years.push(y)
  const selectCls = 'bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-300 focus:outline-none focus:border-purple-500 cursor-pointer'
  return (
    <div className="flex items-center gap-1">
      <select value={value || ''} onChange={(e) => onChange(e.target.value)} className={selectCls}>
        <option value="">Año</option>
        {years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
      </select>
      {value && (
        <button onClick={() => onChange('')} className="text-slate-500 hover:text-slate-200 px-1 text-base leading-none" title="Limpiar">×</button>
      )}
    </div>
  )
}

function MonthPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const now = new Date()
  const currentYear = now.getFullYear()
  const [selMonth, setSelMonth] = useState<number>(value ? parseInt(value.slice(5, 7)) : 0)
  const [selYear, setSelYear] = useState<number>(value ? parseInt(value.slice(0, 4)) : 0)

  useEffect(() => {
    if (!value) { setSelMonth(0); setSelYear(0) }
    else { setSelYear(parseInt(value.slice(0, 4))); setSelMonth(parseInt(value.slice(5, 7))) }
  }, [value])

  const emit = (y: number, m: number) => {
    if (y && m) onChange(`${y}-${String(m).padStart(2, '0')}`)
    else onChange('')
  }

  const years: number[] = []
  for (let y = 2024; y <= currentYear; y++) years.push(y)

  const selectCls = 'bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-300 focus:outline-none focus:border-purple-500 cursor-pointer'

  return (
    <div className="flex items-center gap-1">
      <select value={selMonth || ''} onChange={(e) => { const m = Number(e.target.value); setSelMonth(m); emit(selYear, m) }} className={selectCls}>
        <option value="">Mes</option>
        {MONTH_NAMES_FULL.map((name, i) => <option key={i} value={i + 1}>{name}</option>)}
      </select>
      <select value={selYear || ''} onChange={(e) => { const y = Number(e.target.value); setSelYear(y); emit(y, selMonth) }} className={selectCls}>
        <option value="">Año</option>
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
      {(selMonth > 0 || selYear > 0) && (
        <button onClick={() => { setSelMonth(0); setSelYear(0); onChange('') }} className="text-slate-500 hover:text-slate-200 px-1 text-base leading-none" title="Limpiar">×</button>
      )}
    </div>
  )
}

/** Returns an XAxis interval so at most ~7 labels appear regardless of data length */
function calcXInterval(dataLen: number): number {
  if (dataLen <= 12) return 0
  return Math.max(1, Math.ceil(dataLen / 7) - 1)
}

/** Fill gaps so every expected period bucket appears in the chart */
function fillPeriodGaps(
  raw: { period: string; count?: number; amount?: number }[],
  granularity: Granularity,
  specificMonth?: string, // 'YYYY-MM' — fills that month's days (daily view)
  specificYear?: string,  // 'YYYY'    — fills all 12 months of that year (monthly view)
): { period: string; label: string; count: number; amount: number }[] {
  const map = new Map<string, { count: number; amount: number }>()
  for (const r of raw) {
    map.set(r.period, { count: r.count ?? 0, amount: r.amount ?? 0 })
  }

  const now = new Date()
  const result: { period: string; label: string; count: number; amount: number }[] = []

  if (granularity === 'daily' && specificMonth) {
    const [sy, sm] = specificMonth.split('-').map(Number)
    const daysInMonth = new Date(sy, sm, 0).getDate()
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${sy}-${String(sm).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      const label = `${String(d).padStart(2, '0')}/${String(sm).padStart(2, '0')}`
      result.push({ period: key, label, ...(map.get(key) ?? { count: 0, amount: 0 }) })
    }
  } else if (granularity === 'monthly' && specificYear) {
    const year = parseInt(specificYear)
    for (let m = 0; m < 12; m++) {
      const key = `${year}-${String(m + 1).padStart(2, '0')}`
      const label = `${MONTH_NAMES[m]} ${String(year).slice(2)}`
      result.push({ period: key, label, ...(map.get(key) ?? { count: 0, amount: 0 }) })
    }
  } else if (granularity === 'daily') {
    for (let d = 29; d >= 0; d--) {
      const dt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - d))
      const key = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
      const label = `${String(dt.getUTCDate()).padStart(2, '0')}/${String(dt.getUTCMonth() + 1).padStart(2, '0')}`
      result.push({ period: key, label, ...(map.get(key) ?? { count: 0, amount: 0 }) })
    }
  } else if (granularity === 'monthly') {
    for (let m = 11; m >= 0; m--) {
      const dt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, 1))
      const key = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`
      const label = `${MONTH_NAMES[dt.getUTCMonth()]} ${String(dt.getUTCFullYear()).slice(2)}`
      result.push({ period: key, label, ...(map.get(key) ?? { count: 0, amount: 0 }) })
    }
  } else {
    // yearly: just use raw data sorted
    const sorted = [...raw].sort((a, b) => a.period.localeCompare(b.period))
    for (const r of sorted) {
      result.push({ period: r.period, label: r.period, count: r.count ?? 0, amount: r.amount ?? 0 })
    }
  }

  return result
}

function formatPeriodLabel(period: string | undefined, granularity: Granularity): string {
  if (!period) return '—'
  if (granularity === 'daily') {
    const [, m, d] = period.split('-')
    return `${d}/${m}`
  }
  if (granularity === 'monthly') {
    const [y, m] = period.split('-')
    return `${MONTH_NAMES[parseInt(m) - 1]} ${y.slice(2)}`
  }
  return period
}

function DashboardsTab({ toast }: { toast: ReturnType<typeof useToast> }) {
  const [granularity, setGranularity] = useState<Granularity>(() => {
    return (sessionStorage.getItem('adminDashboardGranularity') as Granularity) ?? 'daily'
  })
  const [selectedMonth, setSelectedMonth] = useState<string>('') // YYYY-MM (daily)
  const [selectedYear, setSelectedYear] = useState<string>('') // YYYY    (monthly)
  const [kpi, setKpi] = useState<RollupKPI | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const load = useCallback(async (gran: Granularity, month: string, yr: string) => {
    setLoading(true)
    try {
      setKpi(await getRollupKPI(gran, month || undefined, yr || undefined))
      setLastRefresh(new Date())
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load(granularity, selectedMonth, selectedYear)
    const id = setInterval(() => load(granularity, selectedMonth, selectedYear), 30000)
    return () => clearInterval(id)
  }, [load, granularity, selectedMonth, selectedYear])

  const switchGran = (g: Granularity) => {
    sessionStorage.setItem('adminDashboardGranularity', g)
    setGranularity(g)
    setSelectedMonth('')
    setSelectedYear('')
  }

  const activeFilter = selectedMonth || selectedYear
  const staysData = fillPeriodGaps(kpi?.stays_by_period ?? [], granularity, selectedMonth || undefined, selectedYear || undefined)
  const revenueData = fillPeriodGaps(kpi?.revenue_by_period ?? [], granularity, selectedMonth || undefined, selectedYear || undefined)

  const xInterval = calcXInterval(staysData.length)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 flex-wrap">
        {/* Title — left */}
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <div className="text-purple-400"><Calendar className="w-5 h-5" /></div>
          <h2 className="text-lg font-bold text-white">Dashboards</h2>
        </div>
        {/* Refresh — center */}
        <div className="flex items-center gap-2 justify-center">
          {lastRefresh && (
            <span className="text-slate-600 text-xs hidden sm:block">
              Act. {lastRefresh.toLocaleTimeString('es-AR')}
            </span>
          )}
          <button onClick={() => load(granularity, selectedMonth, selectedYear)} className="btn-ghost text-xs">
            <RefreshCw className="w-3.5 h-3.5" />
            Actualizar
          </button>
        </div>
        {/* Granularity + filter — right */}
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <div className="flex items-center gap-1 bg-slate-900/60 border border-slate-800 rounded-xl p-1">
            {(Object.keys(GRAN_LABELS) as Granularity[]).map((g) => (
              <button
                key={g}
                onClick={() => switchGran(g)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 ${granularity === g && !activeFilter
                  ? 'bg-purple-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
                  }`}
              >
                {GRAN_LABELS[g]}
              </button>
            ))}
          </div>
          {granularity === 'daily' && <MonthPicker value={selectedMonth} onChange={setSelectedMonth} />}
          {granularity === 'monthly' && <YearPicker value={selectedYear} onChange={setSelectedYear} />}
        </div>
      </div>

      {/* Period badge */}
      {kpi && (
        <div className="flex items-center gap-2 flex-wrap text-xs text-slate-500">
          <span className="px-2.5 py-1 bg-slate-800 border border-slate-700 rounded-full font-medium text-slate-400">
            {kpi.period_label}
          </span>
          {kpi.peak_period && (
            <span className="px-2.5 py-1 bg-purple-900/40 border border-purple-700/40 rounded-full text-purple-400">
              Pico: {formatPeriodLabel(kpi.peak_period, granularity)}
            </span>
          )}
          {activeFilter && granularity !== 'yearly' && (
            <button
              onClick={() => { setSelectedMonth(''); setSelectedYear('') }}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full font-medium text-amber-400 border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              {granularity === 'daily' ? 'Últimos 30 días' : 'Últimos 12 meses'}
            </button>
          )}
        </div>
      )}

      {loading ? <LoadingScreen /> : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard icon={<Car className="w-5 h-5" />} label="Total estadías" value={kpi?.total_stays ?? 0} color="blue" />
            <KpiCard icon={<Clock className="w-5 h-5" />} label="Duración promedio" value={formatDuration(kpi?.avg_duration_min ?? 0)} color="purple" />
            <KpiCard icon={<TrendingUp className="w-5 h-5" />} label="Ingresos totales" value={formatCurrency(kpi?.total_revenue ?? 0)} color="emerald" />
            <KpiCard icon={<CreditCard className="w-5 h-5" />} label="Ticket promedio" value={formatCurrency(kpi?.avg_ticket ?? 0)} color="amber" />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <ChartCard title={`Estadías por período (${activeFilter ? activeFilter : GRAN_LABELS[granularity].toLowerCase()})`}>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={staysData} barSize={granularity === 'yearly' ? 40 : 12}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
                  <XAxis
                    dataKey="label"
                    stroke={CHART_THEME.axis}
                    tick={{ fill: CHART_THEME.text, fontSize: 11 }}
                    interval={xInterval}
                  />
                  <YAxis stroke={CHART_THEME.axis} tick={{ fill: CHART_THEME.text, fontSize: 11 }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: CHART_THEME.tooltip.bg, border: `1px solid ${CHART_THEME.tooltip.border}`, borderRadius: 8, color: '#f1f5f9' }}
                    itemStyle={{ color: '#f1f5f9' }}
                    labelStyle={{ color: '#94a3b8' }}
                    labelFormatter={(l) => `Período: ${l}`}
                  />
                  <Bar dataKey="count" fill="#3b82f6" radius={[3, 3, 0, 0]} name="Estadías" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title={`Ingresos por período (${activeFilter ? activeFilter : GRAN_LABELS[granularity].toLowerCase()})`}>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={revenueData} barSize={granularity === 'yearly' ? 40 : 12}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
                  <XAxis
                    dataKey="label"
                    stroke={CHART_THEME.axis}
                    tick={{ fill: CHART_THEME.text, fontSize: 11 }}
                    interval={xInterval}
                  />
                  <YAxis
                    stroke={CHART_THEME.axis}
                    tick={{ fill: CHART_THEME.text, fontSize: 11 }}
                    tickFormatter={(v) => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: CHART_THEME.tooltip.bg, border: `1px solid ${CHART_THEME.tooltip.border}`, borderRadius: 8, color: '#f1f5f9' }}
                    itemStyle={{ color: '#f1f5f9' }}
                    labelStyle={{ color: '#94a3b8' }}
                    formatter={(v: number) => [formatCurrency(v), 'Ingresos']}
                    labelFormatter={(l) => `Período: ${l}`}
                  />
                  <Bar dataKey="amount" fill="#22c55e" radius={[3, 3, 0, 0]} name="Ingresos" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

        </>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
   Tab: Estadías (idéntico al panel de empleado)
───────────────────────────────────────────────────────────── */
function computeLiveAmount(entryAtStr: string, tariff: TariffInfo | null): number {
  if (!tariff) return 0
  try {
    const entryMs = new Date(entryAtStr).getTime()
    if (isNaN(entryMs)) return 0
    const durationMin = Math.max(0, (Date.now() - entryMs) / 60_000)
    if (durationMin <= tariff.grace_period_minutes) return 0
    const billableHours = (durationMin - tariff.grace_period_minutes) / 60
    const billableRounded = Math.ceil(billableHours * 4) / 4
    const amount = billableRounded * tariff.rate_per_hour
    return isNaN(amount) ? 0 : Math.max(amount, tariff.minimum_charge)
  } catch {
    return 0
  }
}

/* ─────────────────────────────────────────────────────────────
   Tab: Reportes Financieros
───────────────────────────────────────────────────────────── */
function ReportsTab({ toast }: { toast: ReturnType<typeof useToast> }) {
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [report, setReport] = useState<FinancialReportData | null>(null)
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const reportZoomRef = useRef<HTMLDivElement>(null)

  // Set default dates to last 30 days
  useEffect(() => {
    const today = new Date()
    const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)
    setFromDate(thirtyDaysAgo.toISOString().split('T')[0])
    setToDate(today.toISOString().split('T')[0])
  }, [])

  const generateReport = async () => {
    if (!fromDate || !toDate) {
      toast('error', 'Selecciona fechas válidas')
      return
    }
    if (new Date(fromDate) > new Date(toDate)) {
      toast('error', 'La fecha inicial debe ser menor que la final')
      return
    }
    setLoading(true)
    try {
      const data = await getFinancialReport(fromDate, toDate)
      setReport(data)
      setLastRefresh(new Date())
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const handleDownloadPDF = async () => {
    if (!report) return
    setDownloading(true)
    // Temporarily reset zoom so html2canvas captures at full resolution
    if (reportZoomRef.current) reportZoomRef.current.style.zoom = '1'
    await new Promise(r => setTimeout(r, 60))
    try {
      const element = document.querySelector('.financial-report-container') as HTMLElement
      if (!element) return
      const html2canvas = (await import('html2canvas')).default
      const { jsPDF } = await import('jspdf')
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
      })
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const pageW = pdf.internal.pageSize.getWidth()
      const pageH = pdf.internal.pageSize.getHeight()
      const margin = 8
      const ratio = Math.min((pageW - margin * 2) / canvas.width, (pageH - margin * 2) / canvas.height)
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin, margin, canvas.width * ratio, canvas.height * ratio)
      pdf.save(`Reporte-Financiero-${report.period.from}-${report.period.to}.pdf`)
    } catch {
      toast('error', 'Error al generar el PDF')
    } finally {
      if (reportZoomRef.current) reportZoomRef.current.style.zoom = '0.8'
      setDownloading(false)
    }
  }

  const handlePrint = () => {
    if (!report) return

    // Create a new window with just the report
    const printWindow = window.open('', '_blank', 'width=1200,height=800')
    if (!printWindow) return

    const reportHTML = document.querySelector('.financial-report-container')?.outerHTML || ''

    const html = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Reporte Financiero</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }

          html, body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: white;
            color: #0f172a;
            padding: 0;
            margin: 0;
          }

          .financial-report-container {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: white;
            color: #0f172a;
            padding: 22px;
            max-width: 1200px;
            margin: 0 auto;
          }
          .financial-report-container * { box-sizing: border-box; }
          .report-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; gap: 16px; }
          .report-brand { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
          .report-logo { width: 48px; height: 48px; border-radius: 10px; object-fit: contain; flex-shrink: 0; }
          .report-brand h2 { margin: 0; font-size: 28px; line-height: 1; color: #0b1f4d; font-weight: 800; }
          .report-brand span { font-size: 11px; color: #64748b; letter-spacing: 0.5px; margin: 0; }
          .report-title { text-align: center; flex: 1; }
          .report-title h1 { margin: 0 0 6px 0; font-size: 38px; color: #0b2d73; font-weight: 800; }
          .report-title p { margin: 0; color: #64748b; font-size: 13px; }
          .report-period { border: 1px solid #dbe3ef; padding: 13px; border-radius: 12px; min-width: 190px; flex-shrink: 0; }
          .report-period h3 { margin: 0 0 10px 0; color: #0b2d73; font-size: 14px; font-weight: 600; }
          .report-period p { display: flex; justify-content: space-between; margin: 0 0 6px 0; color: #334155; font-size: 12px; }
          .report-section-title { margin: 14px 0 12px 0; font-size: 16px; font-weight: 700; color: #0b2d73; }
          .report-cards { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 18px; }
          .report-card { background: white; border: 1px solid #dbe3ef; border-radius: 14px; padding: 15px; }
          .report-kpi { display: flex; flex-direction: column; gap: 9px; }
          .report-kpi span { font-size: 11px; color: #64748b; font-weight: 600; line-height: 1.4; margin: 0; }
          .report-kpi strong { margin: 0; font-size: 24px; color: #0b1f4d; }
          .report-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px; }
          .report-chart { height: 190px; background: linear-gradient(to top, #dbeafe 1px, transparent 1px); background-size: 100% 36px; border-radius: 10px; position: relative; overflow: hidden; }
          .report-chart-bars { position: absolute; bottom: 14px; left: 14px; right: 14px; height: 144px; display: flex; align-items: flex-end; gap: 8px; }
          .report-bar { flex: 1; background: #0b3b91; border-radius: 3px 3px 0 0; }
          .report-chart-labels { display: flex; padding: 0 14px; gap: 8px; margin-top: 5px; min-height: 12px; }
          .report-bar-label { flex: 1; min-width: 0; text-align: center; font-size: 8px; color: #475569; line-height: 1; overflow: hidden; white-space: nowrap; }
          .report-pie-wrapper { display: flex; align-items: center; justify-content: center; gap: 28px; padding: 10px 0; }
          .report-pie-svg { width: 190px; height: 190px; flex-shrink: 0; }
          .report-legend { display: flex; flex-direction: column; gap: 12px; }
          .report-legend-item { display: flex; align-items: center; gap: 8px; font-size: 13px; margin: 0; }
          .report-dot { width: 11px; height: 11px; border-radius: 50%; flex-shrink: 0; }
          .report-dot.blue-dark { background: #0b3b91; }
          .report-dot.blue-light { background: #2890ff; }
          .report-hours-table { margin-top: 12px; border: 1px solid #dbe3ef; border-radius: 10px; overflow: hidden; }
          .report-table { width: 100%; border-collapse: collapse; margin-top: 8px; }
          .report-table thead { background: #0b2d73; color: white; }
          .report-table th { padding: 9px 11px; text-align: left; font-size: 13px; font-weight: 600; margin: 0; }
          .report-table td { padding: 9px 11px; border-bottom: 1px solid #e2e8f0; font-size: 13px; margin: 0; }
          .report-table tbody tr:hover { background: #f8fafc; }
          .report-footer { margin-top: 16px; display: flex; justify-content: space-between; color: #64748b; font-size: 12px; }

          @page {
            size: A4;
            margin: 10mm;
          }

          @media print {
            * {
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }

            body, html {
              background: white;
              margin: 0;
              padding: 0;
            }

            .financial-report-container {
              padding: 0;
              background: white;
              box-shadow: none;
              border: none;
              border-radius: 0;
              max-width: 100%;
              margin: 0;
            }

            .report-header { margin-bottom: 12px; gap: 14px; }
            .report-brand { gap: 10px; }
            .report-logo { width: 38px; height: 38px; font-size: 20px; border-radius: 8px; }
            .report-brand h2 { font-size: 20px; }
            .report-brand span { font-size: 10px; }
            .report-title h1 { font-size: 28px; margin-bottom: 2px; }
            .report-title p { font-size: 11px; }
            .report-period { min-width: 150px; padding: 10px; }
            .report-period h3 { font-size: 12px; margin-bottom: 6px; }
            .report-period p { font-size: 11px; margin-bottom: 3px; }

            .report-section-title { font-size: 13px; margin: 8px 0 6px 0; }
            .report-cards { gap: 8px; margin-bottom: 10px; }
            .report-card { padding: 10px; }
            .report-kpi { gap: 5px; }
            .report-kpi span { font-size: 9px; }
            .report-kpi strong { font-size: 18px; }

            .report-grid { gap: 10px; margin-bottom: 10px; }
            .report-pie-wrapper { gap: 20px; padding: 6px 0; }
            .report-pie-svg { width: 140px; height: 140px; }
            .report-legend { gap: 8px; }
            .report-legend-item { font-size: 11px; }
            .report-dot { width: 9px; height: 9px; }

            .report-chart { height: 155px; background-size: 100% 35px; }
            .report-chart-bars { height: 115px; bottom: 14px; left: 10px; right: 10px; gap: 6px; }
            .report-chart-labels { padding: 0 10px; gap: 6px; margin-top: 3px; min-height: 10px; }
            .report-bar-label { font-size: 7px; }
            .report-hours-table { margin-top: 8px; }

            .report-table { margin-top: 6px; }
            .report-table th { padding: 6px 8px; font-size: 11px; }
            .report-table td { padding: 5px 8px; font-size: 11px; }

            .report-footer { margin-top: 10px; font-size: 10px; }
          }
        </style>
      </head>
      <body>
        ${reportHTML}
        <script>
          window.addEventListener('load', function() {
            setTimeout(function() {
              window.print();
            }, 500);
          });
        </script>
      </body>
      </html>
    `

    printWindow.document.write(html)
    printWindow.document.close()
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <div className="text-purple-400"><TrendingUp className="w-5 h-5" /></div>
        <h2 className="text-lg font-bold text-white">Reportes Financieros</h2>
      </div>

      {/* Filters */}
      <div className="card p-5 space-y-4">
        <p className="text-slate-500 text-sm font-medium">Selecciona el período del reporte</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-slate-500 mb-2 uppercase tracking-wider">Desde</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="input w-full"
              disabled={loading}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-2 uppercase tracking-wider">Hasta</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="input w-full"
              disabled={loading}
            />
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={generateReport} disabled={loading} className="btn-primary">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Generar Reporte
          </button>
          {report && (
            <>
              <button onClick={handlePrint} className="btn-ghost">
                <Printer className="w-4 h-4" />
                Imprimir
              </button>
              <button onClick={handleDownloadPDF} disabled={downloading} className="btn-ghost">
                {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                Descargar PDF
              </button>
            </>
          )}
        </div>
      </div>

      {/* Report modal */}
      <Modal
        isOpen={!!report}
        onClose={() => setReport(null)}
        title={`Reporte Financiero: ${report?.period.from} a ${report?.period.to}`}
        size="full"
      >
        {report && (
          <div className="p-6">
            <div className="flex gap-2 mb-4 sticky top-0 bg-white pb-4 border-b">
              <button onClick={handlePrint} className="btn-primary">
                <Printer className="w-4 h-4" />
                Imprimir
              </button>
              <button
                onClick={handleDownloadPDF}
                disabled={downloading}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                           bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300
                           disabled:opacity-50 transition-all"
              >
                {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                Descargar PDF
              </button>
            </div>
            <div ref={reportZoomRef} style={{ zoom: 0.8 }}>
              <FinancialReportPrint report={report} />
            </div>
          </div>
        )}
      </Modal>

      {!report && !loading && (
        <div className="card px-6 py-12 text-center text-slate-600">
          <Calendar className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>Selecciona un período y genera un reporte</p>
        </div>
      )}
    </div>
  )
}

function StaysTab({ toast }: { toast: ReturnType<typeof useToast> }) {
  const [stays, setStays] = useState<ActiveStay[]>([])
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

  const [tariff, setTariff] = useState<TariffInfo | null>(null)
  useEffect(() => {
    getEmployeeTariff().then(setTariff).catch(() => { })
  }, [])

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

  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const [query, setQuery] = useState('')
  const [searchLoading, setSearchLoading] = useState(false)
  const [lookupResult, setLookupResult] = useState<StayLookupResponse | null>(null)

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

  const clearSearch = () => { setQuery(''); setLookupResult(null) }

  const [cashModal, setCashModal] = useState<{ stayId: string; amount: number } | null>(null)
  const [paying, setPaying] = useState(false)
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

  return (
    <div className="space-y-6">
      <SectionHeader icon={<ClipboardList className="w-5 h-5" />} title="Estadías" />

      {/* Search bar */}
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
          {searchLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          Buscar
        </button>
      </div>

      {/* Lookup result */}
      {lookupResult && (
        <div className="card p-5 space-y-4 animate-slide-up border-purple-700/30 max-w-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Search className="w-4 h-4 text-purple-400" />
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
            {lookupResult.stay.notes && <InfoRow label="Notas" value={lookupResult.stay.notes} />}
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

      {/* Active stays list */}
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
              {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
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
                        <td className="td font-mono text-purple-400 font-semibold">
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

      {/* Notes modal */}
      {notesModal && (
        <StaysModal title="Observaciones" onClose={() => setNotesModal(null)}>
          <p className="text-slate-200 text-sm leading-relaxed whitespace-pre-wrap">{notesModal}</p>
          <div className="flex justify-end mt-5">
            <button onClick={() => setNotesModal(null)} className="btn-secondary">Cerrar</button>
          </div>
        </StaysModal>
      )}

      {/* Cash modal */}
      {cashModal && (
        <StaysModal title="Cobro en efectivo" onClose={() => setCashModal(null)}>
          <p className="text-slate-400 text-sm mb-1">Monto a cobrar</p>
          <p className="text-3xl font-bold text-white mb-6">{formatCurrency(cashModal.amount)}</p>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setCashModal(null)} className="btn-secondary">Cancelar</button>
            <button onClick={handleCash} disabled={paying} className="btn-success">
              {paying ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
              Cobrar
            </button>
          </div>
        </StaysModal>
      )}

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

function StaysModal({ title, onClose, children }: {
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

/* ─────────────────────────────────────────────────────────────
   Shared helpers
───────────────────────────────────────────────────────────── */
function LoadingScreen() {
  return (
    <div className="h-64 flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-slate-600" />
    </div>
  )
}

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-1">
      <div className="text-purple-400">{icon}</div>
      <h2 className="text-lg font-bold text-white">{title}</h2>
    </div>
  )
}

function AdminHeader({
  icon, title, lastRefresh, onRefresh,
}: {
  icon: React.ReactNode
  title: string
  lastRefresh: Date | null
  onRefresh: () => void
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        <div className="text-purple-400">{icon}</div>
        <h2 className="text-lg font-bold text-white">{title}</h2>
      </div>
      <div className="flex items-center gap-3">
        {lastRefresh && (
          <span className="text-slate-600 text-xs hidden sm:block">
            Act. {lastRefresh.toLocaleTimeString('es-AR')}
          </span>
        )}
        <button onClick={onRefresh} className="btn-ghost text-xs">
          <RefreshCw className="w-3.5 h-3.5" />
          Actualizar
        </button>
      </div>
    </div>
  )
}

type KpiColor = 'blue' | 'purple' | 'emerald' | 'amber' | 'red'

const KPI_COLORS: Record<KpiColor, { icon: string; value: string; bg: string; border: string }> = {
  blue: { icon: 'text-blue-400', value: 'text-blue-300', bg: 'bg-blue-600/10', border: 'border-blue-500/20' },
  purple: { icon: 'text-purple-400', value: 'text-purple-300', bg: 'bg-purple-600/10', border: 'border-purple-500/20' },
  emerald: { icon: 'text-emerald-400', value: 'text-emerald-300', bg: 'bg-emerald-600/10', border: 'border-emerald-500/20' },
  amber: { icon: 'text-amber-400', value: 'text-amber-300', bg: 'bg-amber-600/10', border: 'border-amber-500/20' },
  red: { icon: 'text-red-400', value: 'text-red-300', bg: 'bg-red-600/10', border: 'border-red-500/20' },
}

function KpiCard({
  icon, label, value, color,
}: {
  icon: React.ReactNode
  label: string
  value: string | number
  color: KpiColor
}) {
  const c = KPI_COLORS[color]
  return (
    <div className={`card p-5 flex flex-col gap-3 ${c.bg} ${c.border}`}>
      <div className={`w-9 h-9 rounded-xl bg-slate-900/50 flex items-center justify-center ${c.icon}`}>
        {icon}
      </div>
      <div>
        <p className={`text-2xl font-bold tracking-tight ${c.value}`}>{value}</p>
        <p className="text-[11px] text-slate-500 uppercase tracking-widest mt-0.5">{label}</p>
      </div>
    </div>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <p className="text-sm font-semibold text-slate-300 mb-4">{title}</p>
      {children}
    </div>
  )
}

function StatRow({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500 text-sm">{label}</span>
      <span className={`font-bold text-sm ${color}`}>{value}</span>
    </div>
  )
}

