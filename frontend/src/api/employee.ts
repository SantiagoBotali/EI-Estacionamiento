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

export function simulatePayment(stayId: string): Promise<{ stay: Stay }> {
  return apiFetch(`/api/payments/simulate/${stayId}`, { method: 'POST' })
}


// ─── Cash Closing ─────────────────────────────────────────────────────────

export interface CashClosing {
  id: string
  date: string
  shift: 1 | 2 | 3
  initial_cash: number
  expected_cash: number
  actual_cash?: number
  difference?: number
  remesa?: number
  is_demo: boolean
  notes?: string
  status: 'OPEN' | 'CLOSED'
  created_at: string
  closed_at?: string
  closed_by_id?: number
}

export interface TodaySummary {
  date: string
  current_shift: 1 | 2 | 3
  closings: CashClosing[]
  total_expected: number
  total_actual?: number
  total_remesa?: number
  total_difference?: number
  open_closing?: CashClosing
  fondo_fijo: number
}

export function openCashClosing(shift: number, initial_cash: number): Promise<CashClosing> {
  return apiFetch('/api/employee/cash-closings', {
    method: 'POST',
    body: { shift, initial_cash, force_demo: false, is_demo: false },
  })
}

export function listCashClosings(date?: string): Promise<CashClosing[]> {
  const qs = date ? `?date=${date}` : ''
  return apiFetch(`/api/employee/cash-closings${qs}`)
}

export function closeCashClosing(
  id: string, actual_cash: number, notes?: string
): Promise<CashClosing> {
  return apiFetch(`/api/employee/cash-closings/${id}/close`, {
    method: 'PATCH',
    body: { actual_cash, notes },
  })
}

export function getTodaySummary(): Promise<TodaySummary> {
  return apiFetch('/api/employee/cash-closings/summary/today')
}

export function getSuggestedInitial(shift: number): Promise<{ suggested_initial_cash: number }> {
  return apiFetch(`/api/employee/cash-closings/${shift}/suggested-initial`)
}

export function openCashClosingWithForce(
  shift: number, initial_cash: number, force_demo: boolean = false, is_demo: boolean = false
): Promise<CashClosing> {
  return apiFetch('/api/employee/cash-closings', {
    method: 'POST',
    body: { shift, initial_cash, force_demo, is_demo },
  })
}

export function resetTodayClosings(): Promise<{ deleted: number; message: string }> {
  return apiFetch('/api/employee/cash-closings/reset-today', { method: 'DELETE' })
}

export function quickCloseDemoClosing(id: string): Promise<CashClosing> {
  return apiFetch(`/api/employee/cash-closings/${id}/quick-close`, { method: 'PATCH' })
}
