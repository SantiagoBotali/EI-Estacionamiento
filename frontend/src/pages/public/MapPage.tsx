import { Link } from 'react-router-dom'
import { Car, Loader2, Users, Wifi, WifiOff, Zap } from 'lucide-react'
import { useParkingSSE } from '../../hooks/useParkingSSE'
import { useClock } from '../../hooks/useClock'
import { ParkingMap } from '../../components/ParkingMap'
import logoGeneral from '../../../logos/logogeneral.png'

export function MapPage() {
  const { state, status } = useParkingSSE()
  const clock = useClock()

  const occupancyPct = state ? Math.round(state.occupancy_rate * 100) : 0
  const occupancyColor =
    occupancyPct < 50 ? 'text-emerald-400' :
    occupancyPct < 80 ? 'text-amber-400' :
    'text-red-400'

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">

      {/* ── Header ── */}
      <header className="sticky top-0 z-40 bg-slate-950/80 backdrop-blur-md border-b border-slate-800/80">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          {/* Brand */}
          <div className="flex items-center gap-3 shrink-0">
            <img src={logoGeneral} alt="Sistema de Estacionamiento" className="h-9 w-auto object-contain" />
            <div>
              <p className="font-bold text-white leading-none text-base">Sistema de estacionamiento</p>
              <p className="text-[11px] text-slate-500 leading-none mt-0.5">
                Sistema Inteligente de Gestión
              </p>
            </div>
          </div>

          {/* Clock + connection status */}
          <div className="flex items-center gap-4">
            <div className="hidden md:flex flex-col items-end leading-none gap-0.5">
              <span className="text-white font-bold text-base tabular-nums tracking-tight">
                {clock.time}
              </span>
              <span className="text-slate-500 text-[11px] tracking-wide">
                {clock.date}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              {status === 'connected'  && <Wifi     className="w-3.5 h-3.5 text-emerald-400" />}
              {status === 'connecting' && <Loader2  className="w-3.5 h-3.5 text-amber-400 animate-spin" />}
              {status === 'error'      && <WifiOff  className="w-3.5 h-3.5 text-red-400" />}
              <span className={`hidden sm:block font-medium
                ${status === 'connected'  ? 'text-emerald-400' : ''}
                ${status === 'connecting' ? 'text-amber-400'   : ''}
                ${status === 'error'      ? 'text-red-400'     : ''}
              `}>
                {status === 'connected'  ? 'En línea'      : ''}
                {status === 'connecting' ? 'Conectando…'   : ''}
                {status === 'error'      ? 'Sin conexión'  : ''}
              </span>
            </div>
          </div>

          {/* Nav links */}
          <nav className="flex items-center gap-1">
            <Link to="/kiosk"
                  className="text-slate-400 hover:text-white text-sm px-3 py-1.5
                             rounded-lg hover:bg-slate-800 transition-all">
              Ingreso
            </Link>
            <Link to="/exit"
                  className="text-slate-400 hover:text-white text-sm px-3 py-1.5
                             rounded-lg hover:bg-slate-800 transition-all">
              Salida
            </Link>
            <Link to="/employee/login"
                  className="text-slate-400 hover:text-white text-sm px-3 py-1.5
                             rounded-lg hover:bg-slate-800 transition-all">
              Empleados
            </Link>
            <Link to="/admin/login"
                  className="btn-primary text-xs py-2">
              Admin
            </Link>
          </nav>
        </div>
      </header>

      {/* ── Stats bar ── */}
      <div className="bg-gradient-to-r from-slate-900/90 via-slate-900 to-slate-900/90 border-b border-slate-800/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4">
          {state ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatPill
                icon={<span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />}
                value={state.free}
                label="Libres"
                valueColor="text-emerald-400"
              />
              <StatPill
                icon={<Car className="w-3.5 h-3.5 text-red-400" />}
                value={state.total - state.free}
                label="Ocupados"
                valueColor="text-red-400"
              />
              <StatPill
                icon={<Users className="w-3.5 h-3.5 text-slate-400" />}
                value={state.total}
                label="Total"
                valueColor="text-slate-200"
              />
              <StatPill
                icon={<Zap className="w-3.5 h-3.5 text-slate-400" />}
                value={`${occupancyPct}%`}
                label="Ocupación"
                valueColor={occupancyColor}
              />
            </div>
          ) : (
            <div className="h-14 flex items-center justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-slate-600" />
            </div>
          )}
        </div>
      </div>

      {/* ── Main content ── */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-8">
        {!state ? (
          <div className="text-center text-slate-600">
            <div className="w-16 h-16 rounded-2xl bg-slate-800/50 flex items-center justify-center mx-auto mb-4">
              <Loader2 className="w-8 h-8 animate-spin text-slate-500" />
            </div>
            <p className="text-sm">Cargando estado del estacionamiento…</p>
          </div>
        ) : (
          <div className="w-full max-w-4xl animate-fade-in">
            <ParkingMap spots={state.spots} minHeight={420} className="w-full shadow-2xl shadow-black/40" />
            <p className="text-center text-slate-700 text-xs mt-3 font-medium tracking-wide">
              ACTUALIZADO {new Date(state.last_updated).toLocaleTimeString('es-AR')}
            </p>
          </div>
        )}
      </main>
    </div>
  )
}

function StatPill({
  icon,
  value,
  label,
  valueColor,
}: {
  icon: React.ReactNode
  value: string | number
  label: string
  valueColor: string
}) {
  return (
    <div className="flex items-center gap-3 bg-slate-800/40 border border-slate-700/40
                    rounded-xl px-4 py-3">
      <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-slate-900/60">
        {icon}
      </div>
      <div>
        <p className={`text-xl font-bold leading-none ${valueColor}`}>{value}</p>
        <p className="text-[10px] text-slate-500 uppercase tracking-widest mt-0.5">{label}</p>
      </div>
    </div>
  )
}
