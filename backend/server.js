import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import axios from 'axios';
import cron from 'node-cron';
import { poolPlanilla, poolFinance } from './config/dbSql.js';
import mssql from 'mssql';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import dniRoutes from './routes/dniRoutes.js';
import gmailRoutes from './integrations/gmailRoutes.js';
// import demoRoutes from './routes/endpoint-demo-test.js';

const app = express();
app.set('trust proxy', true);
const pendingCommands = new Map();
const biometricUsersCache = new Map();
const knownDeviceSNs = new Set();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const corsOptions = {
    origin: (origin, callback) => {
        const allowedOrigins = process.env.CORS_ORIGIN
            ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
            : [];
        const isLocalhost = origin && (origin.includes('localhost') || origin.includes('127.0.0.1'));
        if (!origin || allowedOrigins.includes(origin) || isLocalhost) {
            callback(null, true);
        } else {
            callback(null, true);
        }
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: ['Content-Type', 'Authorization', 'x-hwperu-key'],
    credentials: true
};
app.use(cors(corsOptions));
const port = process.env.PORT || 3005;
app.use('/iclock', express.text({ type: '*/*', limit: '10mb' }));
app.use('/iclock', (req, res, next) => {
    if (req.method === 'POST') {
    }
    next();
});
app.use(express.json());
app.use((req, res, next) => {
    next();
});
const distPath = path.join(__dirname, 'public');
app.use(express.static(distPath));
app.use('/api/reniec', dniRoutes);
app.use('/api', gmailRoutes);
// app.use('/api/whmcs-demo', demoRoutes);

app.get('/api/dashboard/stats', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        const now = new Date();
        const currentMonth = now.getMonth() + 1;
        const currentYear = now.getFullYear();

        const payrollRes = await pool.request()
            .input('mes', mssql.Int, currentMonth)
            .input('anio', mssql.Int, currentYear)
            .query(`
                SELECT e.ID_EMPLOYEE, e.SUELDO_BASE, e.TIPO_TRABAJADOR, 
                       ISNULL(pb.HORAS_EXTRAS, 0) as HORAS_EXTRAS,
                       pb.BONOS_JSON,
                       (SELECT ISNULL(SUM(TOTAL_HOURS), 0) FROM ATTENDANCE_DAILY_REPORTS 
                        WHERE ID_EMPLOYEE = e.ID_EMPLOYEE 
                        AND MONTH(DATE) = @mes AND YEAR(DATE) = @anio) as ASISTENCIA_TOTAL_HORAS
                FROM EMPLOYEES e
                LEFT JOIN PLANILLA_BORRADOR pb ON e.ID_EMPLOYEE = pb.ID_EMPLOYEE
                WHERE e.ACTIVO = 1 OR e.ACTIVO IS NULL
            `);

        const activeEmployees = payrollRes.recordset;
        const activeCount = activeEmployees.length;

        let totalInversionPlanilla = 0;

        activeEmployees.forEach(emp => {
            const sueldo = emp.SUELDO_BASE || 0;

            let bonosTotal = 0;
            try {
                if (emp.BONOS_JSON) {
                    const bonos = JSON.parse(emp.BONOS_JSON);
                    bonosTotal = bonos.reduce((sum, b) => sum + (Number(b.monto) || 0), 0);
                }
            } catch (e) { }

            const baseCalculo = sueldo + bonosTotal;
            const hourlyRate = (baseCalculo / 240) * 1.25;
            const montoHorasExtras = hourlyRate * (Number(emp.HORAS_EXTRAS) || 0);

            totalInversionPlanilla += (sueldo + bonosTotal + montoHorasExtras);
        });

        const birthdayRes = await pool.request()
            .input('month', mssql.Int, currentMonth)
            .query('SELECT NOMBRE, APELLIDOS, FECHA_NACIMIENTO FROM EMPLOYEES WHERE MONTH(FECHA_NACIMIENTO) = @month AND (ACTIVO = 1 OR ACTIVO IS NULL)');

        const birthdays = birthdayRes.recordset.map(emp => ({
            name: `${emp.NOMBRE} ${emp.APELLIDOS}`,
            date: emp.FECHA_NACIMIENTO ? new Date(emp.FECHA_NACIMIENTO).toLocaleDateString('es-ES', { day: '2-digit', month: 'long' }) : 'N/A'
        }));

        const expiryRes = await pool.request()
            .query(`
                SELECT NOMBRE, APELLIDOS, FECHA_FIN_CONTRATO 
                FROM EMPLOYEES 
                WHERE FECHA_FIN_CONTRATO >= GETDATE() 
                AND FECHA_FIN_CONTRATO <= DATEADD(day, 30, GETDATE())
                AND (ACTIVO = 1 OR ACTIVO IS NULL)
            `);

        const contractExpirations = expiryRes.recordset.map(emp => ({
            name: `${emp.NOMBRE} ${emp.APELLIDOS}`,
            expiryDate: new Date(emp.FECHA_FIN_CONTRATO).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
        }));

        const financePool = await poolFinance;
        const unpaidRes = await financePool.request()
            .input('unpaidMonth', mssql.Int, currentMonth)
            .input('unpaidYear', mssql.Int, now.getFullYear())
            .query(`
                SELECT TOP 20 WHMCS_InvoiceID, ClienteConcepto, MontoBruto, Fecha 
                FROM FINANCE_INVOICES 
                WHERE EstadoWHMCS = 'Unpaid'
                AND MONTH(Fecha) = @unpaidMonth
                AND YEAR(Fecha) = @unpaidYear
                ORDER BY Fecha ASC
            `);

        const unpaidInvoices = unpaidRes.recordset.map(inv => ({
            id: inv.WHMCS_InvoiceID,
            cliente: inv.ClienteConcepto,
            monto: inv.MontoBruto,
            vencimiento: inv.Fecha ? new Date(inv.Fecha).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : 'N/A'
        }));

        const cajaVirtualRes = await financePool.request()
            .input('cvMonth', mssql.Int, currentMonth)
            .input('cvYear', mssql.Int, now.getFullYear())
            .query(`
                SELECT WHMCS_InvoiceID, ClienteConcepto, MontoBruto, Comision, DepositoSalida, Fecha, CuentaDebito
                FROM FINANCE_INVOICES 
                WHERE EstadoLocal = 'Pendiente'
                AND Banco = 'Caja Virtual'
                AND MONTH(Fecha) = @cvMonth
                AND YEAR(Fecha) = @cvYear
                ORDER BY Fecha DESC
            `);

        const pendingCajaVirtual = cajaVirtualRes.recordset.map(inv => ({
            id: inv.WHMCS_InvoiceID,
            cliente: inv.ClienteConcepto,
            monto: inv.MontoBruto,
            comision: inv.Comision || 0,
            neto: inv.DepositoSalida || inv.MontoBruto,
            fecha: inv.Fecha ? new Date(inv.Fecha).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : 'N/A',
            cuentaDebito: inv.CuentaDebito
        }));

        const totalPendingCaja = pendingCajaVirtual.reduce((sum, inv) => sum + (Number(inv.monto) || 0), 0);

        res.json({
            stats: [
                { title: 'Total Empleados', value: activeCount.toString(), change: 'Activos actualmente', icon: '👥', color: 'blue' },
                { title: 'Inversión Total Planilla', value: `S/ ${totalInversionPlanilla.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`, change: 'Sueldos + Bonos + HE', icon: '💰', color: 'green' },
                { title: 'Vencimientos 30d', value: contractExpirations.length.toString(), change: 'Contratos por vencer', icon: '⚠️', color: 'orange' },
                { title: 'Facturas UnPaid', value: unpaidInvoices.length.toString(), change: 'Pendientes WHMCS', icon: '🧾', color: 'red' }
            ],
            birthdays: birthdays,
            contractExpirations: contractExpirations,
            unpaidInvoices: unpaidInvoices,
            pendingCajaVirtual: pendingCajaVirtual,
            totalPendingCaja: totalPendingCaja
        });
    } catch (error) {
        res.status(500).json({ error: 'Error interno al cargar estadísticas' });
    }
});

async function processVirtualPayment(invoiceId, gateway, amount, pool, isForeign = false, force = false) {
    const checkRes = await pool.request()
        .input('invoiceId', mssql.Int, invoiceId)
        .query('SELECT MontoBruto, EstadoLocal FROM FINANCE_INVOICES WHERE WHMCS_InvoiceID = @invoiceId');

    if (checkRes.recordset.length === 0) {
        throw new Error('Factura no encontrada en el sistema financiero');
    }

    const record = checkRes.recordset[0];
    if (record.EstadoLocal === 'Pagado' && !force) {
        return { alreadyProcessed: true };
    }

    if (force) {
        await pool.request()
            .input('invoiceId', mssql.Int, invoiceId)
            .query('DELETE FROM FINANCE_JOURNAL WHERE InvoiceID = @invoiceId');
    }

    const montoBruto = parseFloat(amount) || record.MontoBruto;

    const round2 = (num) => Math.round((num + Number.EPSILON) * 100) / 100;

    let porcentajeComision = 0.04;
    let comisionFija = 0.00;

    const gatewayLower = gateway.toLowerCase();
    if (gatewayLower.includes('izipay')) {
        const forceForeign = isForeign || gatewayLower.includes('extranjera') || gatewayLower.includes('foreign');
        porcentajeComision = forceForeign ? 0.0399 : 0.0344;
        comisionFija = 0.69;
    } else if (gatewayLower.includes('mercado libre') || gatewayLower.includes('mercadopago')) {
        porcentajeComision = 0.12;
        comisionFija = 0.00;
    }

    const baseImponible = round2(montoBruto / 1.18);
    const igvVenta = round2(montoBruto - baseImponible);

    const comisionBase = round2((montoBruto * porcentajeComision) + comisionFija);
    const igvComision = round2(comisionBase * 0.18);
    const comisionTotalConIgv = round2(comisionBase + igvComision);
    const montoNeto = round2(montoBruto - comisionTotalConIgv);

    await pool.request()
        .input('invoiceId', mssql.Int, invoiceId)
        .input('comision', mssql.Decimal(10, 2), comisionTotalConIgv)
        .input('montoNeto', mssql.Decimal(10, 2), montoNeto)
        .query(`
            UPDATE FINANCE_INVOICES 
            SET DepositoSalida = @montoNeto,
                Comision = @comision,
                UpdatedAt = GETDATE()
            WHERE WHMCS_InvoiceID = @invoiceId 
            AND (UPPER(EstadoLocal) != 'PAGADO')
        `);

    const asientosReales = [
        { cuenta: '1213', desc: `Factura por cobrar ${gateway} #${invoiceId}`, debe: montoBruto, haber: 0, tipo: 'VENTA' },
        { cuenta: '7011', desc: `Venta de servicio WHMCS #${invoiceId}`, debe: 0, haber: baseImponible, tipo: 'VENTA' },
        { cuenta: '40111', desc: `IGV debito fiscal venta #${invoiceId}`, debe: 0, haber: igvVenta, tipo: 'VENTA' },

        { cuenta: '6591', desc: `Comision ${gateway} sin IGV #${invoiceId}`, debe: comisionBase, haber: 0, tipo: 'GASTO' },
        { cuenta: '40112', desc: `IGV credito fiscal comision #${invoiceId}`, debe: igvComision, haber: 0, tipo: 'GASTO' },
        { cuenta: '4212', desc: `CxP obligacion comision ${gateway} #${invoiceId}`, debe: 0, haber: comisionTotalConIgv, tipo: 'GASTO' },

        { cuenta: '1041', desc: `Deposito neto ${gateway} #${invoiceId}`, debe: montoNeto, haber: 0, tipo: 'COBRO' },
        { cuenta: '4212', desc: `Cancelacion comision ${gateway} #${invoiceId}`, debe: comisionTotalConIgv, haber: 0, tipo: 'COBRO' },
        { cuenta: '1213', desc: `Cancelacion CxC cliente #${invoiceId}`, debe: 0, haber: montoBruto, tipo: 'COBRO' }
    ];

    for (const asiento of asientosReales) {
        await pool.request()
            .input('invId', mssql.Int, invoiceId)
            .input('cta', mssql.NVarChar, asiento.cuenta)
            .input('desc', mssql.NVarChar, asiento.desc)
            .input('debe', mssql.Decimal(18, 2), asiento.debe)
            .input('haber', mssql.Decimal(18, 2), asiento.haber)
            .input('tipo', mssql.NVarChar, asiento.tipo)
            .input('ref', mssql.NVarChar, gateway)
            .query(`
                INSERT INTO FINANCE_JOURNAL (InvoiceID, CuentaContable, Descripcion, Debe, Haber, TipoAsiento, Referencia)
                VALUES (@invId, @cta, @desc, @debe, @haber, @tipo, @ref)
            `);
    }

    return {
        status: 'success',
        datos: { invoiceId, gateway, montoBruto, comisionTotalConIgv, montoNeto },
        asientosRegistrados: asientosReales
    };
}

app.post('/api/finance/payment-confirmation', async (req, res) => {
    try {
        const body = req.body;
        const pool = await poolFinance;

        if (Array.isArray(body)) {
            const results = [];
            for (const item of body) {
                const { invoiceId, gateway, amount, isForeign, force } = item;
                if (!invoiceId || !gateway) {
                    results.push({ invoiceId, status: 'error', message: 'Faltan datos' });
                    continue;
                }
                const resBatch = await processVirtualPayment(invoiceId, gateway, amount, pool, isForeign, force);
                results.push({ invoiceId, ...resBatch });
            }
            return res.json({ status: 'success', mensaje: 'Procesamiento por lotes completado', results });
        }

        const { invoiceId, gateway, amount, isForeign, force } = body;
        if (!invoiceId || !gateway) {
            return res.status(400).json({ status: 'error', message: 'Faltan datos requeridos' });
        }

        const result = await processVirtualPayment(invoiceId, gateway, amount, pool, isForeign, force);

        if (result.alreadyProcessed) {
            return res.json({ status: 'info', mensaje: 'Esta factura ya fue liquidada anteriormente. Usa force: true para re-calcular.' });
        }

        res.json({
            status: 'success',
            mensaje: 'Pago procesado y asientos registrados en Libro Diario',
            ...result
        });
    } catch (error) {
        console.error('Error al procesar el pago virtual:', error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

let lastSyncTime = null;
const SYNC_COOLDOWN = 5 * 60 * 1000;
let cachedThisMonthPaid = 0;
let cachedThisMonthTotalGross = 0;

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const pool = await poolPlanilla;

        const checkBlockRes = await pool.request()
            .input('email', mssql.VarChar, email)
            .input('ip', mssql.VarChar, ip)
            .query(`
                SELECT COUNT(*) as attempts 
                FROM LOGIN_ATTEMPTS 
                WHERE EMAIL = @email AND IP_ADDRESS = @ip 
                AND SUCCESS = 0 
                AND ATTEMPT_TIME > DATEADD(minute, -30, GETDATE())
            `);

        if (checkBlockRes.recordset[0].attempts >= 3) {
            return res.status(429).json({
                success: false,
                message: 'Cuenta bloqueada temporalmente por demasiados intentos fallidos. Intente de nuevo en 30 minutos o contacte al administrador.'
            });
        }

        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('USERS') AND name = 'CAN_DASHBOARD')
            ALTER TABLE USERS ADD CAN_DASHBOARD BIT DEFAULT 1;
            
            IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('USERS') AND name = 'CAN_HISTORIAL')
            ALTER TABLE USERS ADD CAN_HISTORIAL BIT DEFAULT 1;

            IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('USERS') AND name = 'CAN_VACACIONES')
            ALTER TABLE USERS ADD CAN_VACACIONES BIT DEFAULT 1;

            IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('USERS') AND name = 'CAN_ASISTENCIA')
            ALTER TABLE USERS ADD CAN_ASISTENCIA BIT DEFAULT 1;
        `);

        const result = await pool.request()
            .input('email', mssql.VarChar, email)
            .input('password', mssql.VarChar, password)
            .query('SELECT * FROM USERS WHERE EMAIL = @email AND PASSWORD = @password');

        const success = result.recordset.length > 0;

        await pool.request()
            .input('email', mssql.VarChar, email)
            .input('ip', mssql.VarChar, ip)
            .input('success', mssql.Bit, success ? 1 : 0)
            .query('INSERT INTO LOGIN_ATTEMPTS (EMAIL, IP_ADDRESS, SUCCESS) VALUES (@email, @ip, @success)');

        if (success) {
            const user = result.recordset[0];

            await pool.request()
                .input('email', mssql.VarChar, email)
                .input('ip', mssql.VarChar, ip)
                .query('DELETE FROM LOGIN_ATTEMPTS WHERE EMAIL = @email AND IP_ADDRESS = @ip AND SUCCESS = 0');

            const userPermissions = {
                dashboard: !!user.CAN_DASHBOARD || user.ROL === 'SUPER_ADMIN' || user.CAN_DASHBOARD === undefined,
                planilla: !!user.CAN_PLANILLA || user.ROL === 'SUPER_ADMIN',
                movimientos: !!user.CAN_MOVIMIENTOS || user.ROL === 'SUPER_ADMIN',
                finanzas: !!user.CAN_FINANZAS || user.ROL === 'SUPER_ADMIN',
                empleados: !!user.CAN_EMPLEADOS || user.ROL === 'SUPER_ADMIN',
                archivados: !!user.CAN_ARCHIVADOS || user.ROL === 'SUPER_ADMIN',
                historial: !!user.CAN_HISTORIAL || user.ROL === 'SUPER_ADMIN',
                vacaciones: !!user.CAN_VACACIONES || user.ROL === 'SUPER_ADMIN',
                asistencia: !!user.CAN_ASISTENCIA || user.ROL === 'SUPER_ADMIN'
            };

            res.json({
                success: true,
                message: 'Login exitoso',
                user: {
                    email: user.EMAIL,
                    fullName: user.FULL_NAME,
                    rol: user.ROL,
                    permissions: userPermissions
                }
            });
        } else {
            res.status(401).json({ success: false, message: 'Credenciales inválidas' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error en el servidor' });
    }
});

app.get('/api/auth/me/:email', async (req, res) => {
    try {
        const { email } = req.params;
        const pool = await poolPlanilla;

        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('USERS') AND name = 'CAN_DASHBOARD')
            ALTER TABLE USERS ADD CAN_DASHBOARD BIT DEFAULT 1;
            
            IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('USERS') AND name = 'CAN_HISTORIAL')
            ALTER TABLE USERS ADD CAN_HISTORIAL BIT DEFAULT 1;

            IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('USERS') AND name = 'CAN_VACACIONES')
            ALTER TABLE USERS ADD CAN_VACACIONES BIT DEFAULT 1;

            IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('USERS') AND name = 'CAN_ASISTENCIA')
            ALTER TABLE USERS ADD CAN_ASISTENCIA BIT DEFAULT 1;
        `);

        const result = await pool.request()
            .input('email', mssql.VarChar, email)
            .query('SELECT * FROM USERS WHERE EMAIL = @email');

        if (result.recordset.length > 0) {
            const user = result.recordset[0];
            const userPermissions = {
                dashboard: !!user.CAN_DASHBOARD || user.ROL === 'SUPER_ADMIN' || user.CAN_DASHBOARD === undefined,
                planilla: !!user.CAN_PLANILLA || user.ROL === 'SUPER_ADMIN',
                movimientos: !!user.CAN_MOVIMIENTOS || user.ROL === 'SUPER_ADMIN',
                finanzas: !!user.CAN_FINANZAS || user.ROL === 'SUPER_ADMIN',
                empleados: !!user.CAN_EMPLEADOS || user.ROL === 'SUPER_ADMIN',
                archivados: !!user.CAN_ARCHIVADOS || user.ROL === 'SUPER_ADMIN',
                historial: !!user.CAN_HISTORIAL || user.ROL === 'SUPER_ADMIN',
                vacaciones: !!user.CAN_VACACIONES || user.ROL === 'SUPER_ADMIN',
                asistencia: !!user.CAN_ASISTENCIA || user.ROL === 'SUPER_ADMIN'
            };

            res.json({
                success: true,
                user: {
                    email: user.EMAIL,
                    fullName: user.FULL_NAME,
                    rol: user.ROL,
                    permissions: userPermissions
                }
            });
        } else {
            res.status(404).json({ success: false, message: 'Usuario no encontrado' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error en el servidor' });
    }
});

