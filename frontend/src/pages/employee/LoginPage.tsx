import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Loader2, ParkingCircle, UserRound } from 'lucide-react'
import { login } from '../../api/auth'

export function EmployeeLoginPage() {
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
      if (res.role !== 'EMPLOYEE' && res.role !== 'ADMIN') {
        setError('Acceso denegado. Se requiere rol de empleado.')
        return
      }
      nav('/employee/panel', { replace: true })
    } catch (err) {
      setError((err as Error).message || 'Credenciales inválidas')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950
                    flex items-center justify-center p-4">

      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-blue-600/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-blue-800/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Card */}
        <div className="bg-slate-900/80 backdrop-blur-md border border-slate-700/60
                        rounded-2xl shadow-2xl shadow-black/40 p-8">

          {/* Header */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-700 rounded-2xl
                            flex items-center justify-center mx-auto mb-4
                            shadow-lg shadow-blue-900/50">
              <ParkingCircle className="w-9 h-9 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white">Panel de Empleados</h1>
            <p className="text-slate-500 text-sm mt-1.5">Acceso exclusivo para personal autorizado</p>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-5 bg-red-950/60 border border-red-700/50 text-red-300
                            text-sm px-4 py-3 rounded-xl">
              {error}
            </div>
          )}

          {/* Form */}
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
                  placeholder="empleado"
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
              className="btn-primary w-full justify-center py-3 text-base mt-2"
            >
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Ingresando…</>
                : 'Iniciar sesión'}
            </button>
          </form>

          {/* Footer links */}
          <div className="mt-6 flex items-center justify-between text-sm">
            <Link to="/" className="text-slate-500 hover:text-slate-300 transition-colors">
              ← Mapa público
            </Link>
            <Link to="/admin/login" className="text-slate-500 hover:text-slate-300 transition-colors">
              Acceso Admin →
            </Link>
          </div>
        </div>

        {/* Hint */}
        <p className="text-center text-slate-700 text-xs mt-4">
          Demo: <code className="text-slate-500">empleado / emp123</code>
        </p>
      </div>
    </div>
  )
}
