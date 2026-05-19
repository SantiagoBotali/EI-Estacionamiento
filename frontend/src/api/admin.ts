import { apiFetch } from './client'

export interface OperationsKPI {
  autos_hoy: number
  duracion_promedio_min: number
  hora_pico?: string
  tasa_ocupacion_pct: number
  autos_por_hora: { hour: string; count: number }[]
  autos_por_dia: { date: string; count: number }[]
}

export interface FinanceKPI {
  ingresos_hoy: number
  ingresos_mes: number
  ticket_promedio: number
  pendiente: number
  ingresos_por_dia: { date: string; amount: number }[]
  por_metodo: { method: string; amount: number }[]
}

export interface RollupKPI {
  granularity: string
  period_label: string
  total_stays: number
  avg_duration_min: number
  peak_period?: string
  total_revenue: number
  avg_ticket: number
  pending: number
  stays_by_period: { period: string; count: number }[]
  revenue_by_period: { period: string; amount: number }[]
  by_method: { method: string; amount: number }[]
}

export interface TariffSettings {
  rate_per_hour: number
  minimum_charge: number
  grace_period_minutes: number
}

export function getOperationsKPI(): Promise<OperationsKPI> {
  return apiFetch('/api/admin/kpis/operations')
}

export function getFinanceKPI(): Promise<FinanceKPI> {
  return apiFetch('/api/admin/kpis/finance')
}

export function getRollupKPI(granularity: 'daily' | 'monthly' | 'yearly', month?: string, year?: string): Promise<RollupKPI> {
  const params = new URLSearchParams({ granularity })
  if (month) params.set('month', month)
  if (year)  params.set('year', year)
  return apiFetch(`/api/admin/kpis/rollup?${params}`)
}

export function getTariffSettings(): Promise<TariffSettings> {
  return apiFetch('/api/admin/settings/tariff')
}

export function updateTariff(fields: Partial<TariffSettings>): Promise<void> {
  return apiFetch('/api/admin/settings/tariff', { method: 'PUT', body: fields })
}

export interface FinancialReportData {
  period: { from: string; to: string }
  summary: {
    total_revenue: number
    approved_payments: number
    avg_ticket: number
    total_stays: number
    avg_duration_min: number
  }
  by_method: {
    method: string
    revenue: number
    count: number
    avg_ticket: number
    stays?: number
  }[]
  revenue_by_hour: { hour: string; revenue: number }[]
  top_hours: { hour: string; revenue: number }[]
  top_days: {
    date: string
    revenue: number
    payments: number
    stays: number
    avg_ticket: number
  }[]
}

export function getFinancialReport(fromDate: string, toDate: string): Promise<FinancialReportData> {
  return apiFetch(`/api/admin/reports/financial?from_date=${fromDate}&to_date=${toDate}`)
}
