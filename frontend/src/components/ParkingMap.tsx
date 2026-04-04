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

const PAD = 16          // padding around content in SVG units
const CAR_SZ = 330
const SESSION_KEY = 'parkingMapMode'

type MapMode = 'original' | 'custom'

interface ParkingMapProps {
  spots: SpotState[]
  className?: string
  minHeight?: number  // kept for API compatibility
}

// ─────────────────────────────────────────────────────────────────────────────

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
    const contentW = maxX - minX
    const contentH = maxY - minY

    // Shift spots so they start at (PAD, PAD)
    const offsetX = Math.round(PAD - minX)
    const offsetY = Math.round(PAD - minY)

    // viewBox dimensions = content + 2×padding
    const vbW = contentW + PAD * 2
    const vbH = contentH + PAD * 2

    return { offsetX, offsetY, vbW, vbH }
  }, [spots])

  // ── Empty state ─────────────────────────────────────────────────────────────
  if (!spots.length || !layout) {
    return (
      <div
        className={cn('flex items-center justify-center rounded-xl', className)}
        style={{ background: '#222', aspectRatio: '4 / 3', maxWidth: 600, margin: '0 auto' }}
      >
        <p style={{ color: '#9ca3af', fontSize: 14 }}>Esperando datos del detector…</p>
      </div>
    )
  }

  const { offsetX, offsetY, vbW, vbH } = layout
  const isCustom = mode === 'custom'

  return (
    <div
      className={cn('mx-auto relative w-full animate-fade-in', className)}
      style={{ width: '100%', maxWidth: vbW }}
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
        viewBox={`0 0 ${vbW} ${vbH}`}
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
            width={vbW} height={vbH}
            preserveAspectRatio="xMidYMid slice"
          />
        ) : (
          <rect width={vbW} height={vbH} fill="#222" rx={12} />
        )}

        {/* ── Contornos de cocheras individuales (solo modo clásico) ── */}
        {!isCustom && spots.map((spot) => (
          <rect
            key={`outline-${spot.id}`}
            x={spot.x + offsetX}
            y={spot.y + offsetY}
            width={spot.w}
            height={spot.h}
            fill="rgba(255,255,255,0.05)"
            stroke="rgba(255,255,255,0.55)"
            strokeWidth={2}
            rx={4}
          />
        ))}

        {/* ── Dynamic overlays — always rendered ── */}
        {spots.map(spot => {
          if (spot.empty) return null

          const sx = spot.x + offsetX
          const sy = spot.y + offsetY
          const cx = sx + spot.w / 2
          const cy = sy + spot.h / 2

          // Orientar el auto según la forma del spot.
          // car.png tiene el auto con nariz hacia arriba (vertical = 0°).
          // portrait (h > w): auto vertical → 0° (nariz arriba) o 180° (nariz abajo)
          // landscape (w >= h): auto horizontal → -90° (nariz derecha) o 90° (nariz izquierda)
          const isPortrait = spot.h > spot.w
          let rot: number
          if (isPortrait) {
            // mitad superior del mapa → nariz apunta hacia abajo (180°); inferior → arriba (0°)
            rot = cy < vbH / 2 ? 180 : 0
          } else {
            // mitad izquierda → nariz apunta a la derecha (-90°); derecha → izquierda (90°)
            rot = cx < vbW / 2 ? -90 : 90
          }

          // Escalar igual que antes
          const sc = Math.min(spot.w / 200, spot.h / 200, 1)

          const label = String(spot.id)
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
