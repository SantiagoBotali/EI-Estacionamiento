/**
 * ParkingMap — rendering matches the Python/Jinja2 map at /
 *
 * Two modes (toggled via UI, persisted in sessionStorage):
 *  - 'original' : #222 background + white grid lines (classic rendering)
 *  - 'custom'   : map_test.png background, grid lines hidden
 *
 * Car images are always rendered on top; free spots get a soft pulsing green glow.
 * When a spot changes state the car drives in / out along the spot's axis,
 * from / towards the open (outer) side of its column, with a fade. The viewBox is cropped to the
 * spots' bounding box (+ VIEW_PAD) so the lot fills the available space.
 */
import { useState, useMemo, useId, useEffect } from 'react'
import { Layers } from 'lucide-react'
import type { SpotState } from '../api/parking'
import { cn } from '../lib/utils'

const MASK_W  = 450
const MASK_H  = 600
const EPS     = 8
const TARGET  = 200
const CAR_SZ  = 330
const LINE_W  = 3
const LINE_C  = 'rgba(255,255,255,0.96)'
const SESSION_KEY = 'parkingMapMode'
const VIEW_PAD = 14   // margin (SVG units) kept around the spots when cropping
const MAX_H    = 'calc(100dvh - 340px)'  // default max map height: fits below page chrome + toggle row
const MIN_H    = 420  // floor (px) so the map stays usable in small / resized windows
const ANIM_MS  = 700  // car enter / leave animation length
export const MAP_TOOLBAR_H = 26  // height (px) of the row above the map; mirror it to align siblings

type MapMode = 'original' | 'custom'

// Transition in progress for a spot: 'enter' = car arriving, 'leave' = car departing
interface Phase { kind: 'enter' | 'leave'; start: number }

// Keyframes for the car / glow transitions. --pm-dx is the per-car offset
// (SVG user units) towards the open side of the spot.
const ANIM_CSS = `
@keyframes pm-slide-in  { from { transform: translateX(var(--pm-dx)) } to { transform: translateX(0) } }
@keyframes pm-slide-out { from { transform: translateX(0) } to { transform: translateX(var(--pm-dx)) } }
@keyframes pm-fade-in   { from { opacity: 0 } to { opacity: 1 } }
@keyframes pm-fade-out  { from { opacity: 1 } to { opacity: 0 } }
.pm-car-enter {
  animation: pm-slide-in ${ANIM_MS}ms cubic-bezier(0.22, 1, 0.36, 1) both,
             pm-fade-in  ${Math.round(ANIM_MS * 0.6)}ms ease-out both;
}
.pm-car-leave {
  animation: pm-slide-out ${ANIM_MS}ms cubic-bezier(0.55, 0, 0.75, 0.2) both,
             pm-fade-out  ${ANIM_MS}ms cubic-bezier(0.4, 0, 1, 1) both;
}
.pm-glow-enter { animation: pm-fade-in  ${ANIM_MS}ms ease-out both; }
.pm-glow-leave { animation: pm-fade-out ${ANIM_MS}ms ease-in  both; }
@media (prefers-reduced-motion: reduce) {
  .pm-car-enter { animation: pm-fade-in  ${ANIM_MS}ms ease-out both; }
  .pm-car-leave { animation: pm-fade-out ${ANIM_MS}ms ease-in  both; }
}
`

interface ParkingMapProps {
  spots: SpotState[]
  className?: string
  minHeight?: number  // kept for API compatibility
  maxHeight?: string | null  // CSS length capping the rendered height (default MAX_H); null = fill width
  title?: string             // optional label shown left of the mode toggle
}

// ── Helpers (ported 1-to-1 from map.html) ────────────────────────────────────

function dedupeSorted(values: number[], eps = EPS): number[] {
  if (!values.length) return []
  const sorted = [...values].sort((a, b) => a - b)
  const out = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    if (Math.abs(sorted[i] - out[out.length - 1]) > eps) out.push(sorted[i])
  }
  return out
}

// Spots bounding box, centring offset and cropped viewBox (shared by the
// component and parkingMapAspect so both always agree)
function computeFrame(spots: SpotState[]) {
  const minX = Math.min(...spots.map(s => s.x))
  const maxX = Math.max(...spots.map(s => s.x + s.w))
  const minY = Math.min(...spots.map(s => s.y))
  const maxY = Math.max(...spots.map(s => s.y + s.h))

  const offsetX = Math.round((MASK_W - (maxX - minX)) / 2 - minX)
  const offsetY = Math.round((MASK_H - (maxY - minY)) / 2 - minY)

  // Cropped viewBox: bounding box of the spots plus a small margin
  const vbX = Math.max(0, minX + offsetX - VIEW_PAD)
  const vbY = Math.max(0, minY + offsetY - VIEW_PAD)
  const vbW = Math.min(MASK_W, maxX + offsetX + VIEW_PAD) - vbX
  const vbH = Math.min(MASK_H, maxY + offsetY + VIEW_PAD) - vbY

  return { minX, maxX, minY, maxY, offsetX, offsetY, vbX, vbY, vbW, vbH }
}

