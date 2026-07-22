import { FinancialReportData } from '../api/admin'
import { formatCurrency, formatDuration } from '../lib/utils'
import logoGeneral from '../../logos/logogeneral.png'

interface FinancialReportPrintProps {
  report: FinancialReportData
}

const PIE_COLORS = ['#0b3b91', '#2890ff', '#64748b']

function DonutChart({ data, size = 190 }: {
  data: Array<{ percentage: string }>
  size?: number
}) {
  const strokeWidth = Math.round(size * 0.26)
  const radius = (size - strokeWidth) / 2
  const cx = size / 2
  const cy = size / 2
  const circumference = 2 * Math.PI * radius
  let cumulativeAngle = -90

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="report-pie-svg"
      style={{ flexShrink: 0 }}
    >
      {data.map((item, i) => {
        const percent = Math.max(0, Math.min(1, parseFloat(item.percentage) / 100))
        const dash = percent * circumference
        const gap = circumference - dash
        const rotation = cumulativeAngle
        cumulativeAngle += percent * 360
        if (dash === 0) return null
        return (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={PIE_COLORS[i] ?? '#64748b'}
            strokeWidth={strokeWidth}
            strokeDasharray={`${dash} ${gap}`}
            strokeDashoffset={0}
            transform={`rotate(${rotation} ${cx} ${cy})`}
          />
        )
      })}
    </svg>
  )
}

