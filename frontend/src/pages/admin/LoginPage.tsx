import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Loader2, UserRound } from 'lucide-react'
import { login } from '../../api/auth'
import logoAdmin from '../../../logos/logoadmin.png'

export function AdminLoginPage() {
  const nav = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await login(username, password)
      if (res.role !== 'ADMIN') {
        setError('Acceso denegado. Se requiere rol de administrador.')
        return
      }
      nav('/admin/dashboard', { replace: true })
    } catch (err) {
      setError((err as Error).message || 'Credenciales inválidas')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-purple-950
                    flex items-center justify-center p-4">

      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-purple-600/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-indigo-800/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="bg-slate-900/80 backdrop-blur-md border border-slate-700/60
                        rounded-2xl shadow-2xl shadow-black/40 p-8">

          <div className="text-center mb-8">
            <div className="flex justify-center mb-4">
              <img src={logoAdmin} alt="Panel de Administración" className="h-20 w-auto object-contain" />
            </div>
            <h1 className="text-2xl font-bold text-white">Panel de Administración</h1>
            <p className="text-slate-500 text-sm mt-1.5">Acceso restringido a administradores</p>
          </div>

          {error && (
            <div className="mb-5 bg-red-950/60 border border-red-700/50 text-red-300
                            text-sm px-4 py-3 rounded-xl">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase
                               tracking-widest mb-2">
                Usuario
              </label>
              <div className="relative">
                <UserRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  required
                  className="input pl-10"
                  autoComplete="username"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase
                               tracking-widest mb-2">
                Contraseña
              </label>
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="input pr-10"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500
                             hover:text-slate-300 transition-colors"
                >
                  {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-purple-700
                         hover:bg-purple-600 text-white font-medium rounded-lg px-4 py-3
                         transition-all duration-150 disabled:opacity-40 active:scale-[0.97] mt-2"
            >
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Ingresando…</>
                : 'Iniciar sesión'}
            </button>
          </form>

          <div className="mt-6 flex items-center justify-between text-sm">
            <Link to="/" className="text-slate-500 hover:text-slate-300 transition-colors">
              ← Mapa público
            </Link>
            <Link to="/employee/login" className="text-slate-500 hover:text-slate-300 transition-colors">
              Panel Empleados →
            </Link>
          </div>
        </div>

        <p className="text-center text-slate-700 text-xs mt-4">
          Demo: <code className="text-slate-500">admin / admin123</code>
        </p>
      </div>
    </div>
  )
}