app.get('/api/admin/security/blocked', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        const result = await pool.request().query(`
            SELECT EMAIL, IP_ADDRESS, COUNT(*) as Fails, MAX(ATTEMPT_TIME) as LastAttempt
            FROM LOGIN_ATTEMPTS
            WHERE SUCCESS = 0 AND ATTEMPT_TIME > DATEADD(minute, -30, GETDATE())
            GROUP BY EMAIL, IP_ADDRESS
            HAVING COUNT(*) >= 3
        `);
        res.json(result.recordset);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener bloqueos' });
    }
});

app.post('/api/admin/security/unblock', async (req, res) => {
    try {
        const { email, ip } = req.body;
        const pool = await poolPlanilla;
        await pool.request()
            .input('email', mssql.VarChar, email)
            .input('ip', mssql.VarChar, ip)
            .query('DELETE FROM LOGIN_ATTEMPTS WHERE EMAIL = @email AND IP_ADDRESS = @ip');
        res.json({ success: true, message: 'Usuario desbloqueado correctamente' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al desbloquear: ' + error.message });
    }
});

app.get('/api/admin/ips', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        const result = await pool.request().query('SELECT * FROM ALLOWED_IPS_WHITELIST ORDER BY CREATED_AT DESC');
        res.json(result.recordset);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener lista de IPs' });
    }
});

app.post('/api/admin/ips', async (req, res) => {
    try {
        const { address, label } = req.body;
        if (!address) return res.status(400).json({ message: 'IP requerida' });

        const pool = await poolPlanilla;
        await pool.request()
            .input('ip', mssql.VarChar, address)
            .input('label', mssql.VarChar, label || 'Sin etiqueta')
            .query('INSERT INTO ALLOWED_IPS_WHITELIST (IP_ADDRESS, LABEL) VALUES (@ip, @label)');

        res.json({ success: true, message: 'IP autorizada correctamente' });
    } catch (error) {
        res.status(500).json({ error: 'Error al guardar IP' });
    }
});

app.delete('/api/admin/ips/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const pool = await poolPlanilla;
        await pool.request()
            .input('id', mssql.Int, id)
            .query('DELETE FROM ALLOWED_IPS_WHITELIST WHERE ID = @id');
        res.json({ success: true, message: 'IP eliminada' });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar IP' });
    }
});

app.get('/api/admin/users', async (req, res) => {
    try {
        const pool = await poolPlanilla;

        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('USERS') AND name = 'CAN_DASHBOARD')
            ALTER TABLE USERS ADD CAN_DASHBOARD BIT DEFAULT 1;
            
            IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('USERS') AND name = 'CAN_HISTORIAL')
            ALTER TABLE USERS ADD CAN_HISTORIAL BIT DEFAULT 1;

            IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('USERS') AND name = 'CAN_VACACIONES')
            ALTER TABLE USERS ADD CAN_VACACIONES BIT DEFAULT 1;

            IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('USERS') AND name = 'CAN_ASISTENCIA')
            ALTER TABLE USERS ADD CAN_ASISTENCIA BIT DEFAULT 1;
        `);

        const result = await pool.request().query('SELECT ID_USERS, EMAIL, FULL_NAME, ROL, CAN_PLANILLA, CAN_MOVIMIENTOS, CAN_FINANZAS, CAN_EMPLEADOS, CAN_ARCHIVADOS, CAN_DASHBOARD, CAN_HISTORIAL, CAN_VACACIONES, CAN_ASISTENCIA FROM USERS');
        res.json(result.recordset);
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al obtener usuarios: ' + error.message });
    }
});

app.delete('/api/admin/users/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const pool = await poolPlanilla;
        await pool.request()
            .input('id', mssql.Int, id)
            .query('DELETE FROM USERS WHERE ID_USERS = @id');

        res.json({ success: true, message: 'Usuario eliminado correctamente' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al eliminar usuario: ' + error.message });
    }
});

app.post('/api/admin/update-permissions', async (req, res) => {
    try {
        const { id, full_name, can_planilla, can_movimientos, can_finanzas, can_empleados, can_archivados, can_dashboard, can_historial, can_vacaciones, can_asistencia } = req.body;
        const pool = await poolPlanilla;
        await pool.request()
            .input('id', mssql.Int, id)
            .input('name', mssql.VarChar, full_name)
            .input('p1', mssql.Bit, can_planilla ? 1 : 0)
            .input('p2', mssql.Bit, can_movimientos ? 1 : 0)
            .input('p3', mssql.Bit, can_finanzas ? 1 : 0)
            .input('p4', mssql.Bit, can_empleados ? 1 : 0)
            .input('p5', mssql.Bit, can_archivados ? 1 : 0)
            .input('p6', mssql.Bit, can_dashboard ? 1 : 0)
            .input('p7', mssql.Bit, can_historial ? 1 : 0)
            .input('p8', mssql.Bit, can_vacaciones ? 1 : 0)
            .input('p9', mssql.Bit, can_asistencia ? 1 : 0)
            .query('UPDATE USERS SET FULL_NAME = @name, CAN_PLANILLA = @p1, CAN_MOVIMIENTOS = @p2, CAN_FINANZAS = @p3, CAN_EMPLEADOS = @p4, CAN_ARCHIVADOS = @p5, CAN_DASHBOARD = @p6, CAN_HISTORIAL = @p7, CAN_VACACIONES = @p8, CAN_ASISTENCIA = @p9 WHERE ID_USERS = @id');

        res.json({ success: true, message: 'Permisos actualizados correctamente' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al actualizar permisos: ' + error.message });
    }
});

app.post('/api/admin/create-user', async (req, res) => {
    try {
        const { email, password, full_name, role, permissions = {} } = req.body;
        const pool = await poolPlanilla;

        const checkUser = await pool.request()
            .input('email', mssql.VarChar, email)
            .query('SELECT ID_USERS FROM USERS WHERE EMAIL = @email');

        if (checkUser.recordset.length > 0) {
            return res.status(400).json({ success: false, message: 'El usuario ya existe' });
        }

        await pool.request()
            .input('email', mssql.VarChar, email)
            .input('pass', mssql.VarChar, password)
            .input('name', mssql.VarChar, full_name)
            .input('role', mssql.VarChar, role || 'ADMIN')
            .input('p1', mssql.Bit, permissions.planilla ? 1 : 0)
            .input('p2', mssql.Bit, permissions.movimientos ? 1 : 0)
            .input('p3', mssql.Bit, permissions.finanzas ? 1 : 0)
            .input('p4', mssql.Bit, permissions.empleados ? 1 : 0)
            .input('p5', mssql.Bit, permissions.archivados ? 1 : 0)
            .input('p6', mssql.Bit, permissions.dashboard ? 1 : 0)
            .input('p7', mssql.Bit, permissions.historial ? 1 : 0)
            .input('p8', mssql.Bit, permissions.vacaciones ? 1 : 0)
            .input('p9', mssql.Bit, permissions.asistencia ? 1 : 0)
            .query(`
                INSERT INTO USERS (EMAIL, PASSWORD, FULL_NAME, ROL, CAN_PLANILLA, CAN_MOVIMIENTOS, CAN_FINANZAS, CAN_EMPLEADOS, CAN_ARCHIVADOS, CAN_DASHBOARD, CAN_HISTORIAL, CAN_VACACIONES, CAN_ASISTENCIA)
                VALUES (@email, @pass, @name, @role, @p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8, @p9)
            `);

        // Enviar correo de bienvenida
        try {
            const { getGmailClient } = await import('./integrations/gmailClient.js');
            const gmail = getGmailClient();

            const permsList = [
                permissions.dashboard ? '✔ Panel Principal' : '',
                permissions.empleados ? '✔ Empleados' : '',
                permissions.archivados ? '✔ Archivados' : '',
                permissions.planilla ? '✔ Planilla' : '',
                permissions.pagos ? '✔ Pagos' : '',
                permissions.vacaciones ? '✔ Vacaciones' : '',
                permissions.movimientos ? '✔ Movimientos' : '',
                permissions.asistencia ? '✔ Asistencia' : '',
                permissions.finanzas ? '✔ Finanzas' : '',
                permissions.historial ? '✔ Historial' : ''
            ].filter(Boolean).join('<br/>');

            const emailHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
                <div style="background-color: #3b82f6; padding: 20px; text-align: center;">
                    <h1 style="color: white; margin: 0; font-size: 24px;">¡Bienvenido al Sistema!</h1>
                </div>
                <div style="padding: 30px; background-color: #ffffff;">
                    <p style="font-size: 16px; color: #334155;">Hola <strong>${full_name}</strong>,</p>
                    <p style="font-size: 16px; color: #334155;">Se ha creado una cuenta administrativa para ti. A continuación, tus credenciales de acceso seguro:</p>
                    
                    <div style="background-color: #f8fafc; border-left: 4px solid #3b82f6; padding: 15px; margin: 20px 0;">
                        <p style="margin: 0 0 10px 0; font-size: 15px;"><strong>Usuario/Email:</strong> ${email}</p>
                        <p style="margin: 0; font-size: 15px;"><strong>Contraseña:</strong> ${password}</p>
                    </div>

                    <h3 style="color: #0f172a; margin-top: 25px;">Tus accesos habilitados:</h3>
                    <div style="color: #10b981; font-weight: bold; line-height: 1.6; margin-bottom: 30px;">
                        ${permsList}
                    </div>

                    <div style="text-align: center; margin-top: 30px;">
                        <a href="https://sistema.tuempresa.com" style="background-color: #3b82f6; color: white; padding: 12px 25px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px; display: inline-block;">Ingresar al Sistema</a>
                    </div>
                </div>
                <div style="background-color: #f1f5f9; padding: 15px; text-align: center; font-size: 12px; color: #64748b;">
                    Este es un correo automático. Por favor, no respondas a este mensaje.<br>
                    Te recomendamos cambiar tu contraseña luego de tu primer ingreso.
                </div>
            </div>`;

            // Construir mensaje en formato RFC 2822
            const utf8Subject = `=?utf-8?B?${Buffer.from('Bienvenido al Sistema - Tus credenciales de acceso').toString('base64')}?=`;
            const messageParts = [
                'Content-Type: text/html; charset="UTF-8"',
                'MIME-Version: 1.0',
                `To: ${email}`,
                'From: "Sistema Administrativo" <me>',
                `Subject: ${utf8Subject}`,
                '',
                emailHtml
            ];
            const emailBody = messageParts.join('\r\n');
            const encodedEmail = Buffer.from(emailBody).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

            await gmail.users.messages.send({
                userId: 'me',
                requestBody: {
                    raw: encodedEmail
                }
            });
            console.log('Correo de bienvenida enviado exitosamente a:', email);
        } catch (emailErr) {
            console.error('Error enviando correo de bienvenida:', emailErr);
            // No detenemos la respuesta, el usuario ya se creó
        }

        res.json({ success: true, message: 'Usuario creado y correo enviado correctamente' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al crear usuario: ' + error.message });
    }
});

