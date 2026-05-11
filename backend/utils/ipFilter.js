import mssql from 'mssql';
import { poolPlanilla } from '../config/dbSql.js';

const MASTER_KEY = 'hw-peru-2025-seguro';
export const ALLOWED_IPS = [
    '38.253.148.143',
    '127.0.0.1',
    '::1',
    '::ffff:127.0.0.1',
    '15.235.16.229',
    '::ffff:15.235.16.229',
    '179.6.7.253',            // PC local autorizada - 01/04/2026
    '::ffff:179.6.7.253'
];

export const ipFilter = async (req, res, next) => {
    try {
        if (req.method === 'OPTIONS') {
            return next();
        }

        const forwarded = req.headers['x-forwarded-for'];
        let clientIp = req.ip ||
            (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : forwarded) ||
            req.socket.remoteAddress;

        const cleanIp = clientIp.replace('::ffff:', '');

        if (ALLOWED_IPS.includes(cleanIp) || ALLOWED_IPS.includes(clientIp)) {
            return next();
        }

        if (req.originalUrl === '/api/debug-ip' || req.originalUrl === '/api/login') {
            return next();
        }

        const accessKey = req.headers['x-hwperu-key'] || req.query.key;
        if (accessKey === MASTER_KEY) {
            return next();
        }

        try {
            const pool = await poolPlanilla;
            const dbCheck = await pool.request()
                .input('ip', mssql.VarChar, cleanIp)
                .query('SELECT TOP 1 ID FROM ALLOWED_IPS_WHITELIST WHERE IP_ADDRESS = @ip');

            if (dbCheck.recordset.length > 0) {
                return next();
            }
        } catch (dbError) {
            console.error('DB_IP_CHECK_ERROR:', dbError);
            if (cleanIp === '127.0.0.1' || cleanIp === '::1') return next();
        }

        console.log(`--- ACCESO DENEGADO --- 
            IP detectada: ${clientIp}
            IP (req.ip): ${req.ip}
            X-Forwarded-For: ${forwarded}
            RemoteAddress: ${req.socket.remoteAddress}
            Llave: ${accessKey ? 'SI' : 'NO'} 
            URL: ${req.originalUrl}`);

        if (req.originalUrl.startsWith('/api/')) {
            return res.status(403).json({
                success: false,
                message: 'ACCESO_DENEGADO_IP_RESTRINGIDA',
                details: 'Acceso no permitido: Su IP no está autorizada. Este intento está siendo monitoreado.',
                detectedIp: clientIp
            });
        }

        res.status(403).send(`
            <div style="text-align:center; padding: 50px; font-family: sans-serif; background-color: #f8fafc; height: 100vh;">
                <h1>🚫 Acceso No Autorizado</h1>
                <p>Tu IP (${clientIp}) no está en la lista blanca.</p>
            </div>
        `);
    } catch (error) {
        console.error('IP_FILTER_ERROR:', error);
        next();
    }
};

export default ipFilter;