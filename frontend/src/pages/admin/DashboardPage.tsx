import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Activity, BarChart2, Calendar, Camera, Car, ClipboardList, Clock, CreditCard,
  DollarSign, Loader2, LogOut, MapPin, Plus,
  RefreshCw, Search, Settings, ShieldCheck, Sparkles, TrendingUp, Users, Wifi, WifiOff, X, Zap,
} from 'lucide-react'
import {
  Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis, Legend, Line, LineChart,
} from 'recharts'
import { clearAuth, getRole, getUsername } from '../../api/client'
import {
  getOperationsKPI, getFinanceKPI, getTariffSettings, updateTariff, getRollupKPI,
  type FinanceKPI, type OperationsKPI, type TariffSettings, type RollupKPI,
} from '../../api/admin'
import {
  getActiveStays, lookupStay, closeCash, simulatePayment,
  getEmployeeTariff, generateTodayStays,
  type ActiveStay, type StayLookupResponse, type TariffInfo,
} from '../../api/employee'
import { getParkingState, type ParkingState } from '../../api/parking'
import { CameraFeed } from '../../components/CameraFeed'
import { ParkingMap } from '../../components/ParkingMap'
import { useParkingSSE } from '../../hooks/useParkingSSE'
import { useClock } from '../../hooks/useClock'
import { useToast } from '../../components/ui/Toast'
import { formatCurrency, formatDateTime, formatDuration, getStatusBadge, getStatusLabel } from '../../lib/utils'

type Tab = 'operations' | 'finance' | 'camera' | 'live' | 'dashboards' | 'stays'

const TABS: { id: Tab; icon: React.ReactNode; label: string }[] = [
  { id: 'operations', icon: <BarChart2 className="w-5 h-5" />, label: 'Operaciones' },
  { id: 'finance', icon: <DollarSign className="w-5 h-5" />, label: 'Finanzas' },
  { id: 'stays', icon: <ClipboardList className="w-5 h-5" />, label: 'Estadías' },
  { id: 'dashboards', icon: <Calendar className="w-5 h-5" />, label: 'Dashboards' },
  { id: 'camera', icon: <Camera className="w-5 h-5" />, label: 'Cámara' },
  { id: 'live', icon: <MapPin className="w-5 h-5" />, label: 'En vivo' },
]

const CHART_THEME = {
  grid: '#1e293b',
  axis: '#475569',
  text: '#94a3b8',
  tooltip: { bg: '#0f172a', border: '#334155' },
}