app.post('/api/admin/logs', async (req, res) => {
    try {
        const { user, action, module, details } = req.body;
        const pool = await poolPlanilla;

        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='ACTIVITY_LOGS' AND xtype='U')
            BEGIN
                CREATE TABLE ACTIVITY_LOGS (
                    ID INT IDENTITY(1,1) PRIMARY KEY,
                    USER_EMAIL NVARCHAR(255),
                    ACTION NVARCHAR(MAX),
                    MODULE NVARCHAR(100),
                    DETAILS NVARCHAR(MAX),
                    CREATED_AT DATETIME DEFAULT GETDATE()
                )
            END
        `);

        await pool.request()
            .input('user', mssql.NVarChar, user || 'Sistema')
            .input('action', mssql.NVarChar, action)
            .input('module', mssql.NVarChar, module)
            .input('details', mssql.NVarChar, details || '')
            .query('INSERT INTO ACTIVITY_LOGS (USER_EMAIL, ACTION, MODULE, DETAILS) VALUES (@user, @action, @module, @details)');

        res.json({ success: true });
    } catch (error) {

        res.status(500).json({ error: 'Failed to record log' });
    }
});

app.get('/api/admin/logs', async (req, res) => {
    const masterKey = req.headers['x-hwperu-key'];
    if (masterKey !== 'hw-peru-2025-seguro') {
        return res.status(403).json({ error: 'Master Key requerida para ver logs' });
    }

    try {
        const pool = await poolPlanilla;
        const result = await pool.request().query('SELECT TOP 100 * FROM ACTIVITY_LOGS ORDER BY CREATED_AT DESC');
        res.json(result.recordset);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch logs' });
    }
});

app.get('/api/empleados', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        const result = await pool.request().query('SELECT * FROM EMPLOYEES');

        const empleadosActivos = result.recordset.filter(emp => emp.ACTIVO === 1 || emp.ACTIVO === true || emp.ACTIVO === null);

        const empleados = empleadosActivos.map(emp => ({
            _id: emp.ID_EMPLOYEE,
            id: emp.ID_EMPLOYEE,
            nombre: emp.NOMBRE || 'Sin Nombre',
            apellidos: emp.APELLIDOS || '',
            dni: emp.DNI,
            sexo: emp.GENERO,
            nacionalidad: emp.NACIONALIDAD,
            telefono: emp.TELEFONO,
            contactoEmergencia: emp.NOMBRE_CONTACTO,
            numeroEmergencia: emp.NUMERO_EMERGENCIA,
            fechaNacimiento: emp.FECHA_NACIMIENTO,
            direccion: emp.DIRECCION,
            cargo: emp.CARGO,
            departamento: emp.DEPARTAMENTO,
            tipoTrabajador: emp.TIPO_TRABAJADOR,
            regimenPensionario: emp.ENTIDAD_PREVISIONAL,
            sueldo: emp.SUELDO_BASE,
            calculoAfpMinimo: !!emp.DESCUENTO_AFP_MINIMO,
            fechaInicio: emp.FECHA_INGRESO,
            fechaFinContrato: emp.FECHA_FIN_CONTRATO,
            horarioTrabajo: emp.JORNADA_LABORAL,
            banco: emp.BANCO,
            tipoCuenta: emp.TIPO_CUENTA,
            numeroCuenta: emp.NUMERO_CUENTA,
            cci: emp.CCI,
            email: emp.CORREO,
            biometricId: emp.BIOMETRIC_ID,
            entryTime: emp.ENTRY_TIME,
            exitTime: emp.EXIT_TIME,
            estado: 'Activo'
        }));

        res.json(empleados);
    } catch (error) {
        res.status(500).json({
            error: 'Error al obtener empleados',
            details: error.message
        });
    }
});

app.get('/api/empleados-archivados', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        const result = await pool.request().query("SELECT * FROM EMPLOYEES WHERE ACTIVO = 0 AND CAST(ID_EMPLOYEE AS NVARCHAR(50)) NOT IN (SELECT EmpleadoOriginalId FROM EMPLEADOS_ARCHIVADOS WHERE EmpleadoOriginalId IS NOT NULL)");
        const empleados = result.recordset.map(emp => ({
            _id: emp.ID_EMPLOYEE,
            id: emp.ID_EMPLOYEE,
            nombre: emp.NOMBRE,
            apellidos: emp.APELLIDOS,
            dni: emp.DNI,
            sexo: emp.GENERO,
            nacionalidad: emp.NACIONALIDAD,
            telefono: emp.TELEFONO,
            contactoEmergencia: emp.NOMBRE_CONTACTO,
            numeroEmergencia: emp.NUMERO_EMERGENCIA,
            fechaNacimiento: emp.FECHA_NACIMIENTO,
            direccion: emp.DIRECCION,
            cargo: emp.CARGO,
            departamento: emp.DEPARTAMENTO,
            tipoTrabajador: emp.TIPO_TRABAJADOR,
            regimenPensionario: emp.ENTIDAD_PREVISIONAL,
            sueldo: emp.SUELDO_BASE,
            calculoAfpMinimo: !!emp.DESCUENTO_AFP_MINIMO,
            fechaInicio: emp.FECHA_INGRESO,
            fechaFinContrato: emp.FECHA_FIN_CONTRATO,
            horarioTrabajo: emp.JORNADA_LABORAL,
            banco: emp.BANCO,
            tipoCuenta: emp.TIPO_CUENTA,
            numeroCuenta: emp.NUMERO_CUENTA,
            cci: emp.CCI,
            email: emp.CORREO,
            estado: 'Inactivo',
            tabla: 'EMPLOYEES'
        }));

        const resultArchived = await pool.request().query('SELECT * FROM EMPLEADOS_ARCHIVADOS');
        const historicosMongo = resultArchived.recordset.map(emp => ({
            _id: emp.MongoId || emp.Id,
            id: emp.Id,
            nombre: emp.Nombre,
            apellidos: emp.Apellido,
            dni: (emp.DNI === '-' ? null : emp.DNI) || null,
            sexo: (emp.GENERO === '-' ? null : emp.GENERO) || null,
            nacionalidad: (emp.NACIONALIDAD === '-' ? null : emp.NACIONALIDAD) || null,
            telefono: (emp.Telefono === '-' ? null : emp.Telefono) || null,
            contactoEmergencia: (emp.NOMBRE_CONTACTO === '-' ? null : emp.NOMBRE_CONTACTO) || null,
            numeroEmergencia: (emp.NUMERO_EMERGENCIA === '-' ? null : emp.NUMERO_EMERGENCIA) || null,
            fechaNacimiento: (emp.FECHA_NACIMIENTO === '-' ? null : emp.FECHA_NACIMIENTO) || null,
            direccion: (emp.DIRECCION === '-' ? null : emp.DIRECCION) || null,
            cargo: emp.Cargo,
            departamento: emp.Departamento,
            tipoTrabajador: emp.Tipo,
            regimenPensionario: (emp.ENTIDAD_PREVISIONAL === '-' ? null : emp.ENTIDAD_PREVISIONAL) || null,
            sueldo: emp.Sueldo,
            calculoAfpMinimo: !!emp.DESCUENTO_AFP_MINIMO,
            fechaInicio: (emp.FECHA_INGRESO === '-' ? null : emp.FECHA_INGRESO) || null,
            fechaFinContrato: emp.FechaArchivado,
            horarioTrabajo: (emp.JORNADA_LABORAL === '-' ? null : emp.JORNADA_LABORAL) || null,
            banco: (emp.BANCO === '-' ? null : emp.BANCO) || null,
            tipoCuenta: (emp.TIPO_CUENTA === '-' ? null : emp.TIPO_CUENTA) || null,
            numeroCuenta: (emp.NUMERO_CUENTA === '-' ? null : emp.NUMERO_CUENTA) || null,
            cci: (emp.CCI === '-' ? null : emp.CCI) || null,
            email: (emp.Correo === '-' ? null : emp.Correo) || null,
            estado: 'Inactivo (Histórico)',
            motivo: emp.Motivo,
            tabla: 'EMPLEADOS_ARCHIVADOS'
        }));

        const allArchived = [...empleados, ...historicosMongo];

        allArchived.sort((a, b) => {
            const dateA = a.fechaFinContrato ? new Date(a.fechaFinContrato).getTime() : 0;
            const dateB = b.fechaFinContrato ? new Date(b.fechaFinContrato).getTime() : 0;
            return dateB - dateA;
        });

        res.json(allArchived);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener empleados archivados' });
    }
});

app.delete('/api/empleados-archivados/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { tabla } = req.query;
        const pool = await poolPlanilla;

        if (tabla === 'EMPLOYEES') {
            await pool.request()
                .input('id', mssql.Int, id)
                .query('DELETE FROM EMPLOYEES WHERE ID_EMPLOYEE = @id');
        } else if (tabla === 'EMPLEADOS_ARCHIVADOS') {
            await pool.request()
                .input('id', mssql.Int, id)
                .query('DELETE FROM EMPLEADOS_ARCHIVADOS WHERE Id = @id');
        } else {
            return res.status(400).json({ error: 'Tabla no válida especificada' });
        }

        res.json({ message: 'Empleado eliminado permanentemente' });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar empleado' });
    }
});

app.post('/api/empleados', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        const data = req.body;

        const checkDni = await pool.request()
            .input('dni', mssql.VarChar(8), data.dni)
            .query('SELECT NOMBRE FROM EMPLOYEES WHERE DNI = @dni');

        if (checkDni.recordset.length > 0) {
            return res.status(400).json({ error: 'El empleado con este DNI ya está registrado.' });
        }

        const request = pool.request();
        request.input('nombre', mssql.VarChar(100), data.nombre);
        request.input('apellidos', mssql.VarChar(100), data.apellidos);
        request.input('dni', mssql.VarChar(20), data.dni);
        request.input('genero', mssql.VarChar(50), data.sexo || null);
        request.input('nac', mssql.VarChar(100), data.nacionalidad || null);
        request.input('tel', mssql.VarChar(50), data.telefono || null);
        request.input('nomCont', mssql.VarChar(200), data.contactoEmergencia || null);
        request.input('numEmerg', mssql.VarChar(50), data.numeroEmergencia || null);
        request.input('fechaNac', mssql.Date, data.fechaNacimiento ? new Date(data.fechaNacimiento) : null);
        request.input('dir', mssql.VarChar(255), data.direccion || null);
        request.input('cargo', mssql.VarChar(100), data.cargo || null);
        request.input('dept', mssql.VarChar(100), data.departamento || null);
        request.input('tipo', mssql.VarChar(50), data.tipoTrabajador || 'PLANILLA');
        request.input('sueldo', mssql.Decimal(10, 2), data.sueldo || 0);
        request.input('entPrevis', mssql.VarChar(100), data.regimenPensionario || 'SNP/ONP');
        request.input('descAfpMin', mssql.Bit, data.calculoAfpMinimo ? 1 : 0);
        request.input('jorLab', mssql.VarChar(100), data.horarioTrabajo || null);
        request.input('fechaIng', mssql.Date, data.fechaInicio ? new Date(data.fechaInicio) : null);
        request.input('fechaFin', mssql.Date, data.fechaFinContrato ? new Date(data.fechaFinContrato) : null);
        request.input('correo', mssql.VarChar(150), data.email || null);
        request.input('banco', mssql.VarChar(100), data.banco || null);
        request.input('tipoCta', mssql.VarChar(50), data.tipoCuenta || null);
        request.input('numCta', mssql.VarChar(50), data.numeroCuenta || null);
        request.input('cci', mssql.VarChar(50), data.cci || null);
        request.input('biometricId', mssql.Int, data.biometricId || null);
        request.input('entryTime', mssql.VarChar(10), data.entryTime || null);
        request.input('exitTime', mssql.VarChar(10), data.exitTime || null);
        request.input('activo', mssql.Bit, 1);

        const query = `
            INSERT INTO EMPLOYEES (
                NOMBRE, APELLIDOS, DNI, GENERO, NACIONALIDAD, TELEFONO, NOMBRE_CONTACTO, 
                NUMERO_EMERGENCIA, FECHA_NACIMIENTO, DIRECCION, CARGO, DEPARTAMENTO, 
                TIPO_TRABAJADOR, SUELDO_BASE, ENTIDAD_PREVISIONAL, DESCUENTO_AFP_MINIMO,
                JORNADA_LABORAL, FECHA_INGRESO, FECHA_FIN_CONTRATO, CORREO, BANCO, 
                TIPO_CUENTA, NUMERO_CUENTA, CCI, BIOMETRIC_ID, ENTRY_TIME, EXIT_TIME, ACTIVO
            )
            OUTPUT INSERTED.*
            VALUES (
                @nombre, @apellidos, @dni, @genero, @nac, @tel, @nomCont, 
                @numEmerg, @fechaNac, @dir, @cargo, @dept, @tipo, @sueldo, @entPrevis,
                @descAfpMin, @jorLab, @fechaIng, @fechaFin, @correo, @banco, @tipoCta, @numCta, @cci, @biometricId, @entryTime, @exitTime, @activo
            )
        `;

        const result = await request.query(query);
        const saved = result.recordset[0];

        // Sincronizar automáticamente con la máquina biométrica si el usuario marcó la casilla
        if (data.syncToBiometric && saved.BIOMETRIC_ID) {
            pushUserToDevice(saved.BIOMETRIC_ID, saved.NOMBRE, saved.APELLIDOS);
        }

        res.status(201).json({
            _id: saved.ID_EMPLOYEE,
            ...saved
        });
    } catch (error) {
        res.status(500).json({ error: 'Error al guardar empleado', details: error.message });
    }
});

app.put('/api/empleados/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const pool = await poolPlanilla;
        const data = req.body;

        const request = pool.request();
        request.input('id', mssql.Int, id);
        request.input('nombre', mssql.VarChar(100), data.nombre);
        request.input('apellidos', mssql.VarChar(100), data.apellidos);
        request.input('dni', mssql.VarChar(20), data.dni);
        request.input('genero', mssql.VarChar(50), data.sexo || null);
        request.input('nac', mssql.VarChar(100), data.nacionalidad || null);
        request.input('tel', mssql.VarChar(50), data.telefono || null);
        request.input('nomCont', mssql.VarChar(200), data.contactoEmergencia || null);
        request.input('numEmerg', mssql.VarChar(50), data.numeroEmergencia || null);
        request.input('fechaNac', mssql.Date, data.fechaNacimiento ? new Date(data.fechaNacimiento) : null);
        request.input('dir', mssql.VarChar(255), data.direccion || null);
        request.input('cargo', mssql.VarChar(100), data.cargo || null);
        request.input('dept', mssql.VarChar(100), data.departamento || null);
        request.input('tipo', mssql.VarChar(50), data.tipoTrabajador || 'PLANILLA');
        request.input('sueldo', mssql.Decimal(10, 2), data.sueldo || 0);
        request.input('entPrevis', mssql.VarChar(100), data.regimenPensionario || 'SNP');
        request.input('descAfpMin', mssql.Bit, data.calculoAfpMinimo ? 1 : 0);
        request.input('jorLab', mssql.VarChar(100), data.horarioTrabajo || null);
        request.input('fechaIng', mssql.Date, data.fechaInicio ? new Date(data.fechaInicio) : null);
        request.input('fechaFin', mssql.Date, data.fechaFinContrato ? new Date(data.fechaFinContrato) : null);
        request.input('correo', mssql.VarChar(150), data.email || null);
        request.input('banco', mssql.VarChar(100), data.banco || null);
        request.input('tipoCta', mssql.VarChar(50), data.tipoCuenta || null);
        request.input('numCta', mssql.VarChar(50), data.numeroCuenta || null);
        request.input('cci', mssql.VarChar(50), data.cci || null);
        request.input('biometricId', mssql.Int, data.biometricId || null);
        request.input('entryTime', mssql.VarChar(10), data.entryTime || null);
        request.input('exitTime', mssql.VarChar(10), data.exitTime || null);

        await request.query(`
            UPDATE EMPLOYEES 
            SET NOMBRE = @nombre, APELLIDOS = @apellidos, DNI = @dni, GENERO = @genero, 
                NACIONALIDAD = @nac, TELEFONO = @tel, NOMBRE_CONTACTO = @nomCont,
                NUMERO_EMERGENCIA = @numEmerg, FECHA_NACIMIENTO = @fechaNac, DIRECCION = @dir,
                CARGO = @cargo, DEPARTAMENTO = @dept, TIPO_TRABAJADOR = @tipo, 
                SUELDO_BASE = @sueldo, ENTIDAD_PREVISIONAL = @entPrevis,
                DESCUENTO_AFP_MINIMO = @descAfpMin, JORNADA_LABORAL = @jorLab,
                FECHA_INGRESO = @fechaIng, FECHA_FIN_CONTRATO = @fechaFin, 
                CORREO = @correo, BANCO = @banco, TIPO_CUENTA = @tipoCta, 
                NUMERO_CUENTA = @numCta, CCI = @cci,
                BIOMETRIC_ID = @biometricId, ENTRY_TIME = @entryTime, EXIT_TIME = @exitTime
            WHERE ID_EMPLOYEE = @id
        `);

        // Sincronizar con la máquina biométrica si el usuario marcó la casilla
        if (data.syncToBiometric && data.biometricId) {
            pushUserToDevice(data.biometricId, data.nombre, data.apellidos);
        }

        res.json({ message: 'Empleado actualizado correctamente' });
    } catch (error) {
        res.status(500).json({ error: 'Error al actualizar empleado' });
    }
});

app.get('/api/planilla-borrador', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        const now = new Date();
        const currentMes = (now.getMonth() + 1).toString().padStart(2, '0');
        const currentAnio = now.getFullYear();
        const queryMes = `${currentAnio}-${currentMes}`;

        const result = await pool.request()
            .input('mes', mssql.VarChar, currentMes)
            .input('anio', mssql.Int, currentAnio)
            .input('queryMes', mssql.VarChar, queryMes)
            .query(`
            SELECT e.*, 
                   ISNULL(pb.HORAS_EXTRAS, 0) as HORAS_EXTRAS,
                   ISNULL(pb.FALTAS_DIAS, 0) as FALTAS_DIAS,
                   ISNULL(pb.FALTAS_HORAS, 0) as FALTAS_HORAS,
                   ISNULL(pb.DESCUENTO_ADICIONAL, 0) as DESCUENTO_ADICIONAL,
                   pb.DESCUENTOS_JSON,
                   pb.BONOS_JSON,
                   pb.OBSERVACIONES as BORRADOR_OBSERVACIONES,
                   (SELECT ISNULL(SUM(Monto), 0) FROM ADVANCES 
                    WHERE NombreEmpleado = (e.NOMBRE + ' ' + e.APELLIDOS) 
                    AND Tipo = 'ADELANTO' AND (Mes = @mes OR Mes = @queryMes) AND (Anio = @anio OR Anio IS NULL)) as TOTAL_ADELANTO,
                   (SELECT ISNULL(SUM(Monto), 0) FROM ADVANCES 
                    WHERE NombreEmpleado = (e.NOMBRE + ' ' + e.APELLIDOS) 
                    AND Tipo = 'PRESTAMO' AND (Mes = @mes OR Mes = @queryMes) AND (Anio = @anio OR Anio IS NULL)) as TOTAL_PRESTAMO,
                    (SELECT TOP 1 CAST(NumeroAdelanto AS VARCHAR) + '/' + ISNULL(CAST(TotalCuotas AS VARCHAR), '?') 
                     FROM ADVANCES 
                     WHERE NombreEmpleado = (e.NOMBRE + ' ' + e.APELLIDOS) 
                     AND Tipo = 'PRESTAMO' AND (Mes = @mes OR Mes = @queryMes) AND (Anio = @anio OR Anio IS NULL)
                     ORDER BY CreatedAt DESC) as CUOTA_DETALLE,
                   ISNULL(pb.ESTADO, 'PENDIENTE') as ESTADO,
                   pb.ULTIMA_MODIFICACION,
                   (SELECT ISNULL(SUM(CASE WHEN TOTAL_HOURS > 8 THEN TOTAL_HOURS - 8 ELSE 0 END), 0) FROM ATTENDANCE_DAILY_REPORTS 
                    WHERE ID_EMPLOYEE = e.ID_EMPLOYEE 
                    AND MONTH(DATE) = CAST(@mes AS INT) AND YEAR(DATE) = @anio) as ASISTENCIA_HORAS_EXTRA
            FROM EMPLOYEES e
            LEFT JOIN PLANILLA_BORRADOR pb ON e.ID_EMPLOYEE = pb.ID_EMPLOYEE
            WHERE e.ACTIVO = 1 OR e.ACTIVO IS NULL
        `);

        const empleados = result.recordset.map(emp => {
            const now = new Date();
            const currentMonthIdx = now.getMonth();
            const currentYear = now.getFullYear();

            const pbDate = emp.ULTIMA_MODIFICACION ? new Date(emp.ULTIMA_MODIFICACION) : null;
            const isOldMonth = pbDate && (pbDate.getMonth() !== currentMonthIdx || pbDate.getFullYear() !== currentYear);

            let descuentosAdicionales = [];
            try {
                if (emp.DESCUENTOS_JSON) {
                    descuentosAdicionales = JSON.parse(emp.DESCUENTOS_JSON);
                    if (isOldMonth) {
                        descuentosAdicionales = descuentosAdicionales.filter(d => {
                            if (!d.fecha) return false;
                            const dd = new Date(d.fecha);
                            return dd.getMonth() === currentMonthIdx && dd.getFullYear() === currentYear;
                        });
                    }
                }
            } catch (e) { }

            let bonosDetalle = [];
            try {
                if (emp.BONOS_JSON) {
                    bonosDetalle = JSON.parse(emp.BONOS_JSON);
                    if (isOldMonth) {
                        bonosDetalle = bonosDetalle.filter(b => {
                            if (b.permanente) return true;
                            if (!b.fecha) return false;
                            const bd = new Date(b.fecha);
                            return bd.getMonth() === currentMonthIdx && bd.getFullYear() === currentYear;
                        });
                    }
                }
            } catch (e) { }

            const horasExtras = isOldMonth ? 0 : (emp.HORAS_EXTRAS || 0);
            const faltasDias = isOldMonth ? 0 : (emp.FALTAS_DIAS || 0);
            const faltasHoras = isOldMonth ? 0 : (emp.FALTAS_HORAS || 0);
            const descuentoAdicional = isOldMonth
                ? descuentosAdicionales.reduce((sum, d) => sum + (Number(d.monto) || 0), 0)
                : (emp.DESCUENTO_ADICIONAL || 0);
            const estado = isOldMonth ? 'PENDIENTE' : (emp.ESTADO || 'PENDIENTE');
            const observaciones = isOldMonth ? '' : (emp.BORRADOR_OBSERVACIONES || '');

            return {
                _id: emp.ID_EMPLOYEE,
                id: emp.ID_EMPLOYEE,
                nombre: emp.NOMBRE,
                apellidos: emp.APELLIDOS,
                cargo: emp.CARGO,
                tipoTrabajador: emp.TIPO_TRABAJADOR,
                regimenPensionario: emp.ENTIDAD_PREVISIONAL,
                sueldo: emp.SUELDO_BASE,
                calculoAfpMinimo: !!emp.DESCUENTO_AFP_MINIMO,
                estado: 'Activo', // Estado de contrato
                adelanto: emp.TOTAL_ADELANTO || 0,
                prestamo: emp.TOTAL_PRESTAMO || 0,
                faltasDias: faltasDias,
                faltasHoras: faltasHoras,
                horasExtras: horasExtras,
                descuentoAdicional: descuentoAdicional,
                descuentosAdicionales: descuentosAdicionales,
                bonosDetalle: bonosDetalle,
                cuotaDetalle: emp.CUOTA_DETALLE || '',
                planillaEstado: estado,
                observaciones: observaciones,
                asistenciaSugerida: emp.ASISTENCIA_HORAS_EXTRA || 0
            };
        });
        res.json(empleados);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener planilla borrador' });
    }
});

app.put('/api/planilla-borrador/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const data = req.body;
        const pool = await poolPlanilla;
        const request = pool.request();

        request.input('id', mssql.Int, id);
        request.input('horasExtras', mssql.Decimal(10, 2), data.horasExtras || 0);
        request.input('faltasDias', mssql.Int, data.faltasDias || 0);
        request.input('faltasHoras', mssql.Int, data.faltasHoras || 0);
        request.input('descuentoAdicional', mssql.Decimal(10, 2), data.descuentoAdicional || 0);
        request.input('descuentosJson', mssql.NVarChar(mssql.MAX), JSON.stringify(data.descuentosAdicionales || []));
        request.input('bonosJson', mssql.NVarChar(mssql.MAX), JSON.stringify(data.bonosDetalle || []));
        request.input('estado', mssql.VarChar(20), data.estado || 'PENDIENTE');
        request.input('obs', mssql.NVarChar(mssql.MAX), data.observaciones || '');

        await request.query(`
            IF EXISTS (SELECT 1 FROM PLANILLA_BORRADOR WHERE ID_EMPLOYEE = @id)
                UPDATE PLANILLA_BORRADOR 
                SET HORAS_EXTRAS = @horasExtras,
                    FALTAS_DIAS = @faltasDias,
                    FALTAS_HORAS = @faltasHoras,
                    DESCUENTO_ADICIONAL = @descuentoAdicional,
                    DESCUENTOS_JSON = @descuentosJson,
                    BONOS_JSON = @bonosJson,
                    ESTADO = @estado,
                    OBSERVACIONES = @obs,
                    ULTIMA_MODIFICACION = GETDATE()
                WHERE ID_EMPLOYEE = @id
            ELSE
                INSERT INTO PLANILLA_BORRADOR (ID_EMPLOYEE, HORAS_EXTRAS, FALTAS_DIAS, FALTAS_HORAS, DESCUENTO_ADICIONAL, DESCUENTOS_JSON, BONOS_JSON, ESTADO, OBSERVACIONES)
                VALUES (@id, @horasExtras, @faltasDias, @faltasHoras, @descuentoAdicional, @descuentosJson, @bonosJson, @estado, @obs)
        `);
        res.json({ message: 'Borrador actualizado correctamente' });
    } catch (error) {
        res.status(500).json({ error: 'Error al actualizar borrador' });
    }
});

app.delete('/api/planilla-borrador', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        await pool.request().query('DELETE FROM PLANILLA_BORRADOR');
        res.json({ message: 'Borrador limpiado correctamente' });
    } catch (error) {
        res.status(500).json({ error: 'Error al limpiar borrador' });
    }
});

app.put('/api/empleados/:id/reactivar', async (req, res) => {
    try {
        const { id } = req.params;
        const pool = await poolPlanilla;
        const data = req.body;

        const request = pool.request();
        request.input('id', mssql.Int, id);
        request.input('nombre', mssql.VarChar(100), data.nombre);
        request.input('apellidos', mssql.VarChar(100), data.apellidos);
        request.input('dni', mssql.VarChar(20), data.dni);
        request.input('genero', mssql.VarChar(50), data.sexo || null);
        request.input('nac', mssql.VarChar(100), data.nacionalidad || null);
        request.input('tel', mssql.VarChar(50), data.telefono || null);
        request.input('nomCont', mssql.VarChar(200), data.contactoEmergencia || null);
        request.input('numEmerg', mssql.VarChar(50), data.numeroEmergencia || null);
        request.input('fechaNac', mssql.Date, data.fechaNacimiento ? new Date(data.fechaNacimiento) : null);
        request.input('dir', mssql.VarChar(255), data.direccion || null);
        request.input('cargo', mssql.VarChar(100), data.cargo || null);
        request.input('dept', mssql.VarChar(100), data.departamento || null);
        request.input('tipo', mssql.VarChar(50), data.tipoTrabajador || 'PLANILLA');
        request.input('sueldo', mssql.Decimal(10, 2), data.sueldo || 0);
        request.input('entPrevis', mssql.VarChar(100), data.regimenPensionario || 'SNP/ONP');
        request.input('descAfpMin', mssql.Bit, data.calculoAfpMinimo ? 1 : 0);
        request.input('jorLab', mssql.VarChar(100), data.horarioTrabajo || null);
        request.input('fechaIng', mssql.Date, data.fechaInicio ? new Date(data.fechaInicio) : null);
        request.input('fechaFin', mssql.Date, null);
        request.input('correo', mssql.VarChar(150), data.email || null);
        request.input('banco', mssql.VarChar(100), data.banco || null);
        request.input('tipoCta', mssql.VarChar(50), data.tipoCuenta || null);
        request.input('numCta', mssql.VarChar(50), data.numeroCuenta || null);
        request.input('cci', mssql.VarChar(50), data.cci || null);
        request.input('activo', mssql.Bit, 1);

        const query = `
            UPDATE EMPLOYEES 
            SET NOMBRE = @nombre, APELLIDOS = @apellidos, DNI = @dni, GENERO = @genero, 
                NACIONALIDAD = @nac, TELEFONO = @tel, NOMBRE_CONTACTO = @nomCont, 
                NUMERO_EMERGENCIA = @numEmerg, FECHA_NACIMIENTO = @fechaNac, 
                DIRECCION = @dir, CARGO = @cargo, DEPARTAMENTO = @dept, 
                TIPO_TRABAJADOR = @tipo, SUELDO_BASE = @sueldo, 
                ENTIDAD_PREVISIONAL = @entPrevis, DESCUENTO_AFP_MINIMO = @descAfpMin,
                JORNADA_LABORAL = @jorLab, FECHA_INGRESO = @fechaIng, 
                FECHA_FIN_CONTRATO = @fechaFin, CORREO = @correo, BANCO = @banco, 
                TIPO_CUENTA = @tipoCta, NUMERO_CUENTA = @numCta, CCI = @cci, ACTIVO = @activo
            WHERE ID_EMPLOYEE = @id
        `;

        await request.query(query);
        res.json({ message: 'Empleado re-contratado exitosamente' });
    } catch (error) {
        res.status(500).json({ error: 'Error al re-contratar empleado' });
    }
});


app.delete('/api/empleados/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { motivo } = req.body;
        const pool = await poolPlanilla;

        const empRes = await pool.request()
            .input('id', mssql.Int, id)
            .query('SELECT * FROM EMPLOYEES WHERE ID_EMPLOYEE = @id');

        if (empRes.recordset.length === 0) {
            return res.status(404).json({ error: 'Empleado no encontrado' });
        }

        const emp = empRes.recordset[0];

        await pool.request()
            .input('idOriginal', mssql.Int, id)
            .input('nombre', mssql.NVarChar, emp.NOMBRE)
            .input('apellido', mssql.NVarChar, emp.APELLIDOS)
            .input('dni', mssql.NVarChar, emp.DNI)
            .input('sueldo', mssql.Decimal(18, 2), emp.SUELDO_BASE)
            .input('depto', mssql.NVarChar, emp.DEPARTAMENTO)
            .input('cargo', mssql.NVarChar, emp.CARGO)
            .input('tipo', mssql.NVarChar, emp.TIPO_TRABAJADOR)
            .input('telefono', mssql.NVarChar, emp.TELEFONO)
            .input('correo', mssql.NVarChar, emp.CORREO)
            .input('motivo', mssql.NVarChar, motivo || 'Sin motivo especificado')
            .query(`
                INSERT INTO EMPLEADOS_ARCHIVADOS (
                    EmpleadoOriginalId, Nombre, Apellido, Sueldo, Departamento, 
                    Cargo, Tipo, Telefono, Motivo, FechaArchivado, CreatedAt
                ) VALUES (
                    @idOriginal, @nombre, @apellido, @sueldo, @depto, 
                    @cargo, @tipo, @telefono, @motivo, GETDATE(), GETDATE()
                )
            `);
        await pool.request()
            .input('id', mssql.Int, id)
            .query("UPDATE EMPLOYEES SET ACTIVO = 0, FECHA_FIN_CONTRATO = GETDATE() WHERE ID_EMPLOYEE = @id");

        res.json({ message: 'Empleado dado de baja y archivado exitosamente' });
    } catch (error) {
        res.status(500).json({ error: 'Error al procesar la baja del empleado', details: error.message });
    }
});


app.get('/api/adelantos', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        const mes = parseInt(req.query.mes) || (new Date().getMonth() + 1);
        const anio = parseInt(req.query.anio) || new Date().getFullYear();

        const mesStr = mes.toString();
        const mesPad = mes.toString().padStart(2, '0');
        const yearMonth = `${anio}-${mesPad}`;

        const result = await pool.request()
            .input('mesStr', mssql.VarChar, mesStr)
            .input('mesPad', mssql.VarChar, mesPad)
            .input('anio', mssql.Int, anio)
            .input('yearMonth', mssql.VarChar, yearMonth)
            .query(`
                SELECT * FROM ADVANCES 
                WHERE Tipo = 'ADELANTO'
                AND (
                    (Mes IS NOT NULL AND (Mes = @mesStr OR Mes = @mesPad OR Mes = @yearMonth) AND (Anio = @anio OR Anio IS NULL))
                    OR (Mes IS NULL AND MONTH(CreatedAt) = ${mes} AND YEAR(CreatedAt) = ${anio})
                )
                ORDER BY CreatedAt DESC
            `);

        const mapped = result.recordset.map(r => ({
            _id: r.Id,
            dni: r.EmpleadoNumId,
            monto: r.Monto,
            observaciones: r.Observaciones,
            estado: r.Estado,
            tipo: r.Tipo,
            nombreEmpleado: r.NombreEmpleado,
            cargo: r.Cargo,
            departamento: r.Departamento,
            fecha: r.CreatedAt,
            esPrestamo: r.EsPrestamo,
            numeroAdelanto: r.NumeroAdelanto,
            mes: r.Mes,
            anio: r.Anio
        }));
        res.json(mapped);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener adelantos' });
    }
});

app.post('/api/adelantos', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        const data = req.body;
        const now = data.fecha ? new Date(data.fecha + 'T12:00:00Z') : new Date();
        const request = pool.request();
        request.input('dni', mssql.NVarChar, data.dni);
        request.input('monto', mssql.Decimal(18, 2), data.monto);
        request.input('obs', mssql.NVarChar, data.observaciones);
        request.input('estado', mssql.NVarChar, data.estado || 'PENDIENTE');
        request.input('tipo', mssql.NVarChar, data.tipo || 'ADELANTO');
        request.input('nombre', mssql.NVarChar, data.nombreEmpleado);
        request.input('cargo', mssql.NVarChar, data.cargo);
        request.input('dep', mssql.NVarChar, data.departamento);
        request.input('createdAt', mssql.DateTime, now);
        request.input('mes', mssql.VarChar, (now.getMonth() + 1).toString().padStart(2, '0'));
        request.input('anio', mssql.Int, now.getFullYear());

        await request.query(`
            INSERT INTO ADVANCES (EmpleadoNumId, Monto, Observaciones, Estado, Tipo, NombreEmpleado, Cargo, Departamento, CreatedAt, Mes, Anio)
            VALUES (@dni, @monto, @obs, @estado, @tipo, @nombre, @cargo, @dep, @createdAt, @mes, @anio)
        `);
        res.status(201).json({ message: 'Movimiento guardado' });
    } catch (error) {
        res.status(500).json({ error: 'Error al guardar movimiento' });
    }
});

app.delete('/api/adelantos/:id', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        await pool.request()
            .input('id', mssql.Int, req.params.id)
            .query('DELETE FROM ADVANCES WHERE Id = @id');
        res.json({ message: 'Eliminado de SQL' });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar' });
    }
});

app.get('/api/prestamos', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        const mes = parseInt(req.query.mes) || (new Date().getMonth() + 1);
        const anio = parseInt(req.query.anio) || new Date().getFullYear();
        const mesPad = mes.toString().padStart(2, '0');
        const yearMonth = `${anio}-${mesPad}`;

        const result = await pool.request()
            .input('mesPad', mssql.VarChar, mesPad)
            .input('anio', mssql.Int, anio)
            .input('yearMonth', mssql.VarChar, yearMonth)
            .query(`
                SELECT * FROM ADVANCES 
                WHERE Tipo = 'PRESTAMO' 
                AND (
                    (Mes IS NOT NULL AND (Mes = @mesPad OR Mes = @yearMonth) AND (Anio = @anio OR Anio IS NULL))
                    OR (Mes IS NULL AND MONTH(CreatedAt) = ${mes} AND YEAR(CreatedAt) = ${anio})
                )
                ORDER BY CreatedAt DESC
            `);

        const mapped = result.recordset.map(r => ({
            _id: r.Id,
            dni: r.EmpleadoNumId,
            monto: r.Monto,
            observaciones: r.Observaciones,
            estado: r.Estado,
            nombreEmpleado: r.NombreEmpleado,
            cargo: r.Cargo,
            fecha: r.CreatedAt,
            cuotaNumero: r.NumeroAdelanto,
            totalCuotas: r.TotalCuotas,
            esCuota: r.EsCuota,
            mes: r.Mes,
            anio: r.Anio
        }));
        res.json(mapped);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener prestamos' });
    }
});

app.post('/api/prestamos', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        const data = req.body;
        const now = data.fecha ? new Date(data.fecha + 'T12:00:00Z') : new Date();
        const cuotas = parseInt(data.cuotas) || 1;
        const montoTotal = parseFloat(data.monto);
        const montoPorCuota = Math.round((montoTotal / cuotas) * 100) / 100;

        for (let i = 1; i <= cuotas; i++) {
            const installmentDate = new Date(now.getFullYear(), now.getMonth() + (i - 1), 1);
            const instMes = (installmentDate.getMonth() + 1).toString().padStart(2, '0');
            const instAnio = installmentDate.getFullYear();

            const request = pool.request();
            request.input('dni', mssql.Int, parseInt(data.dni) || 0);
            request.input('monto', mssql.Decimal(18, 2), montoPorCuota);
            request.input('obs', mssql.NVarChar, data.observaciones || null);
            request.input('estado', mssql.NVarChar, 'PENDIENTE');
            request.input('nombre', mssql.NVarChar, data.nombreEmpleado);
            request.input('cargo', mssql.NVarChar, data.cargo);
            request.input('dep', mssql.NVarChar, data.departamento);
            request.input('mes', mssql.VarChar, instMes);
            request.input('anio', mssql.Int, instAnio);
            request.input('esPrestamo', mssql.Bit, 1);
            request.input('esCuota', mssql.Bit, cuotas > 1 ? 1 : 0);
            request.input('numAdelanto', mssql.Int, i);
            request.input('totalCuotas', mssql.Int, cuotas);
            request.input('createdAt', mssql.DateTime, installmentDate);

            await request.query(`
                INSERT INTO ADVANCES (EmpleadoNumId, Monto, Observaciones, Estado, Tipo, NombreEmpleado, Cargo, Departamento, CreatedAt, Mes, Anio, EsPrestamo, EsCuota, NumeroAdelanto, TotalCuotas)
                VALUES (@dni, @monto, @obs, @estado, 'PRESTAMO', @nombre, @cargo, @dep, @createdAt, @mes, @anio, @esPrestamo, @esCuota, @numAdelanto, @totalCuotas)
            `);
        }
        res.status(201).json({ message: `Prestamo guardado en ${cuotas} cuota(s)` });
    } catch (error) {
        res.status(500).json({ error: 'Error al guardar prestamo' });
    }
});

app.delete('/api/prestamos/:id', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        const id = req.params.id;
        const deleteAll = req.query.deleteAll === 'true';

        if (deleteAll) {
            const refResult = await pool.request()
                .input('id', mssql.Int, id)
                .query("SELECT EmpleadoNumId, Monto, ISNULL(Observaciones, '') as Obs, TotalCuotas, CAST(CreatedAt as DATE) as DateCreation FROM ADVANCES WHERE Id = @id");

            if (refResult.recordset.length > 0) {
                const ref = refResult.recordset[0];
                await pool.request()
                    .input('dni', mssql.NVarChar, ref.EmpleadoNumId ? ref.EmpleadoNumId.toString() : '')
                    .input('monto', mssql.Decimal(18, 2), ref.Monto)
                    .input('obs', mssql.NVarChar, ref.Obs)
                    .input('totalCuotas', mssql.Int, ref.TotalCuotas)
                    .input('dateCreation', mssql.Date, ref.DateCreation)
                    .query(`
                        DELETE FROM ADVANCES 
                        WHERE Tipo = 'PRESTAMO' 
                        AND EmpleadoNumId = @dni 
                        AND Monto = @monto 
                        AND ISNULL(Observaciones, '') = @obs 
                        AND TotalCuotas = @totalCuotas 
                        AND CAST(CreatedAt as DATE) = @dateCreation
                    `);
            }
        } else {
            await pool.request()
                .input('id', mssql.Int, id)
                .query('DELETE FROM ADVANCES WHERE Id = @id');
        }
        res.json({ message: 'Eliminado de SQL' });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar' });
    }
});

app.get('/api/movilidad', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        const mes = parseInt(req.query.mes) || (new Date().getMonth() + 1);
        const anio = parseInt(req.query.anio) || new Date().getFullYear();
        const mesPad = mes.toString().padStart(2, '0');
        const yearMonth = `${anio}-${mesPad}`;

        const result = await pool.request()
            .input('mesPad', mssql.VarChar, mesPad)
            .input('anio', mssql.Int, anio)
            .input('yearMonth', mssql.VarChar, yearMonth)
            .query(`
                SELECT * FROM ADVANCES 
                WHERE Tipo = 'MOVILIDAD' 
                AND (
                    (Mes IS NOT NULL AND (Mes = @mesPad OR Mes = @yearMonth) AND (Anio = @anio OR Anio IS NULL))
                    OR (Mes IS NULL AND MONTH(CreatedAt) = ${mes} AND YEAR(CreatedAt) = ${anio})
                )
                ORDER BY CreatedAt DESC
            `);

        const mapped = result.recordset.map(r => ({
            _id: r.Id,
            dni: r.EmpleadoNumId,
            monto: r.Monto,
            observaciones: r.Observaciones,
            estado: r.Estado,
            nombreEmpleado: r.NombreEmpleado,
            fecha: r.CreatedAt,
            mes: r.Mes,
            anio: r.Anio
        }));
        res.json(mapped);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener movilidad' });
    }
});

app.post('/api/movilidad', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        const data = req.body;
        const now = data.fecha ? new Date(data.fecha + 'T12:00:00Z') : new Date();
        const request = pool.request();
        request.input('dni', mssql.NVarChar, data.dni);
        request.input('monto', mssql.Decimal(18, 2), data.monto);
        request.input('obs', mssql.NVarChar, data.observaciones);
        request.input('estado', mssql.NVarChar, data.estado || 'PENDIENTE');
        request.input('nombre', mssql.NVarChar, data.nombreEmpleado);
        request.input('cargo', mssql.NVarChar, data.cargo);
        request.input('dep', mssql.NVarChar, data.departamento);
        request.input('mes', mssql.VarChar, (now.getMonth() + 1).toString().padStart(2, '0'));
        request.input('anio', mssql.Int, now.getFullYear());
        request.input('createdAt', mssql.DateTime, now);

        await request.query(`
            INSERT INTO ADVANCES (EmpleadoNumId, Monto, Observaciones, Estado, Tipo, NombreEmpleado, Cargo, Departamento, CreatedAt, Mes, Anio)
            VALUES (@dni, @monto, @obs, @estado, 'MOVILIDAD', @nombre, @cargo, @dep, @createdAt, @mes, @anio)
        `);
        res.status(201).json({ message: 'Movilidad guardada' });
    } catch (error) {
        res.status(500).json({ error: 'Error al guardar movilidad' });
    }
});

app.delete('/api/movilidad/:id', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        await pool.request()
            .input('id', mssql.Int, req.params.id)
            .query('DELETE FROM ADVANCES WHERE Id = @id');
        res.json({ message: 'Eliminado de SQL' });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar' });
    }
});

app.get('/api/viaticos', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        const mes = parseInt(req.query.mes) || (new Date().getMonth() + 1);
        const anio = parseInt(req.query.anio) || new Date().getFullYear();
        const mesPad = mes.toString().padStart(2, '0');
        const yearMonth = `${anio}-${mesPad}`;

        const result = await pool.request()
            .input('mesPad', mssql.VarChar, mesPad)
            .input('anio', mssql.Int, anio)
            .input('yearMonth', mssql.VarChar, yearMonth)
            .query(`
                SELECT * FROM ADVANCES 
                WHERE Tipo = 'VIATICO' 
                AND (
                    (Mes IS NOT NULL AND (Mes = @mesPad OR Mes = @yearMonth) AND (Anio = @anio OR Anio IS NULL))
                    OR (Mes IS NULL AND MONTH(CreatedAt) = ${mes} AND YEAR(CreatedAt) = ${anio})
                )
                ORDER BY CreatedAt DESC
            `);

        const mapped = result.recordset.map(r => ({
            _id: r.Id,
            dni: r.EmpleadoNumId,
            monto: r.Monto,
            observaciones: r.Observaciones,
            estado: r.Estado,
            nombreEmpleado: r.NombreEmpleado,
            fecha: r.CreatedAt,
            mes: r.Mes,
            anio: r.Anio
        }));
        res.json(mapped);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener viaticos' });
    }
});

app.post('/api/viaticos', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        const data = req.body;
        const now = data.fecha ? new Date(data.fecha + 'T12:00:00Z') : new Date();
        const request = pool.request();
        request.input('dni', mssql.NVarChar, data.dni);
        request.input('monto', mssql.Decimal(18, 2), data.monto);
        request.input('obs', mssql.NVarChar, data.observaciones);
        request.input('estado', mssql.NVarChar, data.estado || 'PENDIENTE');
        request.input('nombre', mssql.NVarChar, data.nombreEmpleado);
        request.input('cargo', mssql.NVarChar, data.cargo);
        request.input('dep', mssql.NVarChar, data.departamento);
        request.input('mes', mssql.VarChar, (now.getMonth() + 1).toString().padStart(2, '0'));
        request.input('anio', mssql.Int, now.getFullYear());
        request.input('createdAt', mssql.DateTime, now);

        await request.query(`
            INSERT INTO ADVANCES (EmpleadoNumId, Monto, Observaciones, Estado, Tipo, NombreEmpleado, Cargo, Departamento, CreatedAt, Mes, Anio)
            VALUES (@dni, @monto, @obs, @estado, 'VIATICO', @nombre, @cargo, @dep, @createdAt, @mes, @anio)
        `);
        res.status(201).json({ message: 'Viatico guardado' });
    } catch (error) {
        res.status(500).json({ error: 'Error al guardar viatico' });
    }
});

app.delete('/api/viaticos/:id', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        await pool.request()
            .input('id', mssql.Int, req.params.id)
            .query('DELETE FROM ADVANCES WHERE Id = @id');
        res.json({ message: 'Eliminado de SQL' });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar' });
    }
});


app.post('/api/historial-pago', async (req, res) => {
    try {
        const { periodo, mes, año, empleados } = req.body;
        const pool = await poolPlanilla;

        const transaction = new mssql.Transaction(pool);
        await transaction.begin();

        try {
            const deleteRequest = new mssql.Request(transaction);
            deleteRequest.input('periodo', mssql.NVarChar, periodo);
            await deleteRequest.query('DELETE FROM HistorialPagos WHERE Periodo = @periodo');

            for (const emp of empleados) {
                const insertRequest = new mssql.Request(transaction);
                insertRequest.input('nombres', mssql.NVarChar, emp.nombre + (emp.apellidos ? ' ' + emp.apellidos : ''));
                insertRequest.input('cargo', mssql.NVarChar, emp.cargo);
                insertRequest.input('tipo', mssql.NVarChar, emp.tipoTrabajador);
                insertRequest.input('sueldo', mssql.Decimal(18, 2), emp.sueldo);
                insertRequest.input('bonos', mssql.Decimal(18, 2), emp.bonos);
                insertRequest.input('hrsExtra', mssql.Decimal(18, 2), emp.montoHorasExtras);
                insertRequest.input('afp', mssql.Decimal(18, 2), emp.descuentoAfp);
                insertRequest.input('adelanto', mssql.Decimal(18, 2), emp.adelanto);
                insertRequest.input('prestamo', mssql.Decimal(18, 2), emp.prestamo);
                insertRequest.input('faltas', mssql.Decimal(18, 2), emp.montoFaltas);
                insertRequest.input('adic', mssql.Decimal(18, 2), emp.descuentoAdicional);
                insertRequest.input('totalDesc', mssql.Decimal(18, 2), emp.totalDescuento);
                insertRequest.input('neto', mssql.Decimal(18, 2), emp.remuneracionNeta);
                insertRequest.input('obs', mssql.NVarChar, emp.observaciones || null);
                insertRequest.input('estado', mssql.NVarChar, emp.estado || null);
                insertRequest.input('periodo', mssql.NVarChar, periodo);

                await insertRequest.query(`
                    INSERT INTO HistorialPagos (Nombres, Cargo, Tipo, SueldoBase, Bonos, HrsExtra, PensionAFP, Adelanto, Prestamo, Faltas, DescAdic, TotalDesc, NetoAPagar, Observaciones, Estado, Periodo)
                    VALUES (@nombres, @cargo, @tipo, @sueldo, @bonos, @hrsExtra, @afp, @adelanto, @prestamo, @faltas, @adic, @totalDesc, @neto, @obs, @estado, @periodo)
                `);
            }

            await transaction.commit();
            res.status(201).json({ message: 'Planilla guardada correctamente en SQL Server' });
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (error) {
        res.status(500).json({ error: 'Error al guardar historial de pago en SQL Server' });
    }
});


app.get('/api/historial-pago', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        const result = await pool.request().query('SELECT DISTINCT Periodo FROM HistorialPagos ORDER BY Periodo DESC');

        const periods = result.recordset.map(row => row.Periodo);

        const formattedPeriods = periods.map(p => {
            if (!p || typeof p !== 'string' || !p.includes('-')) return null;
            const [year, month] = p.split('-');
            const monthNames = [
                'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
                'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'
            ];
            const monthIndex = parseInt(month) - 1;
            return {
                periodo: p,
                mes: monthNames[monthIndex] || 'Desconocido',
                año: parseInt(year),
                estado: 'GUARDADA'
            };
        }).filter(p => p !== null);

        res.json(formattedPeriods);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener historial desde SQL Server' });
    }
});


app.get('/api/historial-pago/:periodo', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        const result = await pool.request()
            .input('periodo', mssql.NVarChar, req.params.periodo)
            .query('SELECT * FROM HistorialPagos WHERE Periodo = @periodo');

        const docs = result.recordset;

        if (docs.length === 0) return res.status(404).json({ error: 'No se encontró planilla para este periodo en SQL Server' });

        const [year, month] = req.params.periodo.split('-');
        const monthNames = [
            'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
            'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
        ];

        const payrollData = {
            periodo: req.params.periodo,
            mes: monthNames[parseInt(month) - 1],
            año: parseInt(year),
            empleados: docs.map(d => ({
                empleadoId: d.Id,
                nombre: d.Nombres,
                apellidos: d.Apellidos || null,
                cargo: d.Cargo,
                tipoTrabajador: d.Tipo,
                sueldo: d.SueldoBase,
                bonos: d.Bonos,
                montoHorasExtras: d.HrsExtra,
                descuentoAfp: d.PensionAFP,
                adelanto: d.Adelanto,
                prestamo: d.Prestamo,
                montoFaltas: d.Faltas,
                descuentoAdicional: d.DescAdic,
                totalDescuento: d.TotalDesc,
                remuneracionNeta: d.NetoAPagar,
                observaciones: d.Observaciones || null,
                estado: d.Estado || null
            }))
        };

        res.json(payrollData);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener detalle del historial desde SQL Server' });
    }
});


import { getSecret } from './utils/secrets.js';

const WHMCS_API_URL = getSecret('whmcs_api_url', 'http://cliente.hwperu.com/includes/api.php');
const WHMCS_IDENTIFIER = getSecret('whmcs_identifier', 'Pb55YUTQVfK73P5U1xLu9yF0jbKvZTeq');
const WHMCS_SECRET = getSecret('whmcs_secret', 'hu8U5fQ80TVCHMW4ZBwBR7mYi1Iuw7HR');

const CUENTAS_DESTINO = {
    '2003002697856': 'INTERBANK',
    '1939839336030': 'BCP'
};

function identifyBankFromText(text) {
    const banks = identifyAllBanks(text);
    return banks.length > 0 ? banks[0] : null;
}

function identifyAllBanks(text) {
    if (!text) return [];
    const t = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const identified = [];

    if (t.includes('yape')) identified.push('Yape');
    if (t.includes('plin')) identified.push('Plin');

    if (t.includes('bcp') || t.includes('credito') || t.includes('1939839336030') || t.includes('viabcp')) identified.push('BCP');
    if (t.includes('interbank') || t.includes('ibk') || t.includes('ibnk') || t.includes('2003002697856')) identified.push('INTERBANK');
    if (t.includes('bbva') || t.includes('continental') || t.includes('0011')) identified.push('BBVA');
    if (t.includes('izipay') || t.includes('pos')) identified.push('Izipay');
    if (t.includes('paypal')) identified.push('PayPal');
    if (t.includes('caja') || t.includes('efectivo')) identified.push('Efectivo');

    return [...new Set(identified)];
}

async function getWhmcsInvoiceDetails(invoiceId) {
    const params = new URLSearchParams();
    params.append('identifier', WHMCS_IDENTIFIER);
    params.append('secret', WHMCS_SECRET);
    params.append('action', 'GetInvoice');
    params.append('invoiceid', invoiceId.toString());
    params.append('responsetype', 'json');

    try {
        const res = await axios.post(WHMCS_API_URL, params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        return res.data;
    } catch (err) {
        return null;
    }
}

async function getWhmcsClientDetails(clientId) {
    if (!clientId) return null;
    const params = new URLSearchParams();
    params.append('identifier', WHMCS_IDENTIFIER);
    params.append('secret', WHMCS_SECRET);
    params.append('action', 'GetClientsDetails');
    params.append('clientid', clientId.toString());
    params.append('responsetype', 'json');

    try {
        const res = await axios.post(WHMCS_API_URL, params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        return res.data;
    } catch (err) {
        return null;
    }
}

function mapBankToDebitAccount(bank) {
    if (!bank) return '1031';
    const b = bank.toUpperCase();
    if (b === 'BCP' || b === 'INTERBANK' || b === 'BBVA') return '1041';
    if (b === 'IZIPAY' || b === 'PAYPAL') return '1031';
    if (b === 'CAJA VIRTUAL') return '1011';
    return '1031';
}

export async function syncWhmcsInvoices(targetMonth = null, targetYear = null) {
    const now = new Date();
    const currentYear = targetYear || now.getFullYear();
    const currentMonth = targetMonth !== null ? (targetMonth - 1) : now.getMonth();

    try {
        const targetMonthStr = `${currentYear}-${(currentMonth + 1).toString().padStart(2, '0')}`;

        const txParams = new URLSearchParams();
        txParams.append('identifier', WHMCS_IDENTIFIER);
        txParams.append('secret', WHMCS_SECRET);
        txParams.append('action', 'GetTransactions');
        txParams.append('limitnum', '2000');
        txParams.append('responsetype', 'json');

        const txRes = await axios.post(WHMCS_API_URL, txParams, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        if (!txRes.data.transactions || !txRes.data.transactions.transaction) {
            return;
        }

        const allTrans = Array.isArray(txRes.data.transactions.transaction) ? txRes.data.transactions.transaction : [txRes.data.transactions.transaction];
        const marchTrans = allTrans.filter(t => t.date.startsWith(targetMonthStr));

        if (marchTrans.length === 0) {
            return;
        }

        const totalGrossPEN = marchTrans.reduce((sum, t) => {
            const amt = parseFloat(t.amountin || 0);
            const r = parseFloat(t.rate || 1);
            return sum + (r > 0 ? (amt / r) : amt);
        }, 0);

        const invoiceIds = [...new Set(marchTrans.map(t => parseInt(t.invoiceid)).filter(id => id > 0))];

        const pool = await poolFinance;
        let syncedCount = 0;

        const chunkSize = 10;
        for (let i = 0; i < invoiceIds.length; i += chunkSize) {
            const chunk = invoiceIds.slice(i, i + chunkSize);
            await Promise.all(chunk.map(async (invId) => {
                try {
                    const detRes = await getWhmcsInvoiceDetails(invId);
                    if (!detRes || detRes.result !== 'success') return;

                    const invBase = detRes;
                    const invoiceTxsInPeriod = marchTrans.filter(t => parseInt(t.invoiceid) === invId);

                    const totalMonthPENForInvoice = invoiceTxsInPeriod.reduce((sum, t) => {
                        const amt = parseFloat(t.amountin || 0);
                        const r = parseFloat(t.rate || 1);
                        return sum + (r > 0 ? (amt / r) : amt);
                    }, 0);

                    const clientData = invBase.clientdetails || invBase;
                    let fullName = `${clientData.firstname || ''} ${clientData.lastname || ''}`.trim();
                    let companyDisp = (clientData.companyname && clientData.companyname.trim()) ? clientData.companyname.trim() : null;

                    if (!fullName && !companyDisp && invBase.userid) {
                        const clientRes = await getWhmcsClientDetails(invBase.userid);
                        if (clientRes && clientRes.result === 'success') {
                            fullName = `${clientRes.firstname || ''} ${clientRes.lastname || ''}`.trim();
                            companyDisp = (clientRes.companyname && clientRes.companyname.trim()) ? clientRes.companyname.trim() : null;
                        }
                    }

                    const clienteName = fullName || companyDisp || 'Cliente WHMCS';

                    const invItems = invBase.items?.item || [];
                    let firstItem = invItems[0]?.description || 'Servicio WHMCS';
                    const techKeywords = ['IP Adicionales:', 'Sistema Operativo:', 'Pre-Instalación:', 'Ubicación:', 'Panel de Control:'];
                    for (const kw of techKeywords) {
                        if (firstItem.includes(kw)) firstItem = firstItem.split(kw)[0].trim();
                    }
                    firstItem = firstItem.split('\n')[0].trim();

                    let cat = 'Otros';
                    const allItemsText = invItems.map(i => (i.description || '').toLowerCase()).join(' ');
                    const allItemsTypes = invItems.map(i => (i.type || '').toLowerCase());
                    const hasHosting = allItemsText.includes('hosting') || allItemsTypes.some(t => t === 'hosting');
                    const hasDomain = allItemsText.includes('dom') || allItemsTypes.some(t => t.includes('domain'));
                    if (hasHosting && hasDomain) cat = 'Hosting y Dominio';
                    else if (hasHosting) cat = 'Hosting';
                    else if (hasDomain) cat = 'Dominio';

                    let cleanConcept = companyDisp
                        ? `${companyDisp}\n${clienteName}\n${firstItem} (${cat})`
                        : `${clienteName}\n${firstItem} (${cat})`;
                    cleanConcept = cleanConcept.replace(/\(\d{2}\/\d{2}\/\d{4} - \d{2}\/\d{2}\/\d{4}\)/g, '').replace(/[^\S\n]+/g, ' ').split('\n').map(l => l.trim()).join('\n');
                    const clienteConcepto = cleanConcept.substring(0, 255);

                    let bankSource = '--';
                    let bankDestination = '--';
                    if (invoiceTxsInPeriod.length > 0) {
                        const lastT = invoiceTxsInPeriod[invoiceTxsInPeriod.length - 1];
                        const banksInId = identifyAllBanks(lastT.transid);
                        if (banksInId[0]) bankSource = banksInId[0];
                        if (banksInId.length > 1) bankDestination = banksInId[1];
                        else {
                            bankDestination = identifyBankFromText(lastT.description) || identifyBankFromText(invBase.paymentmethod) || bankSource;
                        }
                    }

                    const codigoContable = mapBankToDebitAccount(bankDestination);
                    const pm = (invBase.paymentmethod || '').toLowerCase();
                    let tipoMov = 'Transferencia';
                    if (pm.includes('izipay')) {
                        tipoMov = 'Izipay';
                        bankSource = 'Caja Virtual';
                        bankDestination = 'Izipay por cobrar';
                    }
                    else if (pm.includes('yape')) tipoMov = 'Yape';
                    else if (pm.includes('plin')) tipoMov = 'Plin';
                    else if (pm.includes('tarjeta') || pm.includes('paypal') || pm.includes('stripe')) tipoMov = 'Tarjeta';
                    else if (pm.includes('efectivo')) tipoMov = 'Efectivo';

                    const request = pool.request();
                    request.input('whmcsId', mssql.Int, invId);

                    const paymentDate = (invoiceTxsInPeriod.length > 0) ? invoiceTxsInPeriod[0].date : invBase.date;
                    request.input('fecha', mssql.Date, paymentDate);
                    request.input('cliente', mssql.NVarChar(255), clienteConcepto);
                    request.input('numFactura', mssql.NVarChar(50), invBase.invoicenum);
                    request.input('total', mssql.Decimal(18, 2), totalMonthPENForInvoice);
                    request.input('estado', mssql.NVarChar(50), invBase.status);
                    request.input('pagado', mssql.Decimal(18, 2), totalMonthPENForInvoice);
                    request.input('moneda', mssql.NVarChar(10), invBase.currencycode || 'PEN');
                    request.input('banco', mssql.NVarChar(50), bankSource);
                    request.input('cuentaDebito', mssql.NVarChar(100), bankDestination);
                    request.input('tipoMovimiento', mssql.NVarChar(50), tipoMov);
                    request.input('codContable', mssql.NVarChar(50), codigoContable);
                    request.input('now', mssql.DateTime, new Date());

                    await request.query(`
                        IF EXISTS (SELECT 1 FROM FINANCE_INVOICES WHERE WHMCS_InvoiceID = @whmcsId)
                        BEGIN
                            UPDATE FINANCE_INVOICES SET 
                                Fecha = @fecha,
                                ClienteConcepto = @cliente,
                                EstadoWHMCS = @estado, 
                                Pagado = @pagado, 
                                MontoBruto = @total,
                                DepositoSalida = CASE WHEN UPPER(EstadoLocal) = 'PAGADO' THEN DepositoSalida ELSE @pagado END,
                                -- PROTECCIÓN TOTAL: NUNCA se cambia el estado local si ya tiene un valor.
                                EstadoLocal = ISNULL(NULLIF(EstadoLocal, ''), 
                                    CASE WHEN @banco = 'Caja Virtual' THEN 'Pendiente' ELSE 'Conciliado' END
                                ),
                                Banco = @banco,
                                CuentaDebito = @cuentaDebito,
                                UpdatedAt = @now
                            WHERE WHMCS_InvoiceID = @whmcsId
                        END
                        ELSE
                        BEGIN
                            INSERT INTO FINANCE_INVOICES (WHMCS_InvoiceID, Fecha, ClienteConcepto, NumFactura, MontoBruto, EstadoWHMCS, Pagado, DepositoSalida, Moneda, EstadoLocal, Banco, CuentaDebito, TipoMovimiento, CodigoContable, CreatedAt, UpdatedAt)
                            VALUES (@whmcsId, @fecha, @cliente, @numFactura, @total, @estado, @pagado, @pagado, @moneda, 
                                CASE WHEN @banco = 'Caja Virtual' THEN 'Pendiente' ELSE 'Conciliado' END, 
                                @banco, @cuentaDebito, @tipoMovimiento, @codContable, @now, @now)
                        END
                    `);

                    if (invBase.status === 'Paid' && (tipoMov.toLowerCase().includes('izipay') || tipoMov.toLowerCase().includes('mercado'))) {
                        try {
                            await processVirtualPayment(invId, tipoMov, totalMonthPENForInvoice, pool);
                            console.log(`[Finance-Sync] Auto-Liquidación exitosa para #${invId}`);
                        } catch (autoErr) {
                            console.error(`[Finance-Sync] Error en auto-liquidación para #${invId}:`, autoErr.message);
                        }
                    }

                    syncedCount++;
                } catch (err) {
                }
            }));
        }

        cachedThisMonthPaid = totalGrossPEN;
        cachedThisMonthTotalGross = totalGrossPEN;
        lastSyncTime = Date.now();

    } catch (error) {
    }
}

