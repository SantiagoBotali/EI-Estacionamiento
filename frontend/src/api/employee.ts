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
