import { apiFetch, setAuth } from './client'

export interface LoginResponse {
  access_token: string
  token_type: string
  role: string
  username: string
}

export async function login(username: string, password: string): Promise<LoginResponse> {
  const form = new URLSearchParams()
  form.append('username', username)
  form.append('password', password)

  const res = await apiFetch<LoginResponse>('/auth/token', {
    method: 'POST',
    body: form,
    noAuth: true,
    isForm: true,
  })

  setAuth(res.access_token, res.role, res.username)
  return res
}