app.get('/api/whmcs/invoices', async (req, res) => {
    try {
        const now = new Date();
        const forceSync = req.query.sync === 'true';

        const currentMonth = parseInt(req.query.mes) || (now.getMonth() + 1);
        const currentYear = parseInt(req.query.anio) || now.getFullYear();

        if (forceSync) {
            await syncWhmcsInvoices(currentMonth, currentYear);
        } else if (!lastSyncTime || (Date.now() - lastSyncTime > SYNC_COOLDOWN)) {
            syncWhmcsInvoices(currentMonth, currentYear).catch(err => err);
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 25;
        const offset = (page - 1) * limit;

        const pool = await poolFinance;

        const countResult = await pool.request()
            .input('month', mssql.Int, currentMonth)
            .input('year', mssql.Int, currentYear)
            .query(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN MONTH(Fecha) = @month AND YEAR(Fecha) = @year THEN ISNULL(MontoBruto, 0) ELSE 0 END) as totalGross,
                    SUM(CASE WHEN Banco = 'Caja Virtual' AND EstadoLocal IN ('Pagado', 'Conciliado') AND MONTH(Fecha) = @month AND YEAR(Fecha) = @year THEN ISNULL(DepositoSalida, 0) ELSE 0 END) as totalCajaVirtual,
                    SUM(CASE WHEN Banco = 'Caja Virtual' AND EstadoLocal = 'Pendiente' AND MONTH(Fecha) = @month AND YEAR(Fecha) = @year THEN ISNULL(DepositoSalida, 0) ELSE 0 END) as totalCajaVirtualPendiente,
                    SUM(CASE WHEN CuentaDebito = 'BCP' AND MONTH(Fecha) = @month AND YEAR(Fecha) = @year THEN ISNULL(MontoBruto, 0) ELSE 0 END) as totalBcp,
                    SUM(CASE WHEN CuentaDebito = 'INTERBANK' AND MONTH(Fecha) = @month AND YEAR(Fecha) = @year THEN ISNULL(MontoBruto, 0) ELSE 0 END) as totalInterbank,
                    SUM(CASE WHEN MONTH(Fecha) = @month AND YEAR(Fecha) = @year THEN ISNULL(Comision, 0) ELSE 0 END) as totalComisiones
                FROM FINANCE_INVOICES 
                WHERE (MONTH(Fecha) = @month AND YEAR(Fecha) = @year)
                AND EstadoLocal IN ('Conciliado', 'Pendiente', 'Pagado')
            `);

        const totalRecords = countResult.recordset[0].total;
        const dbTotalGross = countResult.recordset[0].totalGross || 0;
        const dbTotalCajaVirtual = countResult.recordset[0].totalCajaVirtual || 0;
        const dbTotalCajaVirtualPendiente = countResult.recordset[0].totalCajaVirtualPendiente || 0;
        const dbTotalBcp = countResult.recordset[0].totalBcp || 0;
        const dbTotalInterbank = countResult.recordset[0].totalInterbank || 0;
        const dbTotalComisiones = countResult.recordset[0].totalComisiones || 0;

        const result = await pool.request()
            .input('month', mssql.Int, currentMonth)
            .input('year', mssql.Int, currentYear)
            .input('offset', mssql.Int, offset)
            .input('limit', mssql.Int, limit)
            .query(`
                SELECT * FROM FINANCE_INVOICES 
                WHERE (MONTH(Fecha) = @month AND YEAR(Fecha) = @year)
                AND EstadoLocal IN ('Conciliado', 'Pendiente', 'Pagado')
                ORDER BY Fecha DESC
                OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
            `);

        const invoices = result.recordset.map(inv => ({
            id: inv.WHMCS_InvoiceID,
            localId: inv.ID,
            fecha: inv.Fecha,
            clienteConcepto: inv.ClienteConcepto,
            numFactura: inv.NumFactura || inv.WHMCS_InvoiceID,
            montoBruto: inv.MontoBruto,
            estado: inv.EstadoWHMCS,
            pagado: inv.Pagado,
            moneda: inv.Moneda,
            tipoMovimiento: inv.TipoMovimiento,
            comision: inv.Comision,
            depositoSalida: inv.DepositoSalida,
            banco: inv.Banco,
            cuentaDebito: inv.CuentaDebito,
            cuentaCredito: inv.CuentaCredito,
            codigoContable: inv.CodigoContable,
            estadoLocal: inv.EstadoLocal || 'Pendiente'
        }));

        const penInvoices = invoices.filter(inv => {
            const m = (inv.moneda || '').toString().toUpperCase();
            return m === 'PEN' || m === '1' || m === '' || m === 'SOLES' || m.includes('S/');
        });
        const isCurrentPeriod = currentMonth === (now.getMonth() + 1) && currentYear === now.getFullYear();
        const thisMonthPaid = isCurrentPeriod ? cachedThisMonthPaid : dbTotalGross;
        const thisMonthTotalGross = (isCurrentPeriod && cachedThisMonthTotalGross > 0)
            ? cachedThisMonthTotalGross
            : dbTotalGross;

        const thisMonthUnpaid = penInvoices.filter(inv => {
            const st = (inv.estado || '').toLowerCase();
            return st.includes('unpaid') || st.includes('pendien');
        }).reduce((sum, inv) => sum + (Number(inv.montoBruto) || 0), 0);

        res.json({
            totalresults: totalRecords,
            totalPages: Math.ceil(totalRecords / limit),
            currentPage: page,
            thisMonthPaid,
            thisMonthTotal: thisMonthPaid,
            thisMonthTotalGross,
            thisMonthUnpaid,
            serverBankTotals: {
                cajaVirtual: dbTotalCajaVirtual,
                cajaVirtualPendiente: dbTotalCajaVirtualPendiente,
                bcp: dbTotalBcp,
                interbank: dbTotalInterbank,
                comisiones: dbTotalComisiones
            },
            invoices: invoices
        });
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener facturas' });
    }
});

app.get('/api/whmcs/invoice/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const params = new URLSearchParams();
        params.append('identifier', WHMCS_IDENTIFIER);
        params.append('secret', WHMCS_SECRET);
        params.append('action', 'GetInvoice');
        params.append('invoiceid', id);
        params.append('responsetype', 'json');

        const response = await axios.post(WHMCS_API_URL, params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        if (response.data.result === 'success') {
            const inv = response.data;
            const items = inv.items?.item || [];
            res.json({
                success: true,
                invoice: {
                    id: inv.invoiceid,
                    invoicenum: inv.invoicenum || inv.invoiceid,
                    date: inv.date,
                    duedate: inv.duedate,
                    datepaid: inv.datepaid,
                    status: inv.status,
                    paymentmethod: inv.paymentmethod,
                    subtotal: parseFloat(inv.subtotal || 0),
                    tax: parseFloat(inv.tax || 0),
                    tax2: parseFloat(inv.tax2 || 0),
                    total: parseFloat(inv.total || 0),
                    credit: parseFloat(inv.credit || 0),
                    balance: parseFloat(inv.balance || 0),
                    notes: inv.notes || '',
                    client: {
                        name: (() => {
                            const c = inv.clientdetails || inv;
                            const name = `${c.firstname || ''} ${c.lastname || ''}`.trim();
                            return name || inv.companyname || 'Cliente WHMCS';
                        })(),
                        company: inv.companyname || (inv.clientdetails?.companyname) || '',
                        email: inv.email || (inv.clientdetails?.email) || ''
                    },
                    items: items.map(it => ({
                        id: it.id,
                        type: it.type,
                        description: it.description,
                        amount: parseFloat(it.amount || 0),
                        taxed: it.taxed
                    }))
                }
            });
        } else {
            res.status(404).json({ success: false, error: 'Factura no encontrada en WHMCS' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});


app.get('/api/finance/invoices/:id/pdf-info', async (req, res) => {
    const { id } = req.params;
    try {
        const params = new URLSearchParams();
        params.append('identifier', WHMCS_IDENTIFIER);
        params.append('secret', WHMCS_SECRET);
        params.append('action', 'GetInvoice');
        params.append('invoiceid', id);
        params.append('responsetype', 'json');

        const response = await axios.post(WHMCS_API_URL, params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        if (response.data.result === 'success') {
            const inv = response.data;
            let detectedBank = identifyBankFromText(inv.paymentmethod) || identifyBankFromText(inv.notes);

            if (!detectedBank && inv.transactions?.transaction) {
                const txs = Array.isArray(inv.transactions.transaction) ? inv.transactions.transaction : [inv.transactions.transaction];
                for (const tx of txs) {
                    detectedBank = identifyBankFromText(tx.description) || identifyBankFromText(tx.transid);
                    if (detectedBank) break;
                }
            }

            res.json({ success: true, data: { banco: detectedBank } });
        } else {
            res.status(404).json({ success: false, error: 'Invoice not found' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/finance/invoices/:id/metadata', async (req, res) => {
    try {
        const { id } = req.params;
        const data = req.body;
        const pool = await poolFinance;

        const request = pool.request();
        request.input('id', mssql.Int, id);
        request.input('tipo', mssql.NVarChar(100), data.tipoMovimiento || '');
        request.input('comision', mssql.Decimal(18, 2), data.comision || 0);
        request.input('deposito', mssql.Decimal(18, 2), data.depositoSalida || 0);
        request.input('banco', mssql.NVarChar(100), data.banco || '');
        request.input('debit', mssql.NVarChar(100), data.cuentaDebito || '');
        request.input('credit', mssql.NVarChar(100), data.cuentaCredito || '');
        request.input('codigo', mssql.NVarChar(100), data.codigoContable || '');
        request.input('estado', mssql.NVarChar(50), data.estadoLocal || '');
        request.input('now', mssql.DateTime, new Date());

        await request.query(`
            UPDATE FINANCE_INVOICES SET 
                TipoMovimiento = @tipo,
                Comision = @comision,
                DepositoSalida = @deposito,
                Banco = @banco,
                CuentaDebito = @debit,
                CuentaCredito = @credit,
                CodigoContable = @codigo,
                EstadoLocal = @estado,
                UpdatedAt = @now
            WHERE ID = @id
        `);

        res.json({ message: 'Metadata actualizada correctamente' });
    } catch (error) {
        res.status(500).json({ error: 'Error al actualizar metadata' });
    }
});

app.get('/api/finance/movement-types', async (req, res) => {
    try {
        const pool = await poolFinance;
        const result = await pool.request().query('SELECT * FROM movement_types');
        res.json(result.recordset.map(r => ({ id: r.id || r.Id || r.ID, name: r.name || r.Nombre || r.NOMBRE || r[Object.keys(r)[1]] })));
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener tipos de movimiento' });
    }
});

app.get('/api/finance/bancos', async (req, res) => {
    try {
        const pool = await poolFinance;
        const result = await pool.request().query('SELECT * FROM BANCOS');
        res.json(result.recordset.map(r => ({ id: r.id || r.Id || r.ID, name: r.name || r.Nombre || r.NOMBRE || r[Object.keys(r)[1]] })));
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener bancos' });
    }
});

app.get('/api/finance/debit-accounts', async (req, res) => {
    try {
        const pool = await poolFinance;
        const result = await pool.request().query('SELECT * FROM debit_accounts');
        res.json(result.recordset.map(r => ({ id: r.id || r.Id || r.ID, name: r.name || r.Nombre || r.NOMBRE || r[Object.keys(r)[1]] })));
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener cuentas débito' });
    }
});

app.get('/api/finance/credit-accounts', async (req, res) => {
    try {
        const pool = await poolFinance;
        const result = await pool.request().query('SELECT * FROM credit_accounts');
        res.json(result.recordset.map(r => ({ id: r.id || r.Id || r.ID, name: r.name || r.Nombre || r.NOMBRE || r[Object.keys(r)[1]] })));
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener cuentas crédito' });
    }
});

app.get('/api/finance/codigo-contable', async (req, res) => {
    try {
        const pool = await poolFinance;
        const result = await pool.request().query('SELECT * FROM CUENTAS_CONTABLES WHERE Activo = 1 ORDER BY Orden ASC');
        res.json(result.recordset.map(r => ({
            id: r.Id,
            codigo: r.Codigo,
            name: `${r.Codigo} - ${r.Nombre}`,
            tipo: r.Tipo
        })));
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener códigos contables' });
    }
});

app.get('/api/finance/transaction-status', async (req, res) => {
    try {
        const pool = await poolFinance;
        const result = await pool.request().query('SELECT * FROM transaction_status');
        res.json(result.recordset.map(r => ({ id: r.id || r.Id || r.ID, name: r.name || r.Nombre || r.NOMBRE || r[Object.keys(r)[1]] })));
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener estados de transacción' });
    }
});


app.get('/api/finance/egresos', async (req, res) => {
    try {
        const pool = await poolFinance;
        const mes = parseInt(req.query.mes) || (new Date().getMonth() + 1);
        const anio = parseInt(req.query.anio) || new Date().getFullYear();

        const result = await pool.request()
            .input('month', mssql.Int, mes)
            .input('year', mssql.Int, anio)
            .query(`
                SELECT * FROM FINANCE_EGRESOS 
                WHERE MONTH(Fecha) = @month AND YEAR(Fecha) = @year
                ORDER BY Fecha DESC, CreatedAt DESC
            `);

        const egresos = result.recordset.map(e => ({
            id: e.ID,
            localId: e.ID,
            fecha: e.Fecha,
            monto: e.Monto,
            banco: e.Banco,
            tipoEgreso: e.TipoEgreso,
            comercio: e.Comercio,
            categoria: e.Categoria,
            referencia: e.Referencia,
            origen: e.Origen,
            observacion: e.Observacion,
            codigoContable: e.CodigoContable,
            estadoLocal: e.EstadoLocal || 'Pendiente'
        }));

        const totalMes = egresos.reduce((sum, e) => sum + (Number(e.monto) || 0), 0);

        res.json({
            total: egresos.length,
            totalMonto: totalMes,
            egresos
        });
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener egresos' });
    }
});

app.post('/api/finance/egresos', async (req, res) => {
    try {
        const data = req.body;
        const pool = await poolFinance;
        const request = pool.request();

        request.input('fecha', mssql.Date, data.fecha ? new Date(data.fecha) : new Date());
        request.input('monto', mssql.Decimal(18, 2), data.monto || 0);
        request.input('banco', mssql.NVarChar(100), data.banco || '');
        request.input('tipo', mssql.NVarChar(100), data.tipoEgreso || 'MANUAL');
        request.input('comercio', mssql.NVarChar(255), data.comercio || '');
        request.input('categoria', mssql.NVarChar(100), data.categoria || '');
        request.input('ref', mssql.NVarChar(255), data.referencia || '');
        request.input('origen', mssql.NVarChar(50), data.origen || 'MANUAL');
        request.input('obs', mssql.NVarChar(500), data.observacion || '');
        request.input('codigo', mssql.NVarChar(100), data.codigoContable || '');

        await request.query(`
            INSERT INTO FINANCE_EGRESOS (Fecha, Monto, Banco, TipoEgreso, Comercio, Categoria, Referencia, Origen, Observacion, CodigoContable, CreatedAt, UpdatedAt)
            VALUES (@fecha, @monto, @banco, @tipo, @comercio, @categoria, @ref, @origen, @obs, @codigo, GETDATE(), GETDATE())
        `);

        res.status(201).json({ success: true, message: 'Egreso registrado correctamente' });
    } catch (error) {
        res.status(500).json({ error: 'Error al registrar egreso' });
    }
});

app.post('/api/finance/egresos/:id/metadata', async (req, res) => {
    try {
        const { id } = req.params;
        const data = req.body;
        const pool = await poolFinance;
        const request = pool.request();
        request.input('id', mssql.Int, id);
        request.input('banco', mssql.NVarChar(100), data.banco || '');
        request.input('codigo', mssql.NVarChar(100), data.codigoContable || '');
        request.input('estado', mssql.NVarChar(50), data.estadoLocal || 'Pendiente');
        request.input('now', mssql.DateTime, new Date());

        await request.query(`
            UPDATE FINANCE_EGRESOS 
            SET Banco = @banco, CodigoContable = @codigo, EstadoLocal = @estado, UpdatedAt = @now
            WHERE ID = @id
        `);
        res.json({ success: true, message: 'Egreso actualizado' });
    } catch (error) {
        res.status(500).json({ error: 'Error al actualizar egreso' });
    }
});

app.delete('/api/finance/egresos/:id', async (req, res) => {
    try {
        const pool = await poolFinance;
        await pool.request()
            .input('id', mssql.Int, req.params.id)
            .query('DELETE FROM FINANCE_EGRESOS WHERE ID = @id');
        res.json({ success: true, message: 'Egreso eliminado' });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar egreso' });
    }
});


app.get('/api/vacaciones', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        const employeeId = req.query.employeeId;

        // Auto-sincronizar columna TIPO_CONTROL si no existe en la BD
        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('EMPLOYEE_VACATIONS') AND name = 'TIPO_CONTROL')
            BEGIN
                ALTER TABLE EMPLOYEE_VACATIONS ADD TIPO_CONTROL VARCHAR(20) DEFAULT 'SISTEMATICO' NOT NULL;
            END
        `);

        let query = `
            SELECT v.*, e.NOMBRE, e.APELLIDOS 
            FROM EMPLOYEE_VACATIONS v
            JOIN EMPLOYEES e ON v.ID_EMPLOYEE = e.ID_EMPLOYEE
        `;

        const request = pool.request();
        if (employeeId) {
            query += ' WHERE v.ID_EMPLOYEE = @empId';
            request.input('empId', mssql.Int, employeeId);
        }

        query += ' ORDER BY v.FECHA_INICIO DESC';

        const result = await request.query(query);
        res.json(result.recordset);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener vacaciones' });
    }
});

