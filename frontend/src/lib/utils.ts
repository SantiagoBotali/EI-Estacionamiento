import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

export function formatDateTime(isoString: string): string {
  return new Date(isoString).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

export function getStatusBadge(status: string): string {
  const map: Record<string, string> = {
    ACTIVE: 'badge-green',
    PAYMENT_PENDING: 'badge-yellow',
    PAID: 'badge-blue',
    CLOSED: 'badge-slate',
    CANCELLED: 'badge-red',
  }
  return map[status] ?? 'badge-slate'
}

export function getStatusLabel(status: string): string {
  const map: Record<string, string> = {
    ACTIVE: 'Activa',
    PAYMENT_PENDING: 'Pago Pendiente',
    PAID: 'Pagada',
    CLOSED: 'Cerrada',
    CANCELLED: 'Cancelada',
  }
  return map[status] ?? status
}
