import React, { useEffect, useState } from 'react'
import { getToken } from '../api/client'
import { WifiOff } from 'lucide-react'
import { cn } from '../lib/utils'

interface CameraFeedProps {
  className?: string
  style?: React.CSSProperties
}

export function CameraFeed({ className, style }: CameraFeedProps) {
  const [token, setToken] = useState<string | null>(null)
  const [errored, setErrored] = useState(false)

  useEffect(() => {
    setToken(getToken())
  }, [])

  if (!token) {
    return (
      <div style={style} className={cn('flex items-center justify-center bg-slate-900 rounded-xl', className)}>
        <div className="text-center text-slate-600 py-12">
          <WifiOff className="w-10 h-10 mx-auto mb-2 opacity-40" />
          <p className="text-sm">Sin autenticación</p>
        </div>
      </div>
    )
  }

  const url = `/api/camera/feed?token=${token}`

  return (
    <div style={style} className={cn('relative bg-slate-950 rounded-xl overflow-hidden', className)}>
      {!errored ? (
        <img
          src={url}
          alt="Feed de cámara en vivo"
          className="w-full h-full object-contain"
          onError={() => setErrored(true)}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center text-slate-600 py-12">
            <WifiOff className="w-10 h-10 mx-auto mb-2 opacity-40" />
            <p className="text-sm mb-3">Cámara no disponible</p>
            <button
              className="text-xs text-blue-400 hover:text-blue-300 underline"
              onClick={() => setErrored(false)}
            >
              Reintentar
            </button>
          </div>
        </div>
      )}

      {/* Live indicator */}
      {!errored && (
        <div className="absolute top-3 left-3 flex items-center gap-1.5
                        bg-black/60 backdrop-blur-sm px-2.5 py-1 rounded-full pointer-events-none">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-white text-xs font-semibold tracking-wide">EN VIVO</span>
        </div>
      )}
    </div>
  )
}