app.post('/api/vacaciones', async (req, res) => {
    try {
        const data = req.body;
        const pool = await poolPlanilla;
        const request = pool.request();

        request.input('empId', mssql.Int, data.idEmployee);
        request.input('start', mssql.Date, new Date(data.fechaInicio));
        request.input('end', mssql.Date, new Date(data.fechaFin));
        request.input('days', mssql.Int, data.diasUtiles);
        request.input('status', mssql.VarChar(50), data.estado || 'PROGRAMADO');
        request.input('obs', mssql.NVarChar(mssql.MAX), data.observaciones || '');
        request.input('tipoControl', mssql.VarChar(20), data.tipoControl || 'SISTEMATICO');

        await request.query(`
            INSERT INTO EMPLOYEE_VACATIONS (ID_EMPLOYEE, FECHA_INICIO, FECHA_FIN, DIAS_UTILES, ESTADO, OBSERVACIONES, TIPO_CONTROL, CREATED_AT, UPDATED_AT)
            VALUES (@empId, @start, @end, @days, @status, @obs, @tipoControl, GETDATE(), GETDATE())
        `);

        res.status(201).json({ success: true, message: 'Vacaciones registradas correctamente' });
    } catch (error) {
        res.status(500).json({ error: 'Error al registrar vacaciones' });
    }
});

