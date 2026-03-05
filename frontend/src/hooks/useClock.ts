import { useEffect, useState } from 'react'

export interface ClockValue {
  date: string   // "Mié 04 Mar 2026"
  time: string   // "14:32:15"
}

const DAY_NAMES   = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

function format(now: Date): ClockValue {
  const day   = DAY_NAMES[now.getDay()]
  const d     = String(now.getDate()).padStart(2, '0')
  const month = MONTH_NAMES[now.getMonth()]
  const year  = now.getFullYear()
  const hh    = String(now.getHours()).padStart(2, '0')
  const mm    = String(now.getMinutes()).padStart(2, '0')
  const ss    = String(now.getSeconds()).padStart(2, '0')
  return {
    date: `${day} ${d} ${month} ${year}`,
    time: `${hh}:${mm}:${ss}`,
  }
}

export function useClock(): ClockValue {
  const [clock, setClock] = useState<ClockValue>(() => format(new Date()))

  useEffect(() => {
    const tick = () => setClock(format(new Date()))
    // Align to the next whole second
    const delay = 1000 - (Date.now() % 1000)
    const timeout = setTimeout(() => {
      tick()
      const id = setInterval(tick, 1000)
      return () => clearInterval(id)
    }, delay)
    return () => clearTimeout(timeout)
  }, [])

  return clock
}
