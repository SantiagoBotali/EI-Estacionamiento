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

export function getParkingState(): Promise<ParkingState> {
  return apiFetch<ParkingState>('/api/public/parking/state', { noAuth: true })
}

export function createPublicEntry(): Promise<EntryResponse> {
  return apiFetch<EntryResponse>('/api/public/entry', { method: 'POST', noAuth: true })
}