app.put('/api/vacaciones/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const data = req.body;
        const pool = await poolPlanilla;
        const request = pool.request();

        request.input('id', mssql.Int, id);
        request.input('start', mssql.Date, new Date(data.fechaInicio));
        request.input('end', mssql.Date, new Date(data.fechaFin));
        request.input('days', mssql.Int, data.diasUtiles);
        request.input('status', mssql.VarChar(50), data.estado);
        request.input('obs', mssql.NVarChar(mssql.MAX), data.observaciones || '');
        request.input('tipoControl', mssql.VarChar(20), data.tipoControl || 'SISTEMATICO');

        await request.query(`
            UPDATE EMPLOYEE_VACATIONS 
            SET FECHA_INICIO = @start,
                FECHA_FIN = @end,
                DIAS_UTILES = @days,
                ESTADO = @status,
                OBSERVACIONES = @obs,
                TIPO_CONTROL = @tipoControl,
                UPDATED_AT = GETDATE()
            WHERE ID = @id
        `);

        res.json({ success: true, message: 'Vacaciones actualizadas correctamente' });
    } catch (error) {
        res.status(500).json({ error: 'Error al actualizar vacaciones' });
    }
});

app.delete('/api/vacaciones/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const pool = await poolPlanilla;
        await pool.request()
            .input('id', mssql.Int, id)
            .query('DELETE FROM EMPLOYEE_VACATIONS WHERE ID = @id');
        res.json({ success: true, message: 'Vacaciones eliminadas' });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar vacaciones' });
    }
});



