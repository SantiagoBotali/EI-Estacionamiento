# Guía de Integración MercadoPago — EI-Estacionamiento
**Fuente de verdad extraída del proyecto F5 (F5BE + F5FE)**
*Arquitecto de referencia: implementación de producción activa.*

---

## Índice

1. [Flujo Lógico del Pago (Ciclo de Vida)](#1-flujo-lógico-del-pago-ciclo-de-vida)
2. [Dependencias y Variables de Entorno](#2-dependencias-y-variables-de-entorno)
3. [Código Clave del Backend](#3-código-clave-del-backend)
4. [Código Clave del Frontend](#4-código-clave-del-frontend)
5. [Adaptación para EI-Estacionamiento](#5-adaptación-para-ei-estacionamiento)

---

## 1. Flujo Lógico del Pago (Ciclo de Vida)

El proyecto F5 usa el modelo **Checkout Pro** de MercadoPago (redirección a la página de MP).
No usa Bricks/SDK en el frontend. Toda la lógica de pago es **server-side first**.

### Diagrama general

```
Usuario hace clic en "Confirmar Reserva"
          │
          ▼
[FE] Llama a POST /turnos  (con fecha, hora, parrilla, buscandoRival)
          │
          ▼
[BE] Crea el registro en BD con estado = 'señado' e idMP = NULL
          │
          ▼
[BE] Llama a MercadoPago SDK → crea una Preference
     └─ Retorna { init_point, id } de la Preference
          │
          ▼
[BE] Guarda preference.init_point en el campo urlPreferenciaPago del turno
          │
          ▼
[BE] Devuelve el turno completo al frontend (incluye urlPreferenciaPago)
          │
          ▼
[FE] Abre window.open(response.urlPreferenciaPago, '_blank')
     └─ El usuario es enviado a la página de pago de MercadoPago
          │
          ▼
[MP] El usuario paga o rechaza
          │
    ┌─────┴────────────────────────────────────────┐
    │ Si APROBADO                                  │ Si RECHAZADO/PENDIENTE
    ▼                                              ▼
[MP] Llama al Webhook → POST /mercadopago/   [MP] Redirige a back_url failure
     webhook/:endPoint (con X-Signature)     [BE] El cron detecta idMP = NULL
          │                                       después de MP_TIME minutos
          ▼                                       y cancela el turno
[BE] Middleware valida firma HMAC-SHA256
          │
          ▼
[BE] Llama a MP SDK → GET payment/{id}
     └─ Verifica payment.status === 'approved'
          │
          ▼
[BE] Extrae payment.external_reference (= turno.id)
     y payment.id (= el ID numérico del pago en MP)
          │
          ▼
[BE] UPDATE Turnos SET idMP = <payment.id>
     WHERE id = UUID_TO_BIN(<turno.id>)
     └─ Con idMP ≠ NULL, el turno queda "señado y pagado"
          │
          ▼
[MP] Redirige al usuario a back_url success
     (https://.../#/mis-turnos/<turno.id>)
```

### Estados del registro en BD

| Estado en BD    | idMP      | Significado en el negocio                |
| --------------- | --------- | ---------------------------------------- |
| `señado`        | `NULL`    | Creado, pendiente de pago (≤ MP_TIME min)|
| `señado`        | `<valor>` | Pago aprobado — reserva confirmada       |
| `cancelado`     | `NULL`    | Cancelado (por cron o por el usuario)    |
| `finalizado`    | `<valor>` | Turno ya jugado (actualizado manualmente)|

### Mecanismo anti-abandono (Cron Job)

Un cron corre cada 5 minutos y cancela todos los turnos `señado` con `idMP IS NULL` que tengan más de `MP_TIME` minutos desde su `fechaCreacion`.
Esto garantiza que turnos "zombi" (usuario abandona el pago en MP) liberen el espacio.

```
*/5 * * * *  →  cancelTurno()
  UPDATE Turnos SET estado = 'cancelado'
  WHERE idMP IS NULL
    AND TIMESTAMPDIFF(MINUTE, fechaCreacion, NOW()) >= MP_TIME
```

---

## 2. Dependencias y Variables de Entorno

### 2.1 Backend (Node.js / Express)

**Librería SDK:** `mercadopago` versión `^2.0.9`

```json
// package.json (dependencias relevantes)
{
  "dependencies": {
    "mercadopago": "^2.0.9",
    "dotenv": "^16.4.7",
    "express": "^4.21.2",
    "node-cron": "^3.0.3"
  }
}
```

**Instalación:**
```bash
npm install mercadopago@^2.0.9 dotenv node-cron
```

### 2.2 Frontend (Angular — en F5; React en EI-Estacionamiento)

**No hay librería de MercadoPago instalada en el frontend.**
La integración es 100% via `window.open(url)` con la URL de la preferencia devuelta por el backend.

### 2.3 Variables de Entorno del Backend (`.env`)

```env
# === MERCADOPAGO ===

# Access Token de PRODUCCIÓN (se obtiene en https://www.mercadopago.com.ar/developers/panel)
MP_ACCESS_TOKEN=APP_USR-xxxxxxxxxxxxxxxxxxxx

# Clave secreta del Webhook (se genera en la configuración de Webhooks del panel de MP)
# Se usa para validar la firma HMAC-SHA256 de cada notificación entrante
MP_WEBHOOK_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# URL pública del backend que MP usará para enviar las notificaciones
# DEBE ser HTTPS y accesible desde internet (usar ngrok en desarrollo)
# El backend agrega "/<endPoint>" al final → ej: .../mercadopago/webhook/turno
MP_URL_BACKEND=https://tu-backend.com/mercadopago/webhook

# URL a la que MP redirige al usuario al APROBAR el pago
# El backend agrega "/<idReferencia>" al final
MP_URL_FRONTEND_SUCCESS=https://tu-frontend.com/#/mis-turnos

# URL a la que MP redirige al usuario si el pago FALLA o está PENDIENTE
MP_URL_FRONTEND_FAILURE=https://tu-frontend.com/#/inicio

# Tiempo en minutos antes de que el cron cancele un turno sin pago (default: 30)
MP_TIME=30

# Controla si los crons se inician al arrancar el servidor
START_CRONS=true
```

> **IMPORTANTE:** La `MP_URL_BACKEND` debe ser pública y HTTPS. En desarrollo local, usa **ngrok** o similar para exponer el puerto.
> En la consola de MercadoPago → Webhooks, registra la URL completa con el path del endpoint.

---

## 3. Código Clave del Backend

### 3.1 Configuración del Cliente MP y Creación de Preferencia

**Archivo:** `controllers/extras/mercadoPago.js`

```javascript
import {
  Preference,
  MercadoPagoConfig,
  Payment,
  PaymentRefund,
} from 'mercadopago';
import 'dotenv/config';
import { updateIdMP, updateIdMPCompartido } from '../../models/turno.js';
import { updateIdMP as updateIdMPET } from '../../models/equipoTorneo.js';

// Inicialización del cliente (una sola instancia, reutilizable)
const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
  options: { timeout: 5000 },
});

export class mercadoPagoController {
  /**
   * Crea una Preference de pago en MercadoPago.
   *
   * @param {string} title         - Descripción visible en la pantalla de MP
   * @param {number} precio        - Precio en pesos ARS (entero)
   * @param {string} idReferencia  - ID del registro en BD (actúa como external_reference)
   * @param {string} endPoint      - Sufijo que identifica el tipo de entidad
   *                                 ('turno' | 'turno-compartido' | 'equipo-torneo')
   * @returns {Object}             - Objeto Preference de MercadoPago
   *                                 (lo importante: .init_point para redirigir)
   */
  static async createPreference({ title, precio, idReferencia, endPoint = '' }) {
    try {
      const now = new Date();
      const twentyMinutesLater = new Date(now.getTime() + 20 * 60 * 1000);

      const items = [
        {
          id: idReferencia,
          title,
          quantity: 1,
          unit_price: precio,
          currency_id: 'ARS',
        },
      ];

      const body = {
        items,
        back_urls: {
          // Al aprobar: redirige a /mis-turnos/<idReferencia>
          success: process.env.MP_URL_FRONTEND_SUCCESS + '/' + idReferencia,
          // Al fallar o estar pendiente: redirige a inicio
          failure: process.env.MP_URL_FRONTEND_FAILURE,
          pending: process.env.MP_URL_FRONTEND_FAILURE,
        },
        // URL donde MP enviará la notificación Webhook
        notification_url: process.env.MP_URL_BACKEND + '/' + endPoint,
        auto_return: 'approved',          // Redirige automáticamente al success
        purpose: 'wallet_purchase',       // Requiere cuenta MP del comprador
        statement_descriptor: 'RODO',    // Nombre visible en el resumen del banco
        binary_mode: true,                // Solo aprobado o rechazado (no pendiente)
        expires: true,                    // Habilitar expiración de la preferencia
        expiration_date_from: now.toISOString(),
        expiration_date_to: twentyMinutesLater.toISOString(),
        date_of_expiration: twentyMinutesLater.toISOString(),
        external_reference: idReferencia, // Clave para identificar el pago en el Webhook
      };

      const preference = new Preference(client);
      return await preference.create({ body });
    } catch (error) {
      throw new Error('Ha ocurrido un error al contactar con MercadoPago');
    }
  }

  /**
   * Realiza un reembolso total de un pago.
   * Usado cuando el usuario cancela un turno ya pagado.
   *
   * @param {string} paymentId - El ID numérico del pago en MP (campo idMP en BD)
   * @returns {number}         - 200 si OK, 400 si ya se reembolsó, otro si error
   */
  static async totalRefund({ paymentId }) {
    try {
      const refund = new PaymentRefund(client);
      await refund.create({ payment_id: paymentId });
      return 200;
    } catch (error) {
      return error.status; // 400 = ya reembolsado
    }
  }

  /**
   * Endpoint Webhook — recibe notificaciones de MercadoPago.
   * PROTEGIDO por el middleware authMercadoPagoWebhook (validación HMAC).
   */
  static async webhookPayment(req, res) {
    try {
      const { body } = req;
      const { endPoint } = req.params;

      // body.data.id = 123456; // ← Descomentar para testing sin firma real

      if (body.type === 'payment' && body.data.id != 123456) {
        // Consultar el pago completo a la API de MP para obtener su estado real
        const payment = await new Payment(client).get({ id: body.data.id });

        if (payment.status === 'approved') {
          const datos = {
            id: payment.external_reference, // = el ID del registro en BD
            idMP: payment.id,               // = el ID numérico del pago en MP
          };

          // Enrutar según el tipo de entidad
          if (endPoint === 'turno') {
            await updateIdMP(datos);
          } else if (endPoint === 'turno-compartido') {
            datos.id = datos.id.replace('-compartido', '');
            await updateIdMPCompartido(datos);
          } else if (endPoint === 'equipo-torneo') {
            datos.id = datos.id.split('-')[0]; // "123-E5T2" → "123"
            await updateIdMPET(datos);
          } else {
            res.status(404).json({ message: 'EndPoint no especificado' });
          }
        }
      }
      // SIEMPRE responder 200 a MP (incluso si el pago no fue 'approved')
      res.status(200).send();
    } catch (error) {
      const status = error.status ?? 400;
      console.error(error);
      res.status(status).json({ message: error.message });
    }
  }
}
```

**Puntos críticos:**
- `external_reference` es el `id` del registro en BD. Es el puente entre MP y la base de datos.
- `binary_mode: true` elimina el estado "pendiente" — solo hay aprobado o rechazado.
- `purpose: 'wallet_purchase'` obliga al usuario a tener cuenta en MP para pagar.
- La preferencia expira en 20 minutos (sincronizado con el cron de 30 min de cancelación).
- Siempre responder HTTP 200 al webhook, incluso si el pago no es 'approved' (de lo contrario MP reintenta).

---

### 3.2 Middleware de Validación de Firma del Webhook

**Archivo:** `middlewares/auth.js` — función `authMercadoPagoWebhook`

```javascript
import crypto from 'crypto';

/**
 * Middleware de seguridad del Webhook de MercadoPago.
 *
 * MercadoPago envía en cada notificación los headers:
 *   - x-signature: "ts=<timestamp>,v1=<hash_hmac>"
 *   - x-request-id: "<uuid_de_la_request>"
 *
 * Y en la query string:
 *   - data.id: "<id_del_pago>"
 *
 * La firma se valida construyendo el template:
 *   "id:<data.id>;request-id:<x-request-id>;ts:<timestamp>;"
 * y comparando su HMAC-SHA256 (con MP_WEBHOOK_SECRET) contra el hash recibido.
 */
export async function authMercadoPagoWebhook(req, res, next) {
  try {
    const xSignature = req.headers['x-signature'];
    const ts   = xSignature.split(',')[0].split('=')[1]; // timestamp
    const hash = xSignature.split(',')[1].split('=')[1]; // hash v1

    const xRequestId = req.headers['x-request-id'];
    const id = req.query['data.id'];

    // Construir el template exacto que MP usa para firmar
    const template = `id:${id};request-id:${xRequestId};ts:${ts};`;

    const cyphedSignature = crypto
      .createHmac('sha256', process.env.MP_WEBHOOK_SECRET)
      .update(template)
      .digest('hex');

    if (cyphedSignature !== hash) {
      res.status(401).json({ message: 'Acceso denegado' });
    } else {
      next(); // firma válida → continuar al controlador
    }
  } catch (error) {
    res.status(401).json({ message: 'Acceso denegado' });
  }
}
```

> **La clave `MP_WEBHOOK_SECRET` se obtiene en el panel de MercadoPago al configurar el Webhook.**
> Sin esta validación, cualquiera podría enviar peticiones falsas al endpoint y marcar pagos como aprobados.

---

### 3.3 Ruta del Webhook

**Archivo:** `routes/extras/mercadoPago.js`

```javascript
import { Router } from 'express';
import { mercadoPagoController } from '../../controllers/extras/mercadoPago.js';
import { authMercadoPagoWebhook } from '../../middlewares/auth.js';

export const mercadoPagoRouter = Router();

// POST /mercadopago/webhook/:endPoint
//   endPoint puede ser: 'turno' | 'turno-compartido' | 'equipo-torneo'
mercadoPagoRouter.post(
  '/webhook/:endPoint',
  authMercadoPagoWebhook,
  mercadoPagoController.webhookPayment,
);
```

**Registro de la ruta en `app.js`:**

```javascript
import { mercadoPagoRouter } from './routes/extras/mercadoPago.js';
// ...
app.use('/mercadopago', mercadoPagoRouter);
// URL completa del webhook: https://tu-backend.com/mercadopago/webhook/turno
```

---

### 3.4 Función que Actualiza el Campo `idMP` en BD

**Archivo:** `models/turno.js` — funciones `updateIdMP` y `updateIdMPCompartido`

```javascript
// Marca el turno como "pago aprobado" guardando el ID del pago de MP
async function updateIdMP({ id, idMP }) {
  try {
    await db.query(
      `UPDATE Turnos
       SET idMP = ?
       WHERE id = UUID_TO_BIN(?)`,
      {
        replacements: [idMP, id],
        type: QueryTypes.UPDATE,
      },
    );
  } catch (error) {
    error.status = 500;
    throw error;
  }
}
```

> En este proyecto los IDs son UUIDs almacenados como `BINARY(16)` en MySQL.
> Por eso se usa `UUID_TO_BIN(?)`. Si usás IDs enteros o strings, la query es más simple.

---

### 3.5 Integración en el Controlador de Negocio (Ejemplo: Crear Turno)

**Archivo:** `controllers/turno.js` — método `create`

```javascript
// PASO 1: Validar datos de entrada
const result = validateTurnos(req.body);

// PASO 2: Calcular precio según políticas + usuario
const pricing = await getPrice({ user: req.user, parrilla, compartido });
body.precio = pricing.precio;
body.precioSeña = pricing.precioSeña;
body.estado = 'señado';

// PASO 3: Crear el registro en BD dentro de una transacción
let turno = await turnosModel.create(body, { transaction: t });

// PASO 4: Crear la Preference en MercadoPago
const preference = await mercadoPagoController.createPreference({
  title: `Seña RODO F5 | Día: ${turno.fecha} | Hora: ${turno.hora}`,
  precio: turno.precioSeña,        // Se cobra solo la seña, NO el monto total
  idReferencia: turno.id,          // UUID del turno = external_reference en MP
  endPoint: 'turno',               // Define cuál webhook procesará la notificación
});

// PASO 5: Guardar la URL de pago en el turno y confirmar la transacción
await turno.update(
  { urlPreferenciaPago: preference.init_point },
  { transaction: t },
);
await t.commit();

// PASO 6: Devolver el turno (con urlPreferenciaPago) al frontend
res.status(200).json(turno);
```

---

### 3.6 Cron Job de Cancelación Automática

**Archivo:** `controllers/extras/crons.js`

```javascript
import cron from 'node-cron';
import { cancelTurno } from '../../models/turno.js';

// Cada 5 minutos: cancela turnos sin pago que superaron el tiempo límite
cron.schedule('*/5 * * * *', () => {
  cancelTurno();
});
```

**SQL que ejecuta `cancelTurno()`** (en `models/turno.js`):

```javascript
async function cancelTurno() {
  const date = new Date();
  const timeLimit = process.env.MP_TIME ?? 30; // minutos

  await db.query(
    `UPDATE Turnos
     SET estado = 'cancelado'
     WHERE
       idMP IS NULL
       AND TIMESTAMPDIFF(MINUTE, fechaCreacion, ?) >= ?`,
    {
      replacements: [date, timeLimit],
      type: QueryTypes.UPDATE,
    },
  );
}
```

---

### 3.7 Modelo de la Entidad Turno (campos relevantes para MP)

**Campos del modelo Sequelize** (`models/turno.js`):

```javascript
const turnosModel = db.define('Turnos', {
  id: {
    type: DataTypes.BLOB(16),        // UUID almacenado como BINARY(16)
    primaryKey: true,
    // getter/setter convierten entre Buffer y string UUID
  },
  estado: {
    type: DataTypes.STRING(20),      // 'señado' | 'cancelado' | 'finalizado'
    allowNull: false,
  },
  precio: {
    type: DataTypes.INTEGER,         // Precio total del turno
    allowNull: false,
  },
  precioSeña: {
    type: DataTypes.INTEGER,         // Monto cobrado a través de MP (seña)
    allowNull: false,
  },
  fechaCreacion: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,     // Para el cron de cancelación
  },
  idMP: {
    type: DataTypes.STRING(255),     // ID del pago en MP (NULL = no pagado)
    allowNull: true,
  },
  urlPreferenciaPago: {
    type: DataTypes.STRING(255),     // URL init_point de la Preference de MP
    allowNull: true,
  },
  // ... otros campos del negocio
});
```

---

## 4. Código Clave del Frontend

> **Contexto:** El frontend de F5 es **Angular**. El frontend de EI-Estacionamiento es **React**.
> El patrón es idéntico en ambos: llamar al backend, obtener la URL, abrir MP en nueva pestaña.

### 4.1 Servicio que llama al backend para crear el turno (Angular → equivalente React)

**Angular original** (`services/db/turnos.ts`):

```typescript
create(
  data: Pick<turno, 'fecha' | 'hora' | 'buscandoRival' | 'parrilla'>
): Observable<turno> {
  return this.http.post<turno>(this.urlBack + 'turnos', data).pipe(
    catchError((error: HttpErrorResponse) => {
      // manejo de errores...
      return throwError(() => error);
    }),
  );
}
```

**Equivalente en React (fetch o axios):**

```javascript
// services/turnosService.js
const API_URL = import.meta.env.VITE_BACKEND_URL; // o process.env.REACT_APP_...

export async function crearTurno({ fecha, hora, buscandoRival, parrilla }) {
  const response = await fetch(`${API_URL}/turnos`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${localStorage.getItem('token')}`,
    },
    body: JSON.stringify({ fecha, hora, buscandoRival, parrilla }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Error al crear el turno');
  }

  return response.json(); // Retorna el turno con urlPreferenciaPago
}
```

---

### 4.2 Lógica del botón "Confirmar Reserva" — cómo se abre MercadoPago

**Angular original** (`pages/home-sections/reserva/reserva.ts`):

```typescript
reservar() {
  if (!this.isValid()) {
    this.snackBar.open('Por favor seleccione un turno disponible', 'Cerrar', { duration: 5000 });
  } else {
    this.loading = true;
    this.turnosService
      .create({
        fecha: this.fecha,
        hora: this.hora,
        parrilla: this.parrilla ? 1 : 0,
        buscandoRival: this.rival ? 1 : 0,
      })
      .subscribe({
        next: (response) => {
          this.loading = false;
          // ← PUNTO CLAVE: abrir la URL de pago en una nueva pestaña
          window.open(response.urlPreferenciaPago, '_blank');
          this.navService.toPageTop('mis-turnos');
        },
        error: (err) => {
          this.loading = false;
        },
      });
  }
}
```

**Equivalente en React:**

```jsx
// components/ReservaButton.jsx
import { useState } from 'react';
import { crearTurno } from '../services/turnosService';

function ReservaButton({ fecha, hora, parrilla, buscandoRival }) {
  const [loading, setLoading] = useState(false);

  const handleReservar = async () => {
    if (!fecha || !hora) {
      alert('Por favor seleccione un turno disponible');
      return;
    }

    try {
      setLoading(true);
      const turno = await crearTurno({ fecha, hora, parrilla, buscandoRival });

      // ← PUNTO CLAVE: igual que en Angular, abrir la URL en nueva pestaña
      window.open(turno.urlPreferenciaPago, '_blank');

      // Redirigir a la lista de turnos
      navigate('/mis-turnos');
    } catch (error) {
      console.error(error);
      alert(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button onClick={handleReservar} disabled={loading}>
      {loading ? 'Procesando...' : 'Confirmar Reserva'}
    </button>
  );
}
```

> **No hay SDK de MercadoPago instalado en el frontend.**
> El único "código MP del frontend" es `window.open(turno.urlPreferenciaPago, '_blank')`.
> Todo lo demás ocurre en el backend.

---

### 4.3 Interfaz TypeScript del turno (para referencia del modelo de datos)

```typescript
export interface turno {
  id: string;                       // UUID del turno
  idCancha: number;
  idUsuario: number;
  fecha: Date | string;
  hora: string;
  estado: 'señado' | 'cancelado' | 'finalizado';
  estadoDetallado:                  // Calculado en el frontend (no existe en BD)
    | 'señado'
    | 'cancelado'
    | 'finalizado'
    | 'pendiente de pago'           // estado='señado' + idMP=null
    | 'rival encontrado'
    | 'buscando rival';
  precio: number;                   // Precio total
  precioSeña: number;               // Monto cobrado por MP
  buscandoRival: boolean | number;
  parrilla: boolean | number;
  fechaCreacion: Date;
  idMP: string | null;              // NULL = no pagado
  urlPreferenciaPago: string;       // init_point de MP → se abre con window.open
}
```

**Lógica de `estadoDetallado` (calculada en el servicio de Angular):**

```typescript
transformEstado(turno: turno) {
  if (turno.estado === 'señado' && turno.idMP === null) {
    turno.estadoDetallado = 'pendiente de pago';
  } else if (turno.estado === 'señado' && turno.idMP !== null && turno.buscandoRival) {
    turno.estadoDetallado = turno.idMPCompartido !== null
      ? 'rival encontrado'
      : 'buscando rival';
  } else {
    turno.estadoDetallado = turno.estado;
  }
}
```

---

## 5. Adaptación para EI-Estacionamiento

### 5.1 Contexto del nuevo proyecto

- **Frontend:** React + FastAPI/Python
- **Dominio:** Estacionamiento — se cobra por tiempo (duración de la estadía)
- **Diferencia clave con F5:** En F5, el precio se calcula **antes** del servicio (seña conocida de antemano). En un estacionamiento, el precio se calcula **al momento del egreso** (no se sabe cuánto tiempo estará el vehículo).

---

### 5.2 Modelo de Estados Recomendado para EI-Estacionamiento

```
ACTIVO     → el vehículo está dentro del estacionamiento (sin pago aún)
PENDIENTE  → el operador registra el egreso, se calcula el monto y se genera la Preference
CERRADO    → el pago fue aprobado por el Webhook de MP
CANCELADO  → pago fallido o timeout
```

> Este modelo es análogo al de F5, donde `señado` (sin `idMP`) ≈ `PENDIENTE` y `señado` (con `idMP`) ≈ `CERRADO`.

---

### 5.3 Modelo de Datos en Python/SQLAlchemy

```python
# models/estadia.py
from sqlalchemy import Column, Integer, String, DateTime, Float, Enum
from sqlalchemy.sql import func
from database import Base
import enum

class EstadiaEstado(str, enum.Enum):
    ACTIVO   = "ACTIVO"
    PENDIENTE = "PENDIENTE"
    CERRADO  = "CERRADO"
    CANCELADO = "CANCELADO"

class Estadia(Base):
    __tablename__ = "estadias"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    patente         = Column(String(10), nullable=False, index=True)
    hora_entrada    = Column(DateTime, nullable=False, default=func.now())
    hora_salida     = Column(DateTime, nullable=True)
    duracion_minutos= Column(Integer, nullable=True)       # Calculado al cerrar
    monto_total     = Column(Float, nullable=True)         # Calculado al cerrar
    estado          = Column(Enum(EstadiaEstado), default=EstadiaEstado.ACTIVO)
    id_mp           = Column(String(255), nullable=True)   # NULL = no pagado
    url_preferencia_pago = Column(String(512), nullable=True)
    fecha_pendiente = Column(DateTime, nullable=True)      # Para el cron de timeout
```

---

### 5.4 Backend FastAPI — Endpoint para Iniciar el Cobro al Egreso

```python
# routers/estadias.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime
from database import get_db
from models.estadia import Estadia, EstadiaEstado
from services.mercadopago_service import crear_preferencia

router = APIRouter(prefix="/estadias", tags=["estadias"])

@router.post("/{id}/iniciar-cobro")
async def iniciar_cobro(id: int, db: Session = Depends(get_db)):
    """
    El operador registra el egreso del vehículo.
    Calcula el monto y genera la Preference de MercadoPago.
    """
    estadia = db.query(Estadia).filter(Estadia.id == id).first()
    if not estadia:
        raise HTTPException(status_code=404, detail="Estadía no encontrada")
    if estadia.estado != EstadiaEstado.ACTIVO:
        raise HTTPException(status_code=400, detail="La estadía no está activa")

    # 1. Calcular duración y monto
    hora_salida = datetime.now()
    duracion_minutos = int((hora_salida - estadia.hora_entrada).total_seconds() / 60)

    # Lógica de tarifas (ejemplo: $100/hora, mínimo 30 min)
    TARIFA_POR_HORA = 100 # ARS — idealmente viene de una tabla de políticas
    MINIMO_MINUTOS  = 30
    minutos_cobrados = max(duracion_minutos, MINIMO_MINUTOS)
    monto_total = round((minutos_cobrados / 60) * TARIFA_POR_HORA, 2)

    # 2. Crear la Preference en MP
    preference = await crear_preferencia(
        title=f"Estacionamiento | Patente: {estadia.patente} | {duracion_minutos} min",
        precio=monto_total,
        id_referencia=str(estadia.id),
        end_point="estadia",
    )

    # 3. Actualizar estado a PENDIENTE y guardar la URL
    estadia.hora_salida        = hora_salida
    estadia.duracion_minutos   = duracion_minutos
    estadia.monto_total        = monto_total
    estadia.estado             = EstadiaEstado.PENDIENTE
    estadia.url_preferencia_pago = preference["init_point"]
    estadia.fecha_pendiente    = datetime.now()
    db.commit()
    db.refresh(estadia)

    # 4. Devolver la estadía con la URL de pago
    return estadia
```

---

### 5.5 Backend FastAPI — Servicio de MercadoPago

```python
# services/mercadopago_service.py
import httpx
import os
from datetime import datetime, timedelta

MP_ACCESS_TOKEN = os.getenv("MP_ACCESS_TOKEN")
MP_BASE_URL = "https://api.mercadopago.com"

async def crear_preferencia(title: str, precio: float, id_referencia: str, end_point: str) -> dict:
    """
    Crea una Preference de pago en MercadoPago.
    Equivalente directo de mercadoPagoController.createPreference() del proyecto F5.
    """
    now = datetime.utcnow()
    expiry = now + timedelta(minutes=20)

    body = {
        "items": [
            {
                "id": id_referencia,
                "title": title,
                "quantity": 1,
                "unit_price": precio,
                "currency_id": "ARS",
            }
        ],
        "back_urls": {
            "success": f"{os.getenv('MP_URL_FRONTEND_SUCCESS')}/{id_referencia}",
            "failure": os.getenv("MP_URL_FRONTEND_FAILURE"),
            "pending": os.getenv("MP_URL_FRONTEND_FAILURE"),
        },
        "notification_url": f"{os.getenv('MP_URL_BACKEND')}/{end_point}",
        "auto_return": "approved",
        "binary_mode": True,
        "expires": True,
        "expiration_date_from": now.isoformat() + "Z",
        "expiration_date_to": expiry.isoformat() + "Z",
        "external_reference": id_referencia,
    }

    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{MP_BASE_URL}/checkout/preferences",
            json=body,
            headers={
                "Authorization": f"Bearer {MP_ACCESS_TOKEN}",
                "Content-Type": "application/json",
            },
            timeout=10.0,
        )
        response.raise_for_status()
        return response.json()  # Contiene init_point, id, etc.
```

> **Alternativa oficial:** Instalar el SDK de Python `mercadopago` (`pip install mercadopago`).
> La lógica es la misma pero con una interfaz orientada a objetos más limpia.

```python
# Con el SDK oficial de Python
import mercadopago

sdk = mercadopago.SDK(os.getenv("MP_ACCESS_TOKEN"))

def crear_preferencia_con_sdk(title, precio, id_referencia, end_point):
    preference_data = {
        "items": [{"title": title, "quantity": 1, "unit_price": precio}],
        "external_reference": id_referencia,
        "back_urls": { "success": "...", "failure": "...", "pending": "..." },
        "notification_url": f"{os.getenv('MP_URL_BACKEND')}/{end_point}",
        "auto_return": "approved",
        "binary_mode": True,
    }
    result = sdk.preference().create(preference_data)
    return result["response"]  # Contiene init_point
```

---

### 5.6 Backend FastAPI — Webhook Endpoint con Validación de Firma

```python
# routers/mercadopago.py
import hmac
import hashlib
import os
from fastapi import APIRouter, Request, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from fastapi import Depends
from models.estadia import Estadia, EstadiaEstado
import httpx

router = APIRouter(prefix="/mercadopago", tags=["mercadopago"])

def validar_firma_webhook(request_headers: dict, data_id: str) -> bool:
    """
    Equivalente de authMercadoPagoWebhook del proyecto F5.
    Valida la firma HMAC-SHA256 enviada por MercadoPago.
    """
    x_signature = request_headers.get("x-signature", "")
    x_request_id = request_headers.get("x-request-id", "")

    parts = dict(part.split("=", 1) for part in x_signature.split(",") if "=" in part)
    ts   = parts.get("ts", "")
    hash_recibido = parts.get("v1", "")

    # Template de firma (EXACTAMENTE igual que en el proyecto F5)
    template = f"id:{data_id};request-id:{x_request_id};ts:{ts};"

    secret = os.getenv("MP_WEBHOOK_SECRET", "").encode()
    firma_calculada = hmac.new(secret, template.encode(), hashlib.sha256).hexdigest()

    return hmac.compare_digest(firma_calculada, hash_recibido)


@router.post("/webhook/{end_point}")
async def webhook_payment(
    end_point: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Recibe notificaciones de MercadoPago.
    En EI-Estacionamiento: guarda idMP y pasa la estadía a estado CERRADO.
    """
    data_id = request.query_params.get("data.id", "")

    # Validar firma (equivalente al middleware authMercadoPagoWebhook)
    if not validar_firma_webhook(dict(request.headers), data_id):
        raise HTTPException(status_code=401, detail="Firma inválida")

    body = await request.json()

    if body.get("type") == "payment" and data_id != "123456":
        # Consultar el pago a la API de MP para obtener el estado real
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"https://api.mercadopago.com/v1/payments/{data_id}",
                headers={"Authorization": f"Bearer {os.getenv('MP_ACCESS_TOKEN')}"},
            )
            payment = response.json()

        if payment.get("status") == "approved":
            id_estadia = payment.get("external_reference")  # = Estadia.id
            id_mp      = payment.get("id")                  # = ID numérico del pago

            if end_point == "estadia":
                estadia = db.query(Estadia).filter(
                    Estadia.id == int(id_estadia)
                ).first()

                if estadia and estadia.estado == EstadiaEstado.PENDIENTE:
                    estadia.id_mp  = str(id_mp)
                    estadia.estado = EstadiaEstado.CERRADO
                    db.commit()

    # SIEMPRE responder 200 a MP
    return {"status": "ok"}
```

---

### 5.7 Frontend React — Flujo Completo del Cobro

```jsx
// components/CobrarEgreso.jsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const API_URL = import.meta.env.VITE_BACKEND_URL;

async function iniciarCobro(idEstadia) {
  const response = await fetch(`${API_URL}/estadias/${idEstadia}/iniciar-cobro`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${localStorage.getItem('token')}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Error al iniciar el cobro');
  }

  return response.json(); // Retorna la estadía con url_preferencia_pago
}

export function CobrarEgreso({ estadiaId, patente }) {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleCobrar = async () => {
    try {
      setLoading(true);
      const estadia = await iniciarCobro(estadiaId);

      // ← EL MISMO PATRÓN QUE F5: abrir la URL de MP en nueva pestaña
      window.open(estadia.url_preferencia_pago, '_blank');

      // Redirigir al dashboard
      navigate('/dashboard');
    } catch (error) {
      alert(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <p>Patente: <strong>{patente}</strong></p>
      <button onClick={handleCobrar} disabled={loading}>
        {loading ? 'Generando cobro...' : 'Cobrar Egreso con MercadoPago'}
      </button>
    </div>
  );
}
```

---

### 5.8 Cron de Timeout para Estadías PENDIENTE (Python)

En F5, un cron de Node.js cancela turnos sin pago. En EI-Estacionamiento se recomienda lo mismo:

```python
# tasks/cron_estadias.py
# Usar APScheduler o un worker separado (Celery, etc.)
from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy.orm import Session
from database import SessionLocal
from models.estadia import Estadia, EstadiaEstado
from datetime import datetime, timedelta
import os

def cancelar_estadias_timeout():
    """
    Cancela estadías en estado PENDIENTE que llevan más de MP_TIME minutos sin pago.
    Equivalente al cancelTurno() del proyecto F5.
    """
    db: Session = SessionLocal()
    try:
        tiempo_limite_min = int(os.getenv("MP_TIME", 30))
        tiempo_limite = datetime.now() - timedelta(minutes=tiempo_limite_min)

        estadias = db.query(Estadia).filter(
            Estadia.estado == EstadiaEstado.PENDIENTE,
            Estadia.id_mp == None,
            Estadia.fecha_pendiente <= tiempo_limite,
        ).all()

        for estadia in estadias:
            estadia.estado = EstadiaEstado.CANCELADO
        
        db.commit()
        if estadias:
            print(f"[CRON] Canceladas {len(estadias)} estadías por timeout de pago")
    finally:
        db.close()

# Iniciar el scheduler
scheduler = BackgroundScheduler()
scheduler.add_job(cancelar_estadias_timeout, 'interval', minutes=5)
scheduler.start()
```

---

### 5.9 Variables de Entorno para EI-Estacionamiento

```env
# === MERCADOPAGO ===
MP_ACCESS_TOKEN=APP_USR-xxxxxxxxxxxxxxxxxxxx
MP_WEBHOOK_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Backend FastAPI expuesto públicamente (ngrok en desarrollo)
MP_URL_BACKEND=https://tu-backend-ei.com/mercadopago/webhook

# Frontend React
MP_URL_FRONTEND_SUCCESS=https://tu-frontend-ei.com/pago/exito
MP_URL_FRONTEND_FAILURE=https://tu-frontend-ei.com/pago/error

# Timeout en minutos antes de cancelar estadías PENDIENTE sin pago
MP_TIME=30
```

---

### 5.10 Resumen de Diferencias Clave: F5 vs EI-Estacionamiento

| Aspecto                    | F5 (Turnos deportivos)                    | EI-Estacionamiento (propuesto)              |
| -------------------------- | ----------------------------------------- | ------------------------------------------- |
| **Backend**                | Node.js / Express                         | Python / FastAPI                            |
| **Frontend**               | Angular                                   | React                                       |
| **Cuándo se calcula precio** | ANTES del servicio (precio fijo)        | AL EGRESO (precio dinámico por tiempo)      |
| **Flujo de pago**          | Crear turno → generar Preference          | Registrar egreso → calcular monto → Preference |
| **Estado inicial**         | `señado` (sin `idMP`)                     | `PENDIENTE` (sin `id_mp`)                   |
| **Estado final (pagado)**  | `señado` (con `idMP`)                     | `CERRADO` (con `id_mp`)                     |
| **Webhook endPoint**       | `/mercadopago/webhook/turno`              | `/mercadopago/webhook/estadia`              |
| **SDK de MP en frontend**  | ❌ No (solo `window.open`)                | ❌ No (solo `window.open`)                  |
| **Validación firma**       | ✅ HMAC-SHA256 (middleware)               | ✅ HMAC-SHA256 (mismo algoritmo)            |
| **Cron anti-abandono**     | ✅ `node-cron` cada 5 min                 | ✅ APScheduler o Celery cada 5 min          |
| **Tipo de ID en BD**       | UUID como BINARY(16) en MySQL             | Integer autoincrement (más simple)          |
| **Reembolso**              | ✅ Implementado (totalRefund)             | Implementar con la misma lógica             |

---

## Checklist de Implementación para EI-Estacionamiento

- [ ] Obtener `MP_ACCESS_TOKEN` y `MP_WEBHOOK_SECRET` del panel de MercadoPago
- [ ] Configurar las variables de entorno en el servidor FastAPI
- [ ] Crear el modelo `Estadia` con los campos de MP (`id_mp`, `url_preferencia_pago`, `estado`)
- [ ] Implementar `POST /estadias/{id}/iniciar-cobro` con cálculo del monto
- [ ] Implementar `services/mercadopago_service.py` (o instalar SDK de Python)
- [ ] Implementar `POST /mercadopago/webhook/{end_point}` con validación de firma HMAC
- [ ] Configurar en el panel de MP la URL del Webhook apuntando a tu servidor
- [ ] Implementar el cron de cancelación de estadías en timeout
- [ ] En el frontend React: llamar al backend, recibir `url_preferencia_pago`, hacer `window.open()`
- [ ] Probar en **sandbox** de MP con credenciales de prueba antes de pasar a producción
- [ ] Asegurarse de que el backend tenga HTTPS (requisito de MP para Webhooks)

---

*Guía generada el 2026-04-14 a partir del análisis exhaustivo de los proyectos F5BE y F5FE.*
*Mantener este documento actualizado ante cualquier cambio en la integración.*
