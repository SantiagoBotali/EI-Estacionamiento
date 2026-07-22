import { apiFetch } from './client'

export interface Ticket {
  id: string
  stay_id: string
  ticket_code: string
  barcode_value: string
  created_at: string
}

export interface Stay {
  id: string
  entry_at: string
  exit_at?: string
  status: string
  amount_expected?: number
  amount_paid?: number
  payment_method?: string
  notes?: string
  ticket?: Ticket
}

export interface ActiveStay extends Stay {
  amount_expected: number
  slot_vision_id?: number
}

export interface GenerateTodayResult {
  generated: number
  occupied_spots: number
  total_spots: number
  spot_ids: number[]
}

export interface TariffInfo {
  rate_per_hour: number
  minimum_charge: number
  grace_period_minutes: number
}

export interface StayCreateResponse {
  stay: Stay
  ticket: Ticket
  barcode_svg: string
  amount_expected?: number
}

export interface StayLookupResponse {
  stay: Stay
  ticket: Ticket
  amount_expected: number
}


export function createStay(notes?: string): Promise<StayCreateResponse> {
  return apiFetch('/api/employee/stays/create', { method: 'POST', body: { notes } })
}

export function lookupStay(query: string): Promise<StayLookupResponse> {
  return apiFetch('/api/employee/stays/lookup', { method: 'POST', body: { query } })
}

export function closeCash(stayId: string): Promise<Stay> {
  return apiFetch(`/api/employee/stays/${stayId}/close-cash`, { method: 'POST' })
}

export function getActiveStays(): Promise<ActiveStay[]> {
  return apiFetch('/api/employee/stays/active')
}

export function getEmployeeTariff(): Promise<TariffInfo> {
  return apiFetch('/api/employee/tariff')
}

export function generateTodayStays(): Promise<GenerateTodayResult> {
  return apiFetch('/api/employee/demo/generate-today', { method: 'POST' })
}


// ─── Cash Closing ─────────────────────────────────────────────────────────

export const EMPLOYEES = ['Joaquin Zubiri', 'Santiago Botali', 'Gino Fina'] as const

export interface CashClosingPreview {
  period_from: string
  period_to: string
  cash_amount: number
  digital_amount: number
  total_amount: number
  stay_count: number
}

export interface CashClosing {
  id: string
  employee_name: string
  period_from: string
  period_to: string
  cash_amount: number
  digital_amount: number
  total_amount: number
  stay_count: number
  actual_cash: number
  difference: number
  notes?: string
  closed_at: string
  closed_by_id?: number
}

export function getCashClosingPreview(): Promise<CashClosingPreview> {
  return apiFetch('/api/employee/cash-closings/preview')
}

export function createCashClosing(data: {
  employee_name: string
  actual_cash: number
  notes?: string
}): Promise<CashClosing> {
  return apiFetch('/api/employee/cash-closings', { method: 'POST', body: data })
}

export function listCashClosings(): Promise<CashClosing[]> {
  return apiFetch('/api/employee/cash-closings')
}