/** Width / height ratio of the rendered map (excluding the toolbar row). */
export function parkingMapAspect(spots: SpotState[]): number {
  if (!spots.length) return MASK_W / MASK_H
  const { vbW, vbH } = computeFrame(spots)
  return vbW / vbH
}

interface Row { cy: number; items: SpotState[] }

function clusterRows(spaces: SpotState[]): Row[] {
  const rows: Row[] = []
  const sorted = [...spaces].sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2))
  for (const s of sorted) {
    const cY = s.y + s.h / 2
    let row = rows.find(r => Math.abs(r.cy - cY) < Math.max(EPS, s.h * 0.5))
    if (!row) { row = { cy: cY, items: [] }; rows.push(row) }
    row.items.push(s)
    row.cy = row.items.reduce((acc, it) => acc + it.y + it.h / 2, 0) / row.items.length
  }
  return rows
}

// ─────────────────────────────────────────────────────────────────────────────

export function ParkingMap({ spots, className, maxHeight = MAX_H, title }: ParkingMapProps) {
  const glowId = `free-glow-${useId().replace(/:/g, '')}`
  const [mode, setMode] = useState<MapMode>(() => {
    try {
      return (sessionStorage.getItem(SESSION_KEY) as MapMode) ?? 'original'
    } catch {
      return 'original'
    }
  })

  // ── Enter / leave transitions ──────────────────────────────────────────────
  // Diff against the previous spots during render (not in an effect) so a
  // departing car is never unmounted for a frame before its leave animation.
  const [prevSpots, setPrevSpots] = useState(spots)
  const [phases, setPhases] = useState<Record<number, Phase>>({})

  if (spots !== prevSpots) {
    const wasEmpty = new Map(prevSpots.map(s => [s.id, s.empty]))
    const now = performance.now()
    let next: Record<number, Phase> | null = null
    for (const s of spots) {
      const was = wasEmpty.get(s.id)
      if (was === undefined || was === s.empty) continue
      next ??= { ...phases }
      next[s.id] = { kind: s.empty ? 'leave' : 'enter', start: now }
    }
    setPrevSpots(spots)
    if (next) setPhases(next)
  }

  // Drop finished transitions (a finished 'leave' also unmounts its car)
  useEffect(() => {
    const list = Object.values(phases)
    if (!list.length) return
    const firstEnd = Math.min(...list.map(p => p.start + ANIM_MS))
    const t = window.setTimeout(() => {
      const now = performance.now()
      setPhases(prev => {
        const out: Record<number, Phase> = {}
        for (const [id, p] of Object.entries(prev)) {
          if (p.start + ANIM_MS > now) out[Number(id)] = p
        }
        return out
      })
    }, Math.max(0, firstEnd - performance.now()) + 30)
    return () => window.clearTimeout(t)
  }, [phases])

  const toggleMode = () => {
    setMode(prev => {
      const next: MapMode = prev === 'original' ? 'custom' : 'original'
      try { sessionStorage.setItem(SESSION_KEY, next) } catch { /* ignore */ }
      return next
    })
  }

  const layout = useMemo(() => {
    if (!spots.length) return null

    const { minX, maxX, minY, maxY, offsetX, offsetY, vbX, vbY, vbW, vbH } = computeFrame(spots)

    // Horizontal lines at interior Y-boundaries
    const boundariesY = spots.flatMap(s => [s.y, s.y + s.h])
    const uniqY = dedupeSorted(boundariesY).filter(y => y > minY + EPS && y < maxY - EPS)
    const hLines = uniqY.map(y => ({
      x: minX + offsetX,
      y: y + offsetY,
      w: maxX - minX,
    }))

    // Vertical center-aisle line (median of row midpoints)
    const rows = clusterRows(spots)
    const mids: number[] = []
    for (const r of rows) {
      const ri = [...r.items].sort((a, b) => a.x - b.x)
      if (ri.length < 2) continue
      const half = Math.ceil(ri.length / 2)
      const lEdge = Math.max(...ri.slice(0, half).map(s => s.x + s.w))
      const rEdge = Math.min(...ri.slice(Math.floor(ri.length / 2)).map(s => s.x))
      mids.push((lEdge + rEdge) / 2)
    }
    let vLine: { x: number; y: number; h: number } | null = null
    if (mids.length) {
      mids.sort((a, b) => a - b)
      const midX = Math.round(mids[Math.floor(mids.length / 2)])
      vLine = { x: midX + offsetX, y: minY + offsetY, h: maxY - minY }
    }

    return { offsetX, offsetY, hLines, vLine, vbX, vbY, vbW, vbH }
  }, [spots])

  // ── Empty state ─────────────────────────────────────────────────────────────
  if (!spots.length || !layout) {
    return (
      <div
        className={cn('flex items-center justify-center rounded-xl', className)}
        style={{
          background: '#222',
          aspectRatio: `${MASK_W} / ${MASK_H}`,
          maxWidth: MASK_W,
          margin: '0 auto',
        }}
      >
        <p style={{ color: '#9ca3af', fontSize: 14 }}>Esperando datos del detector…</p>
      </div>
    )
  }

  const { offsetX, offsetY, hLines, vLine, vbX, vbY, vbW, vbH } = layout
  const isCustom = mode === 'custom'

  return (
    <div
      className={cn('mx-auto', className)}
      style={{
        width: '100%',
        maxWidth: maxHeight === null ? undefined : `calc(max(${MIN_H}px, ${maxHeight}) * ${(vbW / vbH).toFixed(4)})`,
      }}
    >
      {/* ── Mode toggle button (outside the map so it never covers a car) ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: title ? 'space-between' : 'flex-end', height: MAP_TOOLBAR_H, marginBottom: 8 }}>
        {title && (
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">{title}</span>
        )}
        <button
          onClick={toggleMode}
          title={isCustom ? 'Cambiar a vista clásica' : 'Cambiar a vista con imagen de fondo'}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            height: MAP_TOOLBAR_H,
            boxSizing: 'border-box',
            padding: '0 10px',
            borderRadius: 8,
            border: '1px solid rgba(148,163,184,0.2)',
            cursor: 'pointer',
            fontSize: 11,
            fontWeight: 700,
            fontFamily: 'Arial, sans-serif',
            letterSpacing: '0.04em',
            background: isCustom ? 'rgba(16,185,129,0.12)' : 'rgba(255,255,255,0.06)',
            color: isCustom ? '#d1fae5' : '#cbd5e1',
            transition: 'background 0.2s, color 0.2s',
          }}
        >
          <Layers size={13} />
          {isCustom ? 'IMAGEN' : 'CLÁSICO'}
        </button>
      </div>

      <style>{ANIM_CSS}</style>

      <div style={{ width: '100%', aspectRatio: `${vbW} / ${vbH}` }}>
        <svg
          viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
          style={{
            width: '100%',
            height: '100%',
            display: 'block',
            borderRadius: 12,
            boxShadow: '2px 2px 16px rgba(0,0,0,0.5)',
          }}
        >
          <defs>
            <radialGradient id={glowId}>
              <stop offset="0%"   stopColor="#4ade80" stopOpacity={1} />
              <stop offset="45%"  stopColor="#22c55e" stopOpacity={0.75} />
              <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
            </radialGradient>
          </defs>

          {/* ── Base layer ── */}
          {isCustom ? (
            <image
              href="/Media/map_test.png"
              x={0} y={0}
              width={MASK_W} height={MASK_H}
              preserveAspectRatio="xMidYMid slice"
            />
          ) : (
            <rect x={vbX} y={vbY} width={vbW} height={vbH} fill="#222" />
          )}

          {/* ── Grid lines — original mode only ── */}
          {!isCustom && hLines.map((l, i) => (
            <rect
              key={i}
              x={l.x} y={l.y - LINE_W / 2}
              width={l.w} height={LINE_W}
              rx={2} fill={LINE_C}
            />
          ))}
          {!isCustom && vLine && (
            <rect
              x={vLine.x - LINE_W / 2} y={vLine.y}
              width={LINE_W} height={vLine.h}
              rx={2} fill={LINE_C}
            />
          )}

          {/* ── Free-spot glow (cross-fades with the car during transitions) ── */}
          {spots.map(spot => {
            const phase = phases[spot.id]
            if (!spot.empty && phase?.kind !== 'enter') return null
            return (
              <g
                key={`glow-${spot.id}`}
                className={phase ? (phase.kind === 'enter' ? 'pm-glow-leave' : 'pm-glow-enter') : undefined}
              >
                <ellipse
                  cx={spot.x + offsetX + spot.w / 2} cy={spot.y + offsetY + spot.h / 2}
                  rx={spot.w * 0.42} ry={spot.h * 0.42}
                  fill={`url(#${glowId})`}
                >
                  <animate attributeName="opacity" values="0.3;1;0.3" dur="2.4s" repeatCount="indefinite" />
                </ellipse>
              </g>
            )
          })}

          {/* ── Cars (occupied spots + cars still driving out) ── */}
          {spots.map(spot => {
            const phase = phases[spot.id]
            if (spot.empty && phase?.kind !== 'leave') return null

            const sx  = spot.x + offsetX
            const sy  = spot.y + offsetY
            const cx  = sx + spot.w / 2
            const cy  = sy + spot.h / 2
            const isLeftCol = cx < MASK_W / 2
            const rot = isLeftCol ? -90 : 90
            const sc  = Math.min(spot.w / TARGET, spot.h / TARGET, 1)
            // Open side of the spot: outer edge of its column (columns share the centre divider)
            const dx  = (isLeftCol ? -1 : 1) * spot.w * 0.9

            return (
              <g
                key={`car-${spot.id}`}
                className={phase ? `pm-car-${phase.kind}` : undefined}
                style={{ '--pm-dx': `${dx}px` } as React.CSSProperties}
              >
                <g transform={`translate(${cx},${cy}) rotate(${rot}) scale(${sc})`}>
                  <image
                    href="/Media/car.png"
                    x={-CAR_SZ / 2} y={-CAR_SZ / 2}
                    width={CAR_SZ} height={CAR_SZ}
                    preserveAspectRatio="xMidYMid meet"
                  />
                </g>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
