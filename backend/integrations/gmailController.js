import { getGmailClient } from './gmailClient.js';
import { parseBankEmail, extractTextFromMessage } from './gmailParser.js';
import { poolFinance } from '../config/dbSql.js';
import mssql from 'mssql';

/**
 * Test Gmail API connection.
 */
export async function testConnection(req, res) {
    try {
        const gmail = getGmailClient();
        const profile = await gmail.users.getProfile({ userId: 'me' });
        res.json({
            success: true,
            email: profile.data.emailAddress,
            messagesTotal: profile.data.messagesTotal,
            threadsTotal: profile.data.threadsTotal
        });
    } catch (error) {
        console.error('Gmail connection test failed:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

export async function processEmails(req, res) {
    try {
        const gmail = getGmailClient();
        const maxResults = parseInt(req.query.maxResults) || 100;
        const autoCreate = req.query.autoCreate === 'true';
        const days = parseInt(req.query.days) || 7;
        const fromEmail = req.query.fromEmail || '';

        const afterDate = new Date();
        afterDate.setDate(afterDate.getDate() - days);
        const afterStr = `${afterDate.getFullYear()}/${(afterDate.getMonth() + 1).toString().padStart(2, '0')}/${afterDate.getDate().toString().padStart(2, '0')}`;

        let query = `after:${afterStr}`;

        if (fromEmail) {
            query += ` from:${fromEmail}`;
        } else {
            const bankSenders = [
                'notificacionesbcp@bcp.com.pe',
                'notificaciones@notificacionesbcp.com.pe',
                'notificaciones@interbank.pe',
                'servicioalcliente@netinterbank.com.pe',
                'no-reply@yape.com.pe',
                'noreply@yape.com.pe',
                'notificaciones@yape.com.pe',
                'info@plin.pe',
            ];
            const fromClause = bankSenders.map(s => `from:${s}`).join(' OR ');
            query += ` (${fromClause})`;
        }

        console.log(`[Gmail] Searching with query: ${query}`);

        const listRes = await gmail.users.messages.list({
            userId: 'me',
            q: query,
            maxResults
        });

        const messages = listRes.data.messages || [];
        console.log(`[Gmail] Found ${messages.length} messages`);

        const results = [];
        let saved = 0;

        for (const msg of messages) {
            const fullMsg = await gmail.users.messages.get({
                userId: 'me',
                id: msg.id,
                format: 'full'
            });

            const headers = fullMsg.data.payload?.headers || [];
            const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || '';
            const from = headers.find(h => h.name.toLowerCase() === 'from')?.value || '';
            const dateHeader = headers.find(h => h.name.toLowerCase() === 'date')?.value || '';

            const body = extractTextFromMessage(fullMsg.data);
            const parsed = parseBankEmail(subject, body, from, dateHeader);

            const result = {
                messageId: msg.id,
                from,
                subject,
                date: dateHeader,
                parsed
            };

            if (parsed && autoCreate) {
                try {
                    const pool = await poolFinance;
                    const existing = await pool.request()
                        .input('ref', mssql.NVarChar, `gmail:${msg.id}`)
                        .query('SELECT ID FROM FINANCE_EGRESOS WHERE Referencia = @ref');

                    if (existing.recordset.length === 0) {
                        const request = pool.request();
                        request.input('fecha', mssql.Date, parsed.fecha ? new Date(parsed.fecha) : new Date());
                        request.input('monto', mssql.Decimal(18, 2), parsed.monto);
                        request.input('banco', mssql.NVarChar(100), parsed.banco);
                        request.input('tipo', mssql.NVarChar(100), parsed.tipoEgreso);
                        request.input('comercio', mssql.NVarChar(255), parsed.comercio);
                        request.input('ref', mssql.NVarChar(255), `gmail:${msg.id}`);
                        request.input('origen', mssql.NVarChar(50), 'GMAIL');
                        request.input('codigo', mssql.NVarChar(100), parsed.codigoContable || '');

                        await request.query(`
                            INSERT INTO FINANCE_EGRESOS (Fecha, Monto, Banco, TipoEgreso, Comercio, Referencia, Origen, CodigoContable, CreatedAt, UpdatedAt)
                            VALUES (@fecha, @monto, @banco, @tipo, @comercio, @ref, @origen, @codigo, GETDATE(), GETDATE())
                        `);
                        saved++;
                        result.savedToDb = true;
                    } else {
                        result.savedToDb = false;
                        result.alreadyExists = true;
                    }
                } catch (dbErr) {
                    console.error(`[Gmail] Error saving egreso for msg ${msg.id}:`, dbErr.message);
                    result.dbError = dbErr.message;
                }
            }

            results.push(result);
        }

        res.json({
            success: true,
            totalScanned: messages.length,
            totalParsed: results.filter(r => r.parsed).length,
            totalSaved: saved,
            results
        });

    } catch (error) {
        console.error('Error processing Gmail:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
}

/**
 * Debug parser — test with manual text input.
 * POST body: { subject, body, from, date }
 */
export async function debugParser(req, res) {
    try {
        const { subject, body, from, date } = req.body;
        const result = parseBankEmail(subject || '', body || '', from || '', date || new Date().toISOString());
        res.json({
            success: true,
            input: { subject, from, bodyPreview: (body || '').substring(0, 200) },
            parsed: result
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

/**
 * Test a raw query directly against the Gmail API
 * GET /api/gmail/raw-search?q=your_query
 */
export async function rawSearch(req, res) {
    try {
        const gmail = getGmailClient();
        const query = req.query.q || '';
        const listRes = await gmail.users.messages.list({
            userId: 'me',
            q: query,
            maxResults: 10
        });
        const messages = listRes.data.messages || [];
        const results = [];

        for (const msg of messages) {
            const detail = await gmail.users.messages.get({
                userId: 'me',
                id: msg.id,
                format: 'metadata'
            });
            const headers = detail.data.payload?.headers || [];
            results.push({
                id: msg.id,
                from: headers.find(h => h.name.toLowerCase() === 'from')?.value || '',
                subject: headers.find(h => h.name.toLowerCase() === 'subject')?.value || '',
                date: headers.find(h => h.name.toLowerCase() === 'date')?.value || ''
            });
        }

        res.json({
            success: true,
            query,
            totalFound: messages.length,
            messages: results
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

/**
 * Get a single message by ID (for debugging)
 * GET /api/gmail/message/:id?key=...
 */
export async function getMessage(req, res) {
    try {
        const gmail = getGmailClient();
        const id = req.params.id;
        const msg = await gmail.users.messages.get({
            userId: 'me',
            id: id,
            format: 'full'
        });

        const body = extractTextFromMessage(msg.data);
        const headers = msg.data.payload?.headers || [];
        const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || '';
        const from = headers.find(h => h.name.toLowerCase() === 'from')?.value || '';

        res.json({
            success: true,
            id,
            from,
            subject,
            body
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}
