import { Camera as CameraIcon, Loader2, Wifi, WifiOff } from 'lucide-react'
import { useParkingSSE } from '../hooks/useParkingSSE'
import { CameraFeed } from './CameraFeed'
import { ParkingMap, parkingMapAspect, MAP_TOOLBAR_H } from './ParkingMap'

const CAMERA_ASPECT = 16 / 9
const MEDIA_GAP     = 16   // px — gap-4 between camera and map
const CARD_PAD      = 26   // px — card p-3 (12 + 12) + 1px border on each side
// Vertical space taken by everything except the camera/map media on xl screens:
// page padding (lg:p-7 → 56) + header (28) + KPI row (60) + 2 × space-y-3 (24)
// + card padding/border (26) + toolbar row above the media (MAP_TOOLBAR_H + 8)
// + a small safety margin.
const CHROME_H = 56 + 28 + 60 + 24 + CARD_PAD + MAP_TOOLBAR_H + 8 + 12
const MIN_MEDIA_H = 240    // px — never shrink the media below this height

/**
 * Combined camera + live parking map panel, shared between the admin
 * "En vivo" tab and the employee panel (replaces its separate map/camera tabs).
 *
 * On xl screens camera and map sit side by side with the same height, so the
 * panel height grows with its width. The panel width is capped from the
 * viewport height so the whole section fits without scrolling.
 */
export function LiveMapCameraPanel() {
  const { state, status } = useParkingSSE()

  const free     = state?.free ?? 0
  const total    = state?.total ?? 0
  const occupied = total - free
  const pct      = total ? Math.round((occupied / total) * 100) : 0

  const mapAspect = parkingMapAspect(state?.spots ?? [])
  // width = media height × (sum of aspect ratios) + gap + card padding
  const maxWidth = `calc(max(${MIN_MEDIA_H}px, 100dvh - ${CHROME_H}px) * ${(CAMERA_ASPECT + mapAspect).toFixed(4)} + ${MEDIA_GAP + CARD_PAD}px)`

  return (
    <div
      className="space-y-3 mx-auto xl:max-w-[var(--live-max-w)]"
      style={{ '--live-max-w': maxWidth } as React.CSSProperties}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="text-blue-400"><CameraIcon className="w-5 h-5" /></div>
          <h2 className="text-lg font-bold text-white">En vivo</h2>
        </div>
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

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <LivePanelKpi label="Libres"    value={free}     color="text-emerald-400" />
        <LivePanelKpi label="Ocupados"  value={occupied} color="text-red-400"     />
        <LivePanelKpi label="Total"     value={total}    color="text-slate-200"   />
        <LivePanelKpi label="Ocupación" value={`${pct}%`} color={pct < 50 ? 'text-emerald-400' : pct < 80 ? 'text-amber-400' : 'text-red-400'} />
      </div>

      {/* Column widths proportional to each aspect ratio → camera and map share the same height */}
      <div
        className="card p-3 grid grid-cols-1 xl:[grid-template-columns:var(--live-cols)] gap-4 items-start"
        style={{
          '--live-cols': `minmax(0, ${CAMERA_ASPECT.toFixed(4)}fr) minmax(0, ${mapAspect.toFixed(4)}fr)`,
        } as React.CSSProperties}
      >
        {/* Camera */}
        <div>
          <div className="flex items-center mb-2" style={{ height: MAP_TOOLBAR_H }}>
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">Cámara</span>
          </div>
          <CameraFeed className="w-full" style={{ aspectRatio: '16/9' } as React.CSSProperties} />
        </div>

        {/* Map */}
        <div>
          {!state ? (
            <div className="h-64 flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-slate-600" />
            </div>
          ) : (
            <ParkingMap spots={state.spots} maxHeight={null} title="Mapa" className="w-full" />
          )}
        </div>
      </div>
    </div>
  )
}

function LivePanelKpi({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="card px-4 py-2">
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      <p className="text-[11px] text-slate-500 uppercase tracking-widest">{label}</p>
    </div>
  )
}