cron.schedule('*/30 * * * *', async () => {
    try {
        const portToUse = process.env.PORT || port;
        const response = await axios.get(`http://localhost:${portToUse}/api/gmail/process?autoCreate=true&days=3`, {
            timeout: 60000
        });

    } catch (error) {
    }
});

// --- MONITOR DE CONEXIÓN ADMS ---
app.use((req, res, next) => {
    // Si la petición viene por el puerto 8081 o tiene rutas de iclock
    if (req.path.includes('/iclock/') || req.originalUrl.includes('/iclock/')) {
        console.log(`[ADMS-DEBUG] 📥 Petición Recibida: ${req.method} ${req.originalUrl} desde IP: ${req.ip}`);
    }
    next();
});

app.get('/iclock/cdata', (req, res) => {
    const { SN } = req.query;
    if (SN) {
        console.log(`[ADMS] 📡 Conexión detectada de SN: ${SN}. Solicitando carga forzada de registros (ATTLOG y USERINFO)...`);

        if (!pendingCommands.has(SN)) {
            pendingCommands.set(SN, []);
        }

        const queue = pendingCommands.get(SN);
        if (!queue.includes('DATA QUERY ATTLOG')) queue.push('DATA QUERY ATTLOG');
        if (!queue.includes('DATA QUERY USERINFO')) queue.push('DATA QUERY USERINFO');
        if (!queue.includes('DATA QUERY USER')) queue.push('DATA QUERY USER');
        if (!queue.includes('DATA QUERY USERDATA')) queue.push('DATA QUERY USERDATA');
        if (!queue.includes('DATA QUERY PIN2NAME')) queue.push('DATA QUERY PIN2NAME');
    }
    res.setHeader('Content-Type', 'text/plain');
    res.end('OK\n');
});

async function syncBiometricUserToDB(pin, name) {
    try {
        const pool = await poolPlanilla;
        if (!pool) return;

        await pool.request()
            .input('pin', mssql.Int, pin)
            .input('name', mssql.NVarChar, name)
            .query(`
                IF EXISTS (SELECT 1 FROM BIOMETRIC_USERS WHERE PIN = @pin)
                    UPDATE BIOMETRIC_USERS SET NAME = @name, SYNC_DATE = GETDATE() WHERE PIN = @pin
                ELSE
                    INSERT INTO BIOMETRIC_USERS (PIN, NAME) VALUES (@pin, @name)
            `);

        console.log(`[DB-SYNC] Usuario sincronizado: ${name} (PIN: ${pin})`);

        const linkResult = await pool.request()
            .input('pin', mssql.Int, pin)
            .input('name', mssql.NVarChar, name.trim().toUpperCase())
            .query(`
                UPDATE EMPLOYEES 
                SET BIOMETRIC_ID = @pin 
                OUTPUT inserted.NOMBRE, inserted.APELLIDOS
                WHERE (BIOMETRIC_ID IS NULL OR BIOMETRIC_ID = 0)
                AND (
                    REPLACE(NOMBRE + ' ' + APELLIDOS, ' ', '') LIKE '%' + REPLACE(@name, ' ', '') + '%'
                    OR REPLACE(@name, ' ', '') LIKE '%' + REPLACE(NOMBRE, ' ', '') + '%'
                )
            `);

        if (linkResult.recordset.length > 0) {
            const emp = linkResult.recordset[0];
            console.log(`[DB-SYNC] 🔗 ¡Vínculo exitoso! ${emp.NOMBRE} ${emp.APELLIDOS} asociado al PIN ${pin}`);
        } else {
            console.log(`[DB-SYNC] No se encontró coincidencia automática para: ${name} (PIN: ${pin})`);
        }
    } catch (err) {
        console.error('[DB-SYNC] Error vinculando usuario:', err);
    }
}

// --- CÁLCULO DE REPORTES DIARIOS ---
async function updateDailyReport(biometricId, dateStr) {
    try {
        const pool = await poolPlanilla;
        if (!pool) return;

        // 1. Obtener logs del día
        const logsRes = await pool.request()
            .input('bid', mssql.Int, biometricId)
            .input('date', mssql.Date, dateStr)
            .query(`
                SELECT CHECKTIME, CHECKTYPE 
                FROM ATTENDANCE_LOGS 
                WHERE USERID = @bid AND CAST(CHECKTIME AS DATE) = @date
                ORDER BY CHECKTIME ASC
            `);

        if (logsRes.recordset.length === 0) return;

        const firstEntry = logsRes.recordset[0].CHECKTIME;
        const lastExit = logsRes.recordset[logsRes.recordset.length - 1].CHECKTIME;
        const empRes = await pool.request()
            .input('bid', mssql.Int, biometricId)
            .query('SELECT ID_EMPLOYEE, ENTRY_TIME FROM EMPLOYEES WHERE BIOMETRIC_ID = @bid');

        if (empRes.recordset.length === 0) return;

        const emp = empRes.recordset[0];
        const idEmployee = emp.ID_EMPLOYEE;
        const expectedEntry = emp.ENTRY_TIME || '09:00';
        let status = 'Puntual';
        const [expH, expM] = expectedEntry.split(':').map(Number);

        const actualH = firstEntry.getHours();
        const actualM = firstEntry.getMinutes();

        if (actualH > expH || (actualH === expH && actualM > expM + 10)) {
            status = 'Tarde';
        }

        const diffMs = lastExit.getTime() - firstEntry.getTime();
        let hoursRaw = diffMs / (1000 * 60 * 60);

        if (hoursRaw > 4) {
            hoursRaw -= 1;
        }

        const totalHours = Math.max(0, hoursRaw).toFixed(2);

        await pool.request()
            .input('idEmp', mssql.Int, idEmployee)
            .input('date', mssql.Date, dateStr)
            .input('entry', mssql.DateTime, firstEntry)
            .input('exit', mssql.DateTime, lastExit)
            .input('hours', mssql.Decimal(10, 2), totalHours)
            .input('status', mssql.NVarChar, status)
            .query(`
                IF EXISTS (SELECT 1 FROM ATTENDANCE_DAILY_REPORTS WHERE ID_EMPLOYEE = @idEmp AND DATE = @date)
                    UPDATE ATTENDANCE_DAILY_REPORTS 
                    SET FIRST_ENTRY = @entry, LAST_EXIT = @exit, TOTAL_HOURS = @hours, STATUS = @status
                    WHERE ID_EMPLOYEE = @idEmp AND DATE = @date
                ELSE
                    INSERT INTO ATTENDANCE_DAILY_REPORTS (ID_EMPLOYEE, DATE, FIRST_ENTRY, LAST_EXIT, TOTAL_HOURS, STATUS)
                    VALUES (@idEmp, @date, @entry, @exit, @hours, @status)
            `);

        console.log(`[REPORTS] Reporte actualizado para Emp ${idEmployee} el ${dateStr}: ${status}, ${totalHours}h`);

    } catch (err) {
        console.error('[REPORTS] Error actualizando reporte diario:', err);
    }
}

