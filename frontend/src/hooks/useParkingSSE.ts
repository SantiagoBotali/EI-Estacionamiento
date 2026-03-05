import { useEffect, useRef, useState } from 'react'
import type { ParkingState } from '../api/parking'

type SSEStatus = 'connecting' | 'connected' | 'error'

export function useParkingSSE() {
  const [state, setState] = useState<ParkingState | null>(null)
  const [status, setStatus] = useState<SSEStatus>('connecting')
  const esRef = useRef<EventSource | null>(null)
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let mounted = true

    const connect = () => {
      if (!mounted) return
      setStatus('connecting')

      const es = new EventSource('/api/public/parking/stream')
      esRef.current = es

      es.onmessage = (e) => {
        if (!mounted) return
        try {
          setState(JSON.parse(e.data) as ParkingState)
          setStatus('connected')
        } catch {
          // ignore parse error
        }
      }

      es.onerror = () => {
        if (!mounted) return
        setStatus('error')
        es.close()
        retryRef.current = setTimeout(connect, 3000)
      }
    }

    connect()

    return () => {
      mounted = false
      esRef.current?.close()
      if (retryRef.current) clearTimeout(retryRef.current)
    }
  }, [])

  return { state, status }
}
