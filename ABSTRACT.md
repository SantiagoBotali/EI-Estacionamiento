# Abstract

## Sistema de Estacionamiento Inteligente SDG+

### Resumen Ejecutivo

El presente proyecto desarrolla un **Sistema de Estacionamiento Inteligente (SDG+)** que integra visión artificial, gestión automatizada de estadías y cierre de caja para optimizar la operación de estacionamientos de pequeña a mediana capacidad. El sistema detecta en tiempo real el estado de ocupación de 14 espacios mediante un clasificador de máquina de soporte vectorial (SVC), calcula tarifas dinámicas con períodos de gracia, y proporciona paneles de control especializados para empleados y administradores.

### Problema

Los estacionamientos tradicionales enfrentan desafíos operacionales significativos: falta de visibilidad en tiempo real sobre la disponibilidad de espacios, procesos manuales de cobro propensos a errores, ausencia de auditoría financiera en cierres de turno y dificultad para extraer métricas operativas y financieras. Estas limitaciones generan ineficiencias en la experiencia del usuario y fricción en la gestión administrativa.

### Solución Propuesta

SDG+ implementa una arquitectura web monolítica que combina:

1. **Módulo de Visión Artificial**: Procesamiento de video en tiempo real (25 fps) mediante OpenCV y clasificación SVC (normalización: 15×15×3 BGR), permitiendo detectar ocupación de espacios sin intervención manual.

2. **Backend FastAPI**: Servidor HTTP asincrónico que expone API REST para ingreso de vehículos, cobro en efectivo, consulta de KPIs y reportes financieros. Autenticación mediante JWT con control de acceso basado en roles (RBAC: ADMIN, EMPLOYEE, PÚBLICO).

3. **Frontend React (SPA)**: Interfaz moderna desarrollada con Vite, TypeScript y Tailwind CSS. Proporciona paneles especializados con tabs para empleados (mapa, cámara, estadías, cierre de caja) y administradores (operaciones, finanzas, reportes, dashboards).

4. **Persistencia SQLite**: Base de datos local embebida con modelos ORM (SQLAlchemy 2.0) para usuarios, estadías, tickets, pagos y cierre de caja.

5. **Sistema de Tarifas Inteligente**: Cálculo automático de montos basado en duración (gracia 15 min, tarifa variable $1.200 ARS/hr, mínimo $300), almacenado en base de datos para auditoría.

6. **Cierre de Caja Automatizado**: Modelo contable con fondo fijo por turno (3 turnos/día, UTC-3), detección de sobres/faltantes y cálculo de remesa hacia caja fuerte.

### Comunicación en Tiempo Real

- **SSE (Server-Sent Events)**: Actualización del mapa público cada 1 segundo sin latencia.
- **MJPEG Stream**: Feed de cámara a 25 fps con autenticación JWT en query parameter.

### Stack Tecnológico

| Capa | Tecnología |
|------|-----------|
| **Backend** | FastAPI 0.115.0 + Uvicorn 0.30.6 |
| **ORM** | SQLAlchemy 2.0.35 |
| **BD** | SQLite 3 |
| **Auth** | python-jose + passlib[bcrypt] 4.0.1 |
| **Visión** | OpenCV 4.10.0 + scikit-learn 1.5.2 |
| **Frontend** | Vite + React 18 + TypeScript + Tailwind CSS |
| **ML** | SVC (kernel RBF, 675 features normalizados) |

### Características Principales

✓ **Detección automática de ocupación** en tiempo real (SVC + normalización RGB/255)  
✓ **Paneles especializados** por rol con experiencia de usuario diferenciada  
✓ **Auditoría financiera completa** de cobros y cierre de turnos  
✓ **Reportes dinámicos** con gráficos interactivos (Plotly.js, Chart.js)  
✓ **Modo demostración** separado de modo producción (flag `is_demo`)  
✓ **Datos históricos sintéticos** para demostración inmediata  
✓ **Operación completamente local** sin dependencias externas obligatorias  

### Garantías de Confiabilidad

- **Thread-Safety**: VisionAdapter con `threading.Lock()` para acceso concurrente a estado y frames.
- **Autenticación JWT**: Expiración en 8 horas, validación en cada endpoint protegido.
- **Validación Pydantic v2**: Schemas tipados con validaciones en capas HTTP y de negocio.
- **Aislamiento de transacciones**: `check_same_thread=False` en SQLite con sesiones SQLAlchemy por request.

### Resultados y Beneficios

1. **Visibilidad Operacional**: Administradores acceden en tiempo real a KPIs de ocupación, duración promedio, ingresos por hora y tasas de ocupación.

2. **Experiencia Mejorada**: Clientes consultan disponibilidad desde mapa público sin ingreso; empleados registran salidas sin cálculo manual de montos.

3. **Control Financiero**: Cierre de caja automatizado con detección de discrepancias entre cobros esperados y dinero contado, auditable por turno.

4. **Escalabilidad Potencial**: Stack modular permitiría migración a PostgreSQL o microservicios sin cambios significativos en lógica de negocio.

5. **Prototipado Rápido**: Seed histórico automático permite demostraciones realistas desde el primer arranque.

### Validación y Testing

- Flujos de negocio validados mediante tests de integración contra BD real.
- Detección de visión verificada con modelos entrenados en datasets controlados.
- UI testeada manualmente en navegadores (Chrome, Firefox) y dispositivos móviles.

### Conclusión

SDG+ demuestra la viabilidad de un sistema integral de estacionamiento inteligente construido con stack moderno (FastAPI, React, SQLAlchemy), integrando visión artificial con procesos administrativos para entregar una solución operacionalmente completa, segura y auditable. El sistema está listo para despliegue en estacionamientos de 14 espacios y puede ser adaptado a capacidades mayores.

---

**Palabras clave:** Estacionamiento inteligente · Visión artificial · SVC · FastAPI · React · Control de acceso basado en roles · Cierre de caja · Auditoría financiera

**Autor:** Santiago Botali  
**Fecha:** Mayo 2026  
**Institución:** Proyecto Final de Desarrollo de Software
