import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ToastProvider } from './components/ui/Toast'
import { getRole, getToken } from './api/client'
import { MapPage } from './pages/public/MapPage'
import { KioskPage } from './pages/public/KioskPage'
import { ExitPage } from './pages/public/ExitPage'
import { EmployeeLoginPage } from './pages/employee/LoginPage'
import { EmployeePanelPage } from './pages/employee/PanelPage'
import { AdminLoginPage } from './pages/admin/LoginPage'
import { AdminDashboardPage } from './pages/admin/DashboardPage'

function ProtectedEmployee({ children }: { children: React.ReactNode }) {
  const token = getToken()
  const role = getRole()
  if (!token || (role !== 'EMPLOYEE' && role !== 'ADMIN')) {
    return <Navigate to="/employee/login" replace />
  }
  return <>{children}</>
}

function ProtectedAdmin({ children }: { children: React.ReactNode }) {
  const token = getToken()
  const role = getRole()
  if (!token || role !== 'ADMIN') {
    return <Navigate to="/admin/login" replace />
  }
  return <>{children}</>
}

export default function App() {
  return (
    <ToastProvider>
      <BrowserRouter basename="/react">
        <Routes>
          <Route path="/" element={<MapPage />} />
          <Route path="/kiosk" element={<KioskPage />} />
          <Route path="/exit" element={<ExitPage />} />
          <Route path="/employee/login" element={<EmployeeLoginPage />} />
          <Route
            path="/employee/panel"
            element={
              <ProtectedEmployee>
                <EmployeePanelPage />
              </ProtectedEmployee>
            }
          />
          <Route path="/admin/login" element={<AdminLoginPage />} />
          <Route
            path="/admin/dashboard"
            element={
              <ProtectedAdmin>
                <AdminDashboardPage />
              </ProtectedAdmin>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  )
}