const METHOD_COLORS: Record<string, string> = {
  CASH: '#22c55e',
  SIMULATED: '#3b82f6',
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
            <div className="w-9 h-9 bg-gradient-to-br from-purple-500 to-purple-700
                            rounded-xl flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5 text-white" />
            </div>
            <div className="hidden lg:block overflow-hidden">
              <p className="font-bold text-white text-sm leading-none truncate">SDG+</p>
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
              <p className="text-slate-500 text-[10px]">{role}</p>
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
          {tab === 'operations' && <OperationsTab toast={toast} />}
          {tab === 'finance' && <FinanceTab toast={toast} />}
          {tab === 'stays' && <StaysTab toast={toast} />}
          {tab === 'dashboards' && <DashboardsTab toast={toast} />}
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
  const [newRate, setNewRate] = useState('')
  const [newMinimum, setNewMinimum] = useState('')
  const [rateError, setRateError] = useState('')
  const [minimumError, setMinimumError] = useState('')
  const [saving, setSaving] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
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

  const doSave = async (rate: number) => {
    setConfirmRate(null)
    setSaving(true)
    try {
      const parsedMin = newMinimum.trim() ? parseFloat(newMinimum.trim()) : undefined
      await updateTariff(rate, parsedMin)
      // Re-fetch to get the server's canonical values — prevents NaN from PUT response
      const updated = await getTariffSettings()
      setTariff(updated)
      setNewRate('')
      setNewMinimum('')
      setRateError('')
      setMinimumError('')
      toast('success', 'Tarifa actualizada')
    } catch (err) {
      toast('error', (err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const saveTariff = (e: FormEvent) => {
    e.preventDefault()
    const trimmed = newRate.trim()
    const minTrimmed = newMinimum.trim()
    const rate = trimmed ? parseFloat(trimmed) : undefined
    const minimum = minTrimmed ? parseFloat(minTrimmed) : undefined

    let hasError = false
    if (trimmed && (isNaN(rate!) || rate! <= 0)) {
      setRateError('Ingresá un valor numérico mayor a 0')
      hasError = true
    } else {
      setRateError('')
    }
    if (minTrimmed && (isNaN(minimum!) || minimum! <= 0)) {
      setMinimumError('Ingresá un valor numérico mayor a 0')
      hasError = true
    } else {
      setMinimumError('')
    }
    if (hasError) return
    if (!trimmed && !minTrimmed) {
      setRateError('Ingresá al menos un valor a actualizar')
      return
    }

    if (rate !== undefined && rate > HIGH_RATE_THRESHOLD) {
      setConfirmRate(rate)
      return
    }
    doSave(rate ?? tariff?.rate_per_hour ?? 0)
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
        <KpiCard
          icon={<Car className="w-5 h-5" />}
          label="Autos hoy"
          value={kpi?.autos_hoy ?? 0}
          color="blue"
        />
        <KpiCard
          icon={<Clock className="w-5 h-5" />}
          label="Duración promedio"
          value={formatDuration(kpi?.duracion_promedio_min ?? 0)}
          color="purple"
        />
        <KpiCard
          icon={<Zap className="w-5 h-5" />}
          label="Hora pico"
          value={kpi?.hora_pico ?? '—'}
          color="amber"
        />
        <KpiCard
          icon={<Activity className="w-5 h-5" />}
          label="Ocupación actual"
          value={`${Math.round(kpi?.tasa_ocupacion_pct ?? 0)}%`}
          color="emerald"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <ChartCard title="Ingreso de Autos por Hora (Hoy)">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={kpi?.autos_por_hora ?? []} barSize={10}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
              <XAxis
                dataKey="hour"
                stroke={CHART_THEME.axis}
                tick={{ fill: CHART_THEME.text, fontSize: 11 }}
                interval={3}
              />
              <YAxis stroke={CHART_THEME.axis} tick={{ fill: CHART_THEME.text, fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: CHART_THEME.tooltip.bg,
                  border: `1px solid ${CHART_THEME.tooltip.border}`,
                  borderRadius: 8,
                  color: '#f1f5f9',
                }}
              />
              <Bar dataKey="count" fill="#3b82f6" radius={[3, 3, 0, 0]} name="Autos" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Ingreso de Autos por Día (Últimos 7 Días)">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={kpi?.autos_por_dia ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
              <XAxis dataKey="date" stroke={CHART_THEME.axis} tick={{ fill: CHART_THEME.text, fontSize: 11 }} />
              <YAxis stroke={CHART_THEME.axis} tick={{ fill: CHART_THEME.text, fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: CHART_THEME.tooltip.bg,
                  border: `1px solid ${CHART_THEME.tooltip.border}`,
                  borderRadius: 8,
                  color: '#f1f5f9',
                }}
              />
              <Line
                type="monotone" dataKey="count" stroke="#818cf8"
                strokeWidth={2.5} dot={{ fill: '#818cf8', r: 4 }} name="Autos"
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Tariff config */}
      {tariff && (
        <div className="card p-5 space-y-4">
          <div className="flex items-center gap-2 text-slate-300 font-semibold">
            <Settings className="w-4 h-4 text-slate-500" />
            Configuración de tarifas
          </div>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-slate-500 text-xs uppercase tracking-wider mb-1">Tarifa / hora</p>
              <p className="text-white font-bold text-lg">{formatCurrency(tariff.rate_per_hour)}</p>
            </div>
            <div>
              <p className="text-slate-500 text-xs uppercase tracking-wider mb-1">Mínimo</p>
              <p className="text-white font-bold text-lg">{formatCurrency(tariff.minimum_charge)}</p>
            </div>
            <div>
              <p className="text-slate-500 text-xs uppercase tracking-wider mb-1">Período de gracia</p>
              <p className="text-white font-bold text-lg">{tariff.grace_period_minutes} min</p>
            </div>
          </div>
          <form onSubmit={saveTariff} className="flex flex-col gap-2 pt-1">
            <div className="flex flex-wrap gap-2">
              <div className="flex flex-col gap-1 max-w-xs w-full">
                <input
                  type="text"
                  inputMode="decimal"
                  value={newRate}
                  onChange={(e) => { setNewRate(e.target.value); setRateError('') }}
                  onBlur={() => {
                    const trimmed = newRate.trim()
                    if (trimmed && (isNaN(parseFloat(trimmed)) || parseFloat(trimmed) <= 0)) {
                      setRateError('Ingresá un valor numérico mayor a 0')
                    }
                  }}
                  placeholder="Nueva tarifa/hora (ARS)"
                  className={`input w-full ${rateError ? 'border-red-500/60 focus:border-red-500' : ''}`}
                  disabled={saving}
                />
                {rateError && (
                  <p className="text-red-400 text-xs">{rateError}</p>
                )}
              </div>
              <div className="flex flex-col gap-1 max-w-xs w-full">
                <input
                  type="text"
                  inputMode="decimal"
                  value={newMinimum}
                  onChange={(e) => { setNewMinimum(e.target.value); setMinimumError('') }}
                  onBlur={() => {
                    const trimmed = newMinimum.trim()
                    if (trimmed && (isNaN(parseFloat(trimmed)) || parseFloat(trimmed) <= 0)) {
                      setMinimumError('Ingresá un valor numérico mayor a 0')
                    }
                  }}
                  placeholder="Nuevo mínimo (ARS)"
                  className={`input w-full ${minimumError ? 'border-red-500/60 focus:border-red-500' : ''}`}
                  disabled={saving}
                />
                {minimumError && (
                  <p className="text-red-400 text-xs">{minimumError}</p>
                )}
              </div>
              <button type="submit" disabled={saving} className="btn-primary shrink-0 self-start">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Settings className="w-4 h-4" />}
                Actualizar
              </button>
            </div>
          </form>
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
              <button
                onClick={() => setConfirmRate(null)}
                className="btn-ghost text-sm"
              >
                Cancelar
              </button>
              <button
                onClick={() => doSave(confirmRate)}
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
   Tab: Finanzas
───────────────────────────────────────────────────────────── */
function FinanceTab({ toast }: { toast: ReturnType<typeof useToast> }) {
  const [kpi, setKpi] = useState<FinanceKPI | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const load = useCallback(async () => {
    try {
      setKpi(await getFinanceKPI())
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

  if (loading) return <LoadingScreen />

  const pieData = (kpi?.por_metodo ?? []).map((m) => ({
    name: m.method === 'CASH' ? 'Efectivo' : m.method === 'SIMULATED' ? 'Simulado' : 'MercadoPago',
    value: m.amount,
    color: METHOD_COLORS[m.method] ?? '#64748b',
  }))

  return (
    <div className="space-y-6">
      <AdminHeader
        icon={<DollarSign className="w-5 h-5" />}
        title="Finanzas"
        lastRefresh={lastRefresh}
        onRefresh={load}
      />

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard
          icon={<DollarSign className="w-5 h-5" />}
          label="Ingresos hoy"
          value={formatCurrency(kpi?.ingresos_hoy ?? 0)}
          color="emerald"
        />
        <KpiCard
          icon={<TrendingUp className="w-5 h-5" />}
          label="Ingresos del mes"
          value={formatCurrency(kpi?.ingresos_mes ?? 0)}
          color="blue"
        />
        <KpiCard
          icon={<CreditCard className="w-5 h-5" />}
          label="Ticket promedio"
          value={formatCurrency(kpi?.ticket_promedio ?? 0)}
          color="purple"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <ChartCard title="Ingresos por día (últimos 7 días)">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={kpi?.ingresos_por_dia ?? []} barSize={20}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
              <XAxis dataKey="date" stroke={CHART_THEME.axis} tick={{ fill: CHART_THEME.text, fontSize: 11 }} />
              <YAxis
                stroke={CHART_THEME.axis}
                tick={{ fill: CHART_THEME.text, fontSize: 11 }}
                tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: CHART_THEME.tooltip.bg,
                  border: `1px solid ${CHART_THEME.tooltip.border}`,
                  borderRadius: 8,
                  color: '#f1f5f9',
                }}
                formatter={(v: number) => [formatCurrency(v), 'Ingresos']}
              />
              <Bar dataKey="amount" fill="#22c55e" radius={[4, 4, 0, 0]} name="Ingresos" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Distribución por método de pago">
          {pieData.length === 0 ? (
            <div className="h-60 flex items-center justify-center text-slate-600 text-sm">
              Sin datos de pagos registrados
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={65}
                  outerRadius={100}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {pieData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} stroke="transparent" />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: CHART_THEME.tooltip.bg,
                    border: `1px solid ${CHART_THEME.tooltip.border}`,
                    borderRadius: 8,
                    color: '#f1f5f9',
                  }}
                  formatter={(v: number) => [formatCurrency(v)]}
                />
                <Legend
                  formatter={(v) => <span style={{ color: '#94a3b8', fontSize: 12 }}>{v}</span>}
                />
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

/** Fill gaps so every expected period bucket appears in the chart */
function fillPeriodGaps(
  raw: { period: string; count?: number; amount?: number }[],
  granularity: Granularity,
): { period: string; label: string; count: number; amount: number }[] {
  const map = new Map<string, { count: number; amount: number }>()
  for (const r of raw) {
    map.set(r.period, { count: r.count ?? 0, amount: r.amount ?? 0 })
  }

  const now = new Date()
  const result: { period: string; label: string; count: number; amount: number }[] = []

  if (granularity === 'daily') {
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
  const [kpi, setKpi] = useState<RollupKPI | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const load = useCallback(async (gran: Granularity) => {
    setLoading(true)
    try {
      setKpi(await getRollupKPI(gran))
      setLastRefresh(new Date())
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load(granularity)
    const id = setInterval(() => load(granularity), 30000)
    return () => clearInterval(id)
  }, [load, granularity])

  const switchGran = (g: Granularity) => {
    sessionStorage.setItem('adminDashboardGranularity', g)
    setGranularity(g)
  }

  const staysData = fillPeriodGaps(kpi?.stays_by_period ?? [], granularity)
  const revenueData = fillPeriodGaps(kpi?.revenue_by_period ?? [], granularity)

  const pieData = (kpi?.by_method ?? []).map((m) => ({
    name: m.method === 'CASH' ? 'Efectivo' : m.method === 'SIMULATED' ? 'Simulado' : 'MercadoPago',
    value: m.amount,
    color: METHOD_COLORS[m.method] ?? '#64748b',
  }))

  const xInterval = granularity === 'daily' ? 4 : 0

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 flex-wrap">
        {/* Title */}
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <div className="text-purple-400"><Calendar className="w-5 h-5" /></div>
          <h2 className="text-lg font-bold text-white">Dashboards Operacionales</h2>
        </div>
        {/* Refresh + granularity — same row, vertically centered */}
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <span className="text-slate-600 text-xs hidden sm:block">
              Act. {lastRefresh.toLocaleTimeString('es-AR')}
            </span>
          )}
          <button onClick={() => load(granularity)} className="btn-ghost text-xs">
            <RefreshCw className="w-3.5 h-3.5" />
            Actualizar
          </button>
          <div className="flex items-center gap-1 bg-slate-900/60 border border-slate-800 rounded-xl p-1">
            {(Object.keys(GRAN_LABELS) as Granularity[]).map((g) => (
              <button
                key={g}
                onClick={() => switchGran(g)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 ${granularity === g
                  ? 'bg-purple-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
                  }`}
              >
                {GRAN_LABELS[g]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Period badge */}
      {kpi && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="px-2.5 py-1 bg-slate-800 border border-slate-700 rounded-full font-medium text-slate-400">
            {kpi.period_label}
          </span>
          {kpi.peak_period && (
            <span className="px-2.5 py-1 bg-purple-900/40 border border-purple-700/40 rounded-full text-purple-400">
              Pico: {formatPeriodLabel(kpi.peak_period, granularity)}
            </span>
          )}
        </div>
      )}

      {loading ? <LoadingScreen /> : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              icon={<Car className="w-5 h-5" />}
              label="Total estadías"
              value={kpi?.total_stays ?? 0}
              color="blue"
            />
            <KpiCard
              icon={<Clock className="w-5 h-5" />}
              label="Duración promedio"
              value={formatDuration(kpi?.avg_duration_min ?? 0)}
              color="purple"
            />
            <KpiCard
              icon={<TrendingUp className="w-5 h-5" />}
              label="Ingresos totales"
              value={formatCurrency(kpi?.total_revenue ?? 0)}
              color="emerald"
            />
            <KpiCard
              icon={<CreditCard className="w-5 h-5" />}
              label="Ticket promedio"
              value={formatCurrency(kpi?.avg_ticket ?? 0)}
              color="amber"
            />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <ChartCard title={`Estadías por período (${GRAN_LABELS[granularity].toLowerCase()})`}>
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
                    contentStyle={{
                      backgroundColor: CHART_THEME.tooltip.bg,
                      border: `1px solid ${CHART_THEME.tooltip.border}`,
                      borderRadius: 8,
                      color: '#f1f5f9',
                    }}
                    labelFormatter={(l) => `Período: ${l}`}
                  />
                  <Bar dataKey="count" fill="#3b82f6" radius={[3, 3, 0, 0]} name="Estadías" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title={`Ingresos por período (${GRAN_LABELS[granularity].toLowerCase()})`}>
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
                    contentStyle={{
                      backgroundColor: CHART_THEME.tooltip.bg,
                      border: `1px solid ${CHART_THEME.tooltip.border}`,
                      borderRadius: 8,
                      color: '#f1f5f9',
                    }}
                    formatter={(v: number) => [formatCurrency(v), 'Ingresos']}
                    labelFormatter={(l) => `Período: ${l}`}
                  />
                  <Bar dataKey="amount" fill="#22c55e" radius={[3, 3, 0, 0]} name="Ingresos" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Payment method breakdown */}
          <ChartCard title="Distribución por método de pago (período)">
            {pieData.length === 0 ? (
              <div className="h-60 flex items-center justify-center text-slate-600 text-sm">
                Sin datos de pagos en el período
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%" cy="50%"
                    innerRadius={65} outerRadius={100}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} stroke="transparent" />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: CHART_THEME.tooltip.bg,
                      border: `1px solid ${CHART_THEME.tooltip.border}`,
                      borderRadius: 8,
                      color: '#f1f5f9',
                    }}
                    formatter={(v: number) => [formatCurrency(v)]}
                  />
                  <Legend formatter={(v) => <span style={{ color: '#94a3b8', fontSize: 12 }}>{v}</span>} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
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
    // entry_at is stored as naive ARS time; append the ARS offset so JS treats it correctly
    // regardless of the browser's local timezone.
    const arsStr = entryAtStr.includes('+') || entryAtStr.endsWith('Z') || entryAtStr.includes('-0')
      ? entryAtStr
      : entryAtStr + '-03:00'
    const entryMs = new Date(arsStr).getTime()
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

  const handleSimulate = async (stayId: string) => {
    setPaying(true)
    try {
      await simulatePayment(stayId)
      toast('success', 'Pago simulado aprobado')
      clearSearch()
      loadStays()
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setPaying(false)
    }
  }

  const openCashModal = (stayId: string, amount: number) => {
    setCashModal({ stayId, amount })
  }

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
            {lookupResult.stay.status === 'CLOSED' && (
              <InfoRow label="Monto cobrado" value={formatCurrency(lookupResult.stay.amount_paid ?? 0)} />
            )}
            {lookupResult.stay.notes && <InfoRow label="Notas" value={lookupResult.stay.notes} />}
          </div>
          {(lookupResult.stay.status === 'ACTIVE' || lookupResult.stay.status === 'PAYMENT_PENDING') && (
            <>
              <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl px-4 py-3">
                <p className="text-slate-500 text-xs uppercase tracking-widest mb-1">Monto estimado</p>
                <p className="text-2xl font-bold text-emerald-400 tabular-nums">{formatCurrency(lookupResult.amount_expected)}</p>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => openCashModal(lookupResult.stay.id, lookupResult.amount_expected)}
                  className="btn-success"
                  disabled={paying}
                >
                  <CreditCard className="w-4 h-4" />
                  Cobrar efectivo
                </button>
                <button
                  onClick={() => handleSimulate(lookupResult.stay.id)}
                  className="btn-primary"
                  disabled={paying}
                >
                  {paying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
                  Pago simulado
                </button>
              </div>
            </>
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
                            <button
                              onClick={() => handleSimulate(s.id)}
                              className="btn-primary py-1 px-2 text-xs"
                              disabled={paying}
                            >
                              <Activity className="w-3.5 h-3.5" />
                              Simular
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

      {/* Cash modal */}
      {cashModal && (
        <StaysModal title="Cobro en efectivo" onClose={() => setCashModal(null)}>
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl px-5 py-4 mb-5">
            <p className="text-slate-500 text-xs uppercase tracking-widest mb-1">Monto</p>
            <p className="text-4xl font-bold text-emerald-400 tabular-nums">{formatCurrency(cashModal.amount)}</p>
          </div>
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

