import { apiFetch } from './client'

export interface SpotState {
  id: number
  x: number
  y: number
  w: number
  h: number
  empty: boolean
}

export interface ParkingState {
  spots: SpotState[]
  free: number
  total: number
  occupancy_rate: number
  last_updated: string
}

export interface EntryResponse {
  ticket_code: string
  entry_at: string
  barcode_svg: string
}

export interface ExitLookupResponse {
  stay_id: string
  ticket_code: string
  entry_at: string
  status: string
  amount: number
}

export interface ExitPayResponse {
  stay_id: string
  amount_paid: number
  payment_method: string
  exit_at: string
}

export function getParkingState(): Promise<ParkingState> {
  return apiFetch<ParkingState>('/api/public/parking/state', { noAuth: true })
}

export function createPublicEntry(): Promise<EntryResponse> {
  return apiFetch<EntryResponse>('/api/public/entry', { method: 'POST', noAuth: true })
}

export function exitLookup(query: string): Promise<ExitLookupResponse> {
  return apiFetch<ExitLookupResponse>('/api/public/exit/lookup', {
    method: 'POST',
    body: { query },
    noAuth: true,
  })
}

export function exitPayCash(stay_id: string): Promise<ExitPayResponse> {
  return apiFetch<ExitPayResponse>('/api/public/exit/pay/cash', {
    method: 'POST',
    body: { stay_id },
    noAuth: true,
  })
}

export function exitPaySimulate(stay_id: string): Promise<ExitPayResponse> {
  return apiFetch<ExitPayResponse>('/api/public/exit/pay/simulate', {
    method: 'POST',
    body: { stay_id },
    noAuth: true,
  })
}

export interface MPPreferenceResponse {
  qr_data: string        // encode as QR → opens natively in MP app
  checkout_url: string   // browser fallback
  amount: number
  payment_id: string
}

export interface MPStatusResponse {
  status: 'approved' | 'pending' | 'rejected' | 'not_found'
  stay_id: string
  amount_paid?: number
  exit_at?: string
  mp_payment_id?: string
}

export function createMPPreference(stay_id: string): Promise<MPPreferenceResponse> {
  return apiFetch<MPPreferenceResponse>('/api/public/exit/mp/create', {
    method: 'POST',
    body: { stay_id },
    noAuth: true,
  })
}

export function checkMPPaymentStatus(stay_id: string): Promise<MPStatusResponse> {
  return apiFetch<MPStatusResponse>(`/api/public/exit/mp/status/${stay_id}`, {
    noAuth: true,
  })
}