export function FinancialReportPrint({ report }: FinancialReportPrintProps) {
  const totalRevenue = report.summary.total_revenue

  const formatDateHuman = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00Z')
    const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
    const dayName = days[date.getUTCDay()]
    const day = String(date.getUTCDate()).padStart(2, '0')
    const month = String(date.getUTCMonth() + 1).padStart(2, '0')
    const year = date.getUTCFullYear()
    return `${dayName} ${day}/${month}/${year}`
  }

  const pieData = report.by_method.map(m => ({
    method: m.method === 'CASH' ? 'Efectivo' : 'Mercado Pago',
    revenue: m.revenue,
    percentage: totalRevenue > 0 ? ((m.revenue / totalRevenue) * 100).toFixed(1) : '0',
  }))

  const maxRevenue = Math.max(...report.revenue_by_hour.map(h => h.revenue), 1)

  return (
    <>
      <style>{`
        .financial-report-container {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
          background: white !important;
          color: #0f172a !important;
          padding: 22px !important;
          max-width: 1200px !important;
        }

        .financial-report-container * {
          box-sizing: border-box !important;
        }

        .report-header {
          display: flex !important;
          justify-content: space-between !important;
          align-items: flex-start !important;
          margin-bottom: 20px !important;
          gap: 16px !important;
        }

        .report-brand {
          display: flex !important;
          align-items: center !important;
          gap: 12px !important;
          flex-shrink: 0 !important;
        }

        .report-logo {
          width: 48px !important;
          height: 48px !important;
          border-radius: 10px !important;
          object-fit: contain !important;
          flex-shrink: 0 !important;
        }

        .report-brand h2 {
          margin: 0 !important;
          font-size: 28px !important;
          line-height: 1 !important;
          color: #0b1f4d !important;
          font-weight: 800 !important;
        }

        .report-brand span {
          font-size: 11px !important;
          color: #64748b !important;
          letter-spacing: 0.5px !important;
          margin: 0 !important;
        }

        .report-title {
          text-align: center !important;
          flex: 1 !important;
        }

        .report-title h1 {
          margin: 0 0 6px 0 !important;
          font-size: 38px !important;
          color: #0b2d73 !important;
          font-weight: 800 !important;
        }

        .report-title p {
          margin: 0 !important;
          color: #64748b !important;
          font-size: 13px !important;
        }

        .report-period {
          border: 1px solid #dbe3ef !important;
          padding: 13px !important;
          border-radius: 12px !important;
          min-width: 190px !important;
          flex-shrink: 0 !important;
        }

        .report-period h3 {
          margin: 0 0 10px 0 !important;
          color: #0b2d73 !important;
          font-size: 14px !important;
          font-weight: 600 !important;
        }

        .report-period p {
          display: flex !important;
          justify-content: space-between !important;
          margin: 0 0 6px 0 !important;
          color: #334155 !important;
          font-size: 12px !important;
        }

        .report-section-title {
          margin: 14px 0 12px 0 !important;
          font-size: 16px !important;
          font-weight: 700 !important;
          color: #0b2d73 !important;
        }

        .report-cards {
          display: grid !important;
          grid-template-columns: repeat(5, 1fr) !important;
          gap: 12px !important;
          margin-bottom: 18px !important;
        }

        .report-card {
          background: white !important;
          border: 1px solid #dbe3ef !important;
          border-radius: 14px !important;
          padding: 15px !important;
        }

        .report-kpi {
          display: flex !important;
          flex-direction: column !important;
          gap: 9px !important;
        }

        .report-kpi span {
          font-size: 11px !important;
          color: #64748b !important;
          font-weight: 600 !important;
          line-height: 1.4 !important;
          margin: 0 !important;
        }

        .report-kpi strong {
          margin: 0 !important;
          font-size: 24px !important;
          color: #0b1f4d !important;
        }

        .report-grid {
          display: grid !important;
          grid-template-columns: 1fr 1fr !important;
          gap: 14px !important;
          margin-bottom: 14px !important;
        }

        .report-chart {
          height: 190px !important;
          background: linear-gradient(to top, #dbeafe 1px, transparent 1px) !important;
          background-size: 100% 36px !important;
          border-radius: 10px !important;
          position: relative !important;
          overflow: hidden !important;
        }

        .report-chart-bars {
          position: absolute !important;
          bottom: 14px !important;
          left: 14px !important;
          right: 14px !important;
          height: 144px !important;
          display: flex !important;
          align-items: flex-end !important;
          gap: 8px !important;
        }

        .report-bar {
          flex: 1 !important;
          background: #0b3b91 !important;
          border-radius: 3px 3px 0 0 !important;
        }

        .report-chart-labels {
          display: flex !important;
          padding: 0 14px !important;
          gap: 8px !important;
          margin-top: 5px !important;
          min-height: 12px !important;
        }

        .report-bar-label {
          flex: 1 !important;
          min-width: 0 !important;
          text-align: center !important;
          font-size: 8px !important;
          color: #475569 !important;
          line-height: 1 !important;
          overflow: hidden !important;
          white-space: nowrap !important;
        }

        .report-pie-wrapper {
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          gap: 28px !important;
          padding: 10px 0 !important;
        }

        .report-pie-svg {
          width: 190px !important;
          height: 190px !important;
          flex-shrink: 0 !important;
        }

        .report-legend {
          display: flex !important;
          flex-direction: column !important;
          gap: 12px !important;
        }

        .report-legend-item {
          display: flex !important;
          align-items: center !important;
          gap: 8px !important;
          font-size: 13px !important;
          margin: 0 !important;
        }

        .report-dot {
          width: 11px !important;
          height: 11px !important;
          border-radius: 50% !important;
          flex-shrink: 0 !important;
        }

        .report-dot.blue-dark  { background: #0b3b91 !important; }
        .report-dot.blue-light { background: #2890ff !important; }

        .report-hours-table {
          margin-top: 12px !important;
          border: 1px solid #dbe3ef !important;
          border-radius: 10px !important;
          overflow: hidden !important;
        }

        .report-table {
          width: 100% !important;
          border-collapse: collapse !important;
          margin-top: 8px !important;
        }

        .report-table thead {
          background: #0b2d73 !important;
          color: white !important;
        }

        .report-table th {
          padding: 9px 11px !important;
          text-align: left !important;
          font-size: 13px !important;
          font-weight: 600 !important;
          margin: 0 !important;
        }

        .report-table td {
          padding: 9px 11px !important;
          border-bottom: 1px solid #e2e8f0 !important;
          font-size: 13px !important;
          margin: 0 !important;
        }

        .report-table tbody tr:hover {
          background: #f8fafc !important;
        }

        .report-footer {
          margin-top: 16px !important;
          display: flex !important;
          justify-content: space-between !important;
          color: #64748b !important;
          font-size: 12px !important;
        }

        @page {
          size: A4;
          margin: 10mm;
        }

        @media print {
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          body, html {
            background: white !important;
            margin: 0 !important;
            padding: 0 !important;
          }

          .financial-report-container {
            padding: 0 !important;
            background: white !important;
            box-shadow: none !important;
            border: none !important;
            border-radius: 0 !important;
            max-width: 100% !important;
            margin: 0 !important;
          }

          .report-header { margin-bottom: 12px !important; gap: 14px !important; }
          .report-brand { gap: 10px !important; }
          .report-logo { width: 38px !important; height: 38px !important; border-radius: 8px !important; object-fit: contain !important; }
          .report-brand h2 { font-size: 20px !important; }
          .report-brand span { font-size: 10px !important; }
          .report-title h1 { font-size: 28px !important; margin-bottom: 2px !important; }
          .report-title p { font-size: 11px !important; }
          .report-period { min-width: 150px !important; padding: 10px !important; }
          .report-period h3 { font-size: 12px !important; margin-bottom: 6px !important; }
          .report-period p { font-size: 11px !important; margin-bottom: 3px !important; }

          .report-section-title { font-size: 13px !important; margin: 8px 0 6px 0 !important; }
          .report-cards { gap: 8px !important; margin-bottom: 10px !important; }
          .report-card { padding: 10px !important; }
          .report-kpi { gap: 5px !important; }
          .report-kpi span { font-size: 9px !important; }
          .report-kpi strong { font-size: 18px !important; }

          .report-grid { gap: 10px !important; margin-bottom: 10px !important; }
          .report-pie-wrapper { gap: 20px !important; padding: 6px 0 !important; }
          .report-pie-svg { width: 140px !important; height: 140px !important; }
          .report-legend { gap: 8px !important; }
          .report-legend-item { font-size: 11px !important; }
          .report-dot { width: 9px !important; height: 9px !important; }

          .report-chart { height: 155px !important; background-size: 100% 35px !important; }
          .report-chart-bars { height: 115px !important; bottom: 14px !important; left: 10px !important; right: 10px !important; gap: 6px !important; }
          .report-chart-labels { padding: 0 10px !important; gap: 6px !important; margin-top: 3px !important; min-height: 10px !important; }
          .report-bar-label { font-size: 7px !important; }
          .report-hours-table { margin-top: 8px !important; }

          .report-table { margin-top: 6px !important; }
          .report-table th { padding: 6px 8px !important; font-size: 11px !important; }
          .report-table td { padding: 5px 8px !important; font-size: 11px !important; }

          .report-footer { margin-top: 10px !important; font-size: 10px !important; }
        }
      `}</style>

      <div className="financial-report-container">
        {/* HEADER */}
        <div className="report-header">
          <div className="report-brand">
            <img src={logoGeneral} className="report-logo" alt="Logo" />
            <div>
              <h2>PARKING</h2>
              <span>SISTEMA DE ESTACIONAMIENTO</span>
            </div>
          </div>

          <div className="report-title">
            <h1>REPORTE FINANCIERO</h1>
            <p>Resumen de ingresos y actividad del estacionamiento</p>
          </div>

          <div className="report-period">
            <h3>PERÍODO DEL REPORTE</h3>
            <p>
              <span>Desde:</span>
              <strong>{report.period.from}</strong>
            </p>
            <p>
              <span>Hasta:</span>
              <strong>{report.period.to}</strong>
            </p>
          </div>
        </div>

        {/* KPI */}
        <div className="report-section-title">RESUMEN GENERAL</div>

        <div className="report-cards">
          <div className="report-card report-kpi">
            <span>INGRESOS COBRADOS EN EL RANGO</span>
            <strong>{formatCurrency(report.summary.total_revenue)}</strong>
          </div>

          <div className="report-card report-kpi">
            <span>CANTIDAD DE PAGOS APROBADOS</span>
            <strong>{report.summary.approved_payments}</strong>
          </div>

          <div className="report-card report-kpi">
            <span>TICKET PROMEDIO DEL RANGO</span>
            <strong>{formatCurrency(report.summary.avg_ticket)}</strong>
          </div>

          <div className="report-card report-kpi">
            <span>CANTIDAD DE ESTADÍAS COBRADAS</span>
            <strong>{report.summary.total_stays}</strong>
          </div>

          <div className="report-card report-kpi">
            <span>DURACIÓN PROMEDIO DE ESTADÍA</span>
            <strong>{formatDuration(report.summary.avg_duration_min)}</strong>
          </div>
        </div>

        {/* MAIN GRID */}
        <div className="report-grid">
          {/* PIE */}
          <div className="report-card">
            <div className="report-section-title">TOTAL POR MÉTODO DE PAGO</div>

            <div className="report-pie-wrapper">
              <DonutChart data={pieData} size={190} />

              <div className="report-legend">
                {pieData.map((item, i) => (
                  <div key={i} className="report-legend-item">
                    <div className={`report-dot ${i === 0 ? 'blue-dark' : 'blue-light'}`} />
                    {item.method} — {item.percentage}%
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* BAR CHART */}
          <div className="report-card">
            <div className="report-section-title">INGRESO POR HORA</div>

            <div className="report-chart">
              <div className="report-chart-bars">
                {report.revenue_by_hour.map((hour, i) => (
                  <div
                    key={i}
                    className="report-bar"
                    style={{
                      height: `${(hour.revenue / maxRevenue) * 100}%`
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="report-chart-labels">
              {report.revenue_by_hour.map((hour, i) => (
                <div key={i} className="report-bar-label">
                  {parseInt(hour.hour.split(':')[0])}h
                </div>
              ))}
            </div>

            <div className="report-hours-table">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>HORA</th>
                    <th>INGRESO</th>
                  </tr>
                </thead>

                <tbody>
                  {report.top_hours.slice(0, 3).map((h, i) => (
                    <tr key={i}>
                      <td>{h.hour}</td>
                      <td>{formatCurrency(h.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* TOP DAYS */}
        <div className="report-card" style={{ marginBottom: '14px' }}>
          <div className="report-section-title">TOP DÍAS CON MAYOR RECAUDACIÓN</div>

          <table className="report-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Fecha</th>
                <th>Ingreso</th>
                <th>Pagos aprobados</th>
                <th>Estadías cobradas</th>
                <th>Ticket promedio</th>
              </tr>
            </thead>

            <tbody>
              {report.top_days.slice(0, 2).map((d, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>{formatDateHuman(d.date)}</td>
                  <td>{formatCurrency(d.revenue)}</td>
                  <td>{d.payments}</td>
                  <td>{d.stays}</td>
                  <td>{formatCurrency(d.avg_ticket)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* DETAIL */}
        <div className="report-card">
          <div className="report-section-title">DETALLE POR MÉTODO DE PAGO</div>

          <table className="report-table">
            <thead>
              <tr>
                <th>Método</th>
                <th>Ingreso</th>
                <th>%</th>
                <th>Pagos</th>
                <th>Estadías</th>
                <th>Ticket Promedio</th>
              </tr>
            </thead>

            <tbody>
              {report.by_method.map((m, i) => {
                const pct = totalRevenue > 0 ? ((m.revenue / totalRevenue) * 100).toFixed(1) : '0'
                const staysCount = m.stays || m.count
                return (
                  <tr key={i}>
                    <td>{m.method === 'CASH' ? 'Efectivo' : 'Mercado Pago'}</td>
                    <td>{formatCurrency(m.revenue)}</td>
                    <td>{pct}%</td>
                    <td>{m.count}</td>
                    <td>{staysCount}</td>
                    <td>{formatCurrency(m.avg_ticket)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* FOOTER */}
        <div className="report-footer">
          <span>Reporte generado el: {new Date().toLocaleString('es-AR')}</span>
          <span>Página 1 de 1</span>
        </div>
      </div>
    </>
  )
}