app.post('/iclock/cdata', async (req, res) => {
    const { SN, table } = req.query;

    if (table !== 'ATTLOG' && table !== 'USERINFO' && table !== 'USER' && table !== 'OPERLOG') {
        if (req.body && req.body.length > 0) {
            console.log(`[ADMS-DEBUG] Tabla desconocida recibida: ${table}. Body length: ${req.body.length}`);
        }
        return res.end('OK\n');
    }

    if (!req.body || typeof req.body !== 'string' || req.body.length === 0) {
        console.log(`[ADMS] Body vacío o formato incorrecto para tabla ${table}`);
        return res.end('OK\n');
    }

    if (table === 'USERINFO' || table === 'USER' || table === 'OPERLOG') {
        try {
            const bodyContent = req.body.toString();
            const lines = bodyContent.split('\n');
            let userCount = 0;

            for (let line of lines) {
                line = line.trim();
                if (!line) continue;

                let cleanLine = line;
                if (table === 'OPERLOG') {
                    if (line.startsWith('USER ')) {
                        cleanLine = line.substring(5);
                    } else {
                        continue;
                    }
                }

                const data = {};
                cleanLine.split('\t').forEach(p => {
                    const [keyVal, ...rest] = p.split('=');
                    if (keyVal && rest.length > 0) {
                        data[keyVal.trim().toUpperCase()] = rest.join('=').trim();
                    }
                });

                const pin = data.PIN || data.USERID;
                const name = data.NAME || `Usuario sin nombre (ID: ${pin})`;

                if (pin) {
                    biometricUsersCache.set(pin.toString(), name);
                    userCount++;

                    // Persistir en DB y vincular
                    syncBiometricUserToDB(pin, name);

                    if (!data.NAME) {
                        console.log(`[ADMS-DEBUG] Usuario detectado sin nombre en ${table}. ID: ${pin}`);
                    }
                }
            }
            if (userCount > 0) {
                console.log(`[ADMS] OK: ${userCount} usuarios sincronizados en memoria (desde ${table}) para SN: ${SN}`);
            }
            return res.end('OK\n');
        } catch (err) {
            console.error(`[ADMS] Error procesando ${table}:`, err);
            return res.end('ERROR\n');
        }
    }


    try {
        const pool = await poolPlanilla;
        const bodyContent = req.body.toString();
        const lines = bodyContent.split('\n');
        let savedCount = 0;

        for (let line of lines) {
            line = line.trim();
            if (!line) continue;

            let userid, checktime, type = 0;

            if (line.includes('=')) {
                const data = {};
                line.split('\t').forEach(p => {
                    const [keyVal, ...rest] = p.split('=');
                    if (keyVal && rest.length > 0) {
                        data[keyVal.trim().toUpperCase()] = rest.join('=').trim();
                    }
                });
                userid = data.USERID;
                checktime = data.CHECKTIME;
                type = parseInt(data.CHECKTYPE) || 0;
            } else {
                const parts = line.split('\t');
                if (parts.length >= 2) {
                    userid = parts[0];
                    checktime = parts[1];
                    type = parseInt(parts[2]) || 0;
                } else {
                    const spaceParts = line.split(/\s+/);
                    if (spaceParts.length >= 2) {
                        userid = spaceParts[0];
                        checktime = `${spaceParts[1]} ${spaceParts[2]}`;
                        type = parseInt(spaceParts[3]) || 0;
                    }
                }
            }

            if (userid && checktime && !isNaN(parseInt(userid)) && !isNaN(new Date(checktime).getTime())) {
                console.log(`[ADMS-ATTLOG] 🕒 Registro Recibido: User=${userid}, Time=${checktime}`);
                try {
                    await pool.request()
                        .input('sn', mssql.NVarChar, SN)
                        .input('userid', mssql.Int, parseInt(userid))
                        .input('checktime', mssql.DateTime, new Date(checktime))
                        .input('type', mssql.Int, type)
                        .query(`
                            INSERT INTO ATTENDANCE_LOGS (SN, USERID, CHECKTIME, CHECKTYPE)
                            VALUES (@sn, @userid, @checktime, @type)
                        `);
                    savedCount++;

                    // Actualizar reporte diario después de insertar el log
                    const dateOnly = new Date(checktime).toISOString().split('T')[0];
                    updateDailyReport(parseInt(userid), dateOnly);
                } catch (dbErr) {
                    if (!dbErr.message.includes('PRIMARY KEY') && !dbErr.message.includes('unique')) {
                        console.error(`[ADMS] SQL Error para USERID ${userid}:`, dbErr.message);
                    }
                }
            }
        }
        if (savedCount > 0) {
            console.log(`[ADMS] OK: ${savedCount} registros procesados para SN: ${SN}`);
        }
        res.setHeader('Content-Type', 'text/plain');
        res.end('OK\n');
    } catch (error) {
        console.error('[ADMS] Error crítico en procesador:', error);
        res.status(500).end('ERROR\n');
    }
});

app.get('/iclock/getrequest', (req, res) => {
    const { SN } = req.query;
    res.setHeader('Content-Type', 'text/plain');

    if (SN) {
        // Registrar el dispositivo si es la primera vez que conecta
        if (!knownDeviceSNs.has(SN)) {
            knownDeviceSNs.add(SN);
            console.log(`[ADMS] 📡 Dispositivo registrado: SN=${SN}. Total dispositivos: ${knownDeviceSNs.size}`);
        }
        if (!pendingCommands.has(SN)) {
            console.log(`[ADMS] 📡 Primera poll detectada de SN: ${SN}. Iniciando sync...`);
            pendingCommands.set(SN, ['DATA QUERY ATTLOG', 'DATA QUERY USERINFO', 'DATA QUERY USER', 'DATA QUERY USERDATA', 'DATA QUERY PIN2NAME']);
        }

        const queue = pendingCommands.get(SN);

        // Mover globalCommands a la cola del dispositivo
        while (globalCommands.length > 0) {
            queue.push(globalCommands.shift());
        }

        if (queue && queue.length > 0) {
            const cmd = queue.shift();
            console.log(`[ADMS] Enviando orden (${cmd}) a SN: ${SN}. Pendientes: ${queue.length}`);

            return res.end(`C:101:${cmd}\n`);
        }
    }

    res.end('OK\n');
});

app.get('/api/attendance/force-biometric-sync', (req, res) => {
    const { SN } = req.query;
    if (!SN) return res.status(400).json({ error: 'Falta SN' });

    console.log(`[ADMS] 🔄 Forzando sincronización manual para SN: ${SN}`);
    pendingCommands.set(SN, ['DATA QUERY ATTLOG', 'DATA QUERY USERINFO', 'DATA QUERY USER', 'DATA QUERY USERDATA', 'DATA QUERY PIN2NAME']);

    res.json({ message: `Sincronización encolada para ${SN}. El equipo la recibirá en su próxima consulta.` });
});

// ─── ZKTeco: Ver dispositivos conectados ───────────────────────────────────
app.get('/api/zkteco/devices', (req, res) => {
    const devices = Array.from(knownDeviceSNs).map(sn => ({
        sn,
        pendingCommands: (pendingCommands.get(sn) || []).length
    }));
    res.json({ total: devices.length, devices });
});

// ─── ZKTeco: Función para encolar envío de usuario a la máquina ────────────
const globalCommands = [];
function pushUserToDevice(biometricId, nombre, apellidos) {
    if (!biometricId) return 0;
    const fullName = `${nombre || ''} ${apellidos || ''}`.trim().substring(0, 24); // ZKTeco max 24 chars
    // Formato ADMS: campos separados por TAB
    const cmd = `DATA UPDATE USERINFO PIN=${biometricId}\tName=${fullName}\tPrivilege=0\tPassword=\tEnabled=1\tCardNo=0\tGroup=1\tTimeZone=0\tVerify=0`;
    let pushed = 0;
    if (knownDeviceSNs.size === 0) {
        console.log(`[ZKTeco] ⚠️ No hay dispositivos conectados. El usuario PIN=${biometricId} se encolará globalmente.`);
        globalCommands.push(cmd);
        return 1;
    }
    for (const sn of knownDeviceSNs) {
        if (!pendingCommands.has(sn)) pendingCommands.set(sn, []);
        pendingCommands.get(sn).push(cmd);
        console.log(`[ZKTeco] ✅ Encolado usuario PIN=${biometricId} (${fullName}) para dispositivo SN=${sn}`);
        pushed++;
    }
    return pushed;
}

// ─── ZKTeco: Endpoint manual para enviar un empleado a la máquina ──────────
app.post('/api/zkteco/push-user', async (req, res) => {
    try {
        const { biometricId, nombre, apellidos, employeeId } = req.body;

        let finalBiometricId = biometricId;
        let finalNombre = nombre;
        let finalApellidos = apellidos;

        // Si se pasa employeeId, buscar los datos del empleado en la DB
        if (employeeId && !biometricId) {
            const pool = await poolPlanilla;
            const empRes = await pool.request()
                .input('id', mssql.Int, employeeId)
                .query('SELECT BIOMETRIC_ID, NOMBRE, APELLIDOS FROM EMPLOYEES WHERE ID_EMPLOYEE = @id');
            if (empRes.recordset.length === 0) {
                return res.status(404).json({ error: 'Empleado no encontrado' });
            }
            const emp = empRes.recordset[0];
            finalBiometricId = emp.BIOMETRIC_ID;
            finalNombre = emp.NOMBRE;
            finalApellidos = emp.APELLIDOS;
        }

        if (!finalBiometricId) {
            return res.status(400).json({ error: 'Se requiere biometricId o employeeId con BIOMETRIC_ID asignado' });
        }

        const pushed = pushUserToDevice(finalBiometricId, finalNombre, finalApellidos);
        const fullName = `${finalNombre || ''} ${finalApellidos || ''}`.trim();

        res.json({
            success: true,
            message: pushed > 0
                ? `Usuario ${fullName} (PIN=${finalBiometricId}) encolado para ${pushed} dispositivo(s). Se sincronizará en la próxima consulta de la máquina (~30 seg).`
                : `Usuario ${fullName} (PIN=${finalBiometricId}) guardado. Cuando la máquina se conecte, recibirá el usuario automáticamente.`,
            devicesQueued: pushed,
            devicesConnected: knownDeviceSNs.size
        });
    } catch (error) {
        res.status(500).json({ error: 'Error al encolar usuario', details: error.message });
    }
});

// ─── ZKTeco: Sincronizar TODOS los empleados activos a la máquina ──────────
app.post('/api/zkteco/sync-all-employees', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        const empRes = await pool.request().query(
            'SELECT BIOMETRIC_ID, NOMBRE, APELLIDOS FROM EMPLOYEES WHERE ACTIVO = 1 AND BIOMETRIC_ID IS NOT NULL'
        );
        const employees = empRes.recordset;
        let pushed = 0;
        for (const emp of employees) {
            pushUserToDevice(emp.BIOMETRIC_ID, emp.NOMBRE, emp.APELLIDOS);
            pushed++;
        }
        res.json({
            success: true,
            message: `${pushed} empleados encolados para ${knownDeviceSNs.size} dispositivo(s).`,
            employeesSynced: pushed,
            devicesConnected: knownDeviceSNs.size
        });
    } catch (error) {
        res.status(500).json({ error: 'Error al sincronizar empleados', details: error.message });
    }
});

app.get('/api/attendance/debug-biometric-users', (req, res) => {
    const users = Array.from(biometricUsersCache.entries()).map(([pin, name]) => ({
        pin,
        name
    }));
    console.log(`[DEBUG-API] Consultando cache de usuarios. Total en memoria: ${users.length}`);
    res.json({
        total: users.length,
        users
    });
});

app.post('/iclock/devicecmd', (req, res) => {
    res.setHeader('Content-Type', 'text/plain');
    res.end('OK\n');
});

app.get('/api/attendance/history/:idEmployee', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        const { idEmployee } = req.params;

        const result = await pool.request()
            .input('idEmp', mssql.Int, idEmployee)
            .query(`
                SELECT * FROM ATTENDANCE_DAILY_REPORTS 
                WHERE ID_EMPLOYEE = @idEmp 
                ORDER BY DATE DESC
            `);

        const history = result.recordset.map(row => {
            const formatTime = (date) => {
                if (!date) return '-- : --';
                const d = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
                return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
            };

            return {
                date: row.DATE,
                clockIn: formatTime(row.FIRST_ENTRY),
                clockOut: formatTime(row.LAST_EXIT),
                totalHours: `${row.TOTAL_HOURS}h`,
                status: row.STATUS,
                observations: row.OBSERVATIONS
            };
        });

        res.json(history);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/attendance/observation', async (req, res) => {
    try {
        const { employeeId, date, observation } = req.body;
        const pool = await poolPlanilla;

        await pool.request()
            .input('empId', mssql.Int, employeeId)
            .input('date', mssql.Date, date)
            .input('obs', mssql.NVarChar(mssql.MAX), observation)
            .query(`
                IF EXISTS (SELECT 1 FROM ATTENDANCE_DAILY_REPORTS WHERE ID_EMPLOYEE = @empId AND DATE = @date)
                    UPDATE ATTENDANCE_DAILY_REPORTS SET OBSERVATIONS = @obs WHERE ID_EMPLOYEE = @empId AND DATE = @date
                ELSE
                    INSERT INTO ATTENDANCE_DAILY_REPORTS (ID_EMPLOYEE, DATE, OBSERVATIONS) VALUES (@empId, @date, @obs)
            `);

        res.json({ success: true, message: 'Observación guardada correctamente' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/attendance/logs', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        const { date } = req.query;

        let query = `
            SELECT 
                l.*, 
                e.NOMBRE as EMP_NOMBRE,
                e.APELLIDOS as EMP_APELLIDOS,
                bu.NAME as BIO_NAME,
                e.CARGO, 
                e.DEPARTAMENTO, 
                e.ENTRY_TIME, 
                e.EXIT_TIME, 
                e.JORNADA_LABORAL
            FROM ATTENDANCE_LOGS l
            LEFT JOIN EMPLOYEES e ON CAST(l.USERID AS INT) = CAST(e.BIOMETRIC_ID AS INT)
            LEFT JOIN BIOMETRIC_USERS bu ON CAST(l.USERID AS INT) = CAST(bu.PIN AS INT)
        `;

        if (date) {
            query += ` WHERE CAST(l.CHECKTIME AS DATE) = '${date}'`;
        }

        const result = await pool.request().query(query + ' ORDER BY l.CHECKTIME DESC');

        // Formatear para evitar el desfase de zona horaria (UTC -> Local)
        const logs = result.recordset.map(log => {
            const nombre = log.EMP_NOMBRE || log.BIO_NAME || `ID Desconocido (${log.USERID})`;
            const apellidos = log.EMP_APELLIDOS || '';

            // Convertimos la fecha a un string local ISO sin la 'Z' para que el navegador no la mueva
            const checkTimeLocal = log.CHECKTIME ? new Date(log.CHECKTIME.getTime() - (log.CHECKTIME.getTimezoneOffset() * 60000)).toISOString().slice(0, 19).replace('T', ' ') : null;

            return {
                ...log,
                NOMBRE: nombre,
                APELLIDOS: apellidos,
                CHECKTIME: checkTimeLocal // Enviamos el string literal "YYYY-MM-DD HH:mm:ss"
            };
        });

        res.json(logs);
    } catch (error) {
        console.error('[API] Error al obtener logs:', error);
        res.status(500).json({ error: 'Error al obtener registros de asistencia' });
    }
});

app.get('/api/attendance/raw-logs', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        const result = await pool.request().query('SELECT TOP 50 * FROM ATTENDANCE_LOGS ORDER BY CHECKTIME DESC');

        // Aplicamos el mismo ajuste de zona horaria para raw-logs
        const logs = result.recordset.map(log => ({
            ...log,
            CHECKTIME: log.CHECKTIME ? new Date(log.CHECKTIME.getTime() - (log.CHECKTIME.getTimezoneOffset() * 60000)).toISOString().slice(0, 19).replace('T', ' ') : null
        }));

        res.json(logs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('*', (req, res) => {
    if (!req.path.startsWith('/api/') && !req.path.startsWith('/iclock/')) {
        res.sendFile(path.join(distPath, 'index.html'), (err) => {
            if (err) {
                res.status(404).send("Frontend not found in 'public' folder. Check volumes.");
            }
        });
    }
});
const admsPort = 8081;
const admsServer = http.createServer(app);
admsServer.listen(admsPort, '0.0.0.0', () => {
});

app.get('/api/attendance/raw-logs', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        const result = await pool.request().query('SELECT TOP 50 * FROM ATTENDANCE_LOGS ORDER BY CHECKTIME DESC');
        res.json(result.recordset);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.use((err, req, res, next) => {
    console.error('--- ERROR GLOBAL DEL SERVIDOR ---');
    console.error(err.stack || err);
    res.status(500).json({
        success: false,
        error: 'Error interno del servidor',
        message: err.message
    });
});

app.listen(port, () => {
}).on('error', (err) => {
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    if (reason && reason.stack);
});

process.on('uncaughtException', (err) => {
    if (err && err.stack);
    process.exit(1);
});
