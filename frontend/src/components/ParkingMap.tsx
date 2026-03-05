/**
 * ParkingMap — rendering matches the Python/Jinja2 map at /
 *
 * Two modes (toggled via UI, persisted in sessionStorage):
 *  - 'original' : #222 background + white grid lines (classic rendering)
 *  - 'custom'   : map_test.png background, grid lines hidden
 *
 * Dynamic elements (car images, spot labels) are always rendered on top.
 */
import { useState, useMemo } from 'react'
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

type MapMode = 'original' | 'custom'

interface ParkingMapProps {
  spots: SpotState[]
  className?: string
  minHeight?: number  // kept for API compatibility
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

export function ParkingMap({ spots, className }: ParkingMapProps) {
  const [mode, setMode] = useState<MapMode>(() => {
    try {
      return (sessionStorage.getItem(SESSION_KEY) as MapMode) ?? 'original'
    } catch {
      return 'original'
    }
  })

  const toggleMode = () => {
    setMode(prev => {
      const next: MapMode = prev === 'original' ? 'custom' : 'original'
      try { sessionStorage.setItem(SESSION_KEY, next) } catch { /* ignore */ }
      return next
    })
  }

  const layout = useMemo(() => {
    if (!spots.length) return null

    const minX = Math.min(...spots.map(s => s.x))
    const maxX = Math.max(...spots.map(s => s.x + s.w))
    const minY = Math.min(...spots.map(s => s.y))
    const maxY = Math.max(...spots.map(s => s.y + s.h))

    const offsetX = Math.round((MASK_W - (maxX - minX)) / 2 - minX)
    const offsetY = Math.round((MASK_H - (maxY - minY)) / 2 - minY)

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

    return { offsetX, offsetY, hLines, vLine }
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

  const { offsetX, offsetY, hLines, vLine } = layout
  const isCustom = mode === 'custom'

  return (
    <div
      className={cn('mx-auto relative', className)}
      style={{ width: '100%', maxWidth: MASK_W, aspectRatio: `${MASK_W} / ${MASK_H}` }}
    >
      {/* ── Mode toggle button ── */}
      <button
        onClick={toggleMode}
        title={isCustom ? 'Cambiar a vista clásica' : 'Cambiar a vista con imagen de fondo'}
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 10px',
          borderRadius: 8,
          border: 'none',
          cursor: 'pointer',
          fontSize: 11,
          fontWeight: 700,
          fontFamily: 'Arial, sans-serif',
          letterSpacing: '0.04em',
          background: isCustom ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.12)',
          color: isCustom ? '#d1fae5' : '#cbd5e1',
          backdropFilter: 'blur(6px)',
          boxShadow: '0 1px 6px rgba(0,0,0,0.4)',
          transition: 'background 0.2s, color 0.2s',
        }}
      >
        <Layers size={13} />
        {isCustom ? 'IMAGEN' : 'CLÁSICO'}
      </button>

      <svg
        viewBox={`0 0 ${MASK_W} ${MASK_H}`}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          borderRadius: 12,
          boxShadow: '2px 2px 16px rgba(0,0,0,0.5)',
        }}
      >
        {/* ── Base layer ── */}
        {isCustom ? (
          <image
            href="/Media/map_test.png"
            x={0} y={0}
            width={MASK_W} height={MASK_H}
            preserveAspectRatio="xMidYMid slice"
          />
        ) : (
          <rect width={MASK_W} height={MASK_H} fill="#222" rx={12} />
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

        {/* ── Dynamic overlays — always rendered ── */}
        {spots.map(spot => {
          if (spot.empty) return null

          const sx  = spot.x + offsetX
          const sy  = spot.y + offsetY
          const cx  = sx + spot.w / 2
          const cy  = sy + spot.h / 2
          const rot = cx < MASK_W / 2 ? -90 : 90
          const sc  = Math.min(spot.w / TARGET, spot.h / TARGET, 1)

          const label  = String(spot.id)
          const labelW = label.length * 8 + 12
          const labelH = 16
          const labelX = sx + 4
          const labelY = sy + spot.h - 4 - labelH

          return (
            <g key={spot.id}>
              {/* Car image */}
              <g transform={`translate(${cx},${cy}) rotate(${rot}) scale(${sc})`}>
                <image
                  href="/Media/car.png"
                  x={-CAR_SZ / 2} y={-CAR_SZ / 2}
                  width={CAR_SZ} height={CAR_SZ}
                  preserveAspectRatio="xMidYMid meet"
                />
              </g>

              {/* Spot label */}
              <rect
                x={labelX} y={labelY}
                width={labelW} height={labelH}
                rx={4} fill="rgba(0,0,0,0.35)"
              />
              <text
                x={labelX + labelW / 2} y={labelY + labelH / 2}
                textAnchor="middle" dominantBaseline="central"
                fill="#ffffff" fontSize={12}
                fontFamily="Arial, sans-serif" fontWeight="700"
              >
                {label}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
