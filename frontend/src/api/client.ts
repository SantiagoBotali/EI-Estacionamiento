export function getToken(): string | null {
  return localStorage.getItem('access_token')
}

export function setAuth(token: string, role: string, username: string) {
  localStorage.setItem('access_token', token)
  localStorage.setItem('user_role', role)
  localStorage.setItem('username', username)
}

export function clearAuth() {
  localStorage.removeItem('access_token')
  localStorage.removeItem('user_role')
  localStorage.removeItem('username')
}

export function getRole(): string | null {
  return localStorage.getItem('user_role')
}

export function getUsername(): string | null {
  return localStorage.getItem('username')
}

interface FetchOptions {
  method?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body?: any
  noAuth?: boolean
  isForm?: boolean
}

export async function apiFetch<T>(endpoint: string, opts: FetchOptions = {}): Promise<T> {
  const { method = 'GET', body, noAuth = false, isForm = false } = opts

  const headers: Record<string, string> = {}
  if (!isForm) headers['Content-Type'] = 'application/json'
  if (!noAuth) {
    const token = getToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
  }

  const init: RequestInit = { method, headers }
  if (body !== undefined) {
    init.body = isForm ? (body as BodyInit) : JSON.stringify(body)
  }

  const res = await fetch(endpoint, init)

  if (res.status === 401 && !noAuth) {
    clearAuth()
    window.location.replace('/react/employee/login')
    throw new Error('Unauthorized')
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error((err as { detail?: string }).detail ?? `HTTP ${res.status}`)
  }

  return res.json() as Promise<T>
}
