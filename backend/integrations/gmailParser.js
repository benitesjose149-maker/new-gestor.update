export function parseBankEmail(subject, body, from, date) {
    const fromLower = (from || '').toLowerCase();
    const subjectLower = (subject || '').toLowerCase();
    const text = `${subject || ''}\n${body || ''}`;

    const parsers = [
        { check: () => isYapeEmail(fromLower, subjectLower, text), parse: () => parseYape(text, date) },
        { check: () => isPlinEmail(fromLower, subjectLower, text), parse: () => parsePlin(text, date) },
        { check: () => isBcpEmail(fromLower, subjectLower), parse: () => parseBcp(text, date) },
        { check: () => isInterbankEmail(fromLower, subjectLower), parse: () => parseInterbank(text, date) },
    ];

    for (const parser of parsers) {
        if (parser.check()) {
            const result = parser.parse();
            if (result && result.monto > 0) {
                result.codigoContable = guessAccountingCode(result.comercio, text);
                return result;
            }
        }
    }

    return null;
}

function guessAccountingCode(comercio, text) {
    const c = (comercio || '').toLowerCase();
    const t = (text || '').toLowerCase();

    if (c.includes('izipay') || c.includes('niubiz') || c.includes('vendemas') || c.includes('culqi') ||
        c.includes('comision') || c.includes('interes') || c.includes('mantenimiento') ||
        c.includes('paypal') || t.includes('comision') || t.includes('mantenimiento') || c.match(/bcp|interbank/)) {
        return '67';
    }
    if (c.includes('amazon') || c.includes('aws') || c.includes('google') || c.includes('facebook') || c.includes('meta') ||
        c.includes('claro') || c.includes('movistar') || c.includes('entel') || c.includes('bitel') ||
        c.includes('telefonica') || c.includes('sedapal') || c.includes('enel') || c.includes('luz del sur') ||
        c.includes('cálidda') || c.includes('hosting') || c.includes('adobe') || c.includes('microsoft')) {
        return '63';
    }
    if (c.includes('sunat') || c.includes('pagos sunat') || c.includes('impuesto') || t.includes('sunat')) {
        return '64';
    }
    if (t.includes('planilla') || t.includes('sueldo') || t.includes('quincena')) {
        return '62';
    }

    return '65';
}

function isYapeEmail(from, subject, text) {
    return from.includes('yape') || subject.includes('yape') || text.toLowerCase().includes('yapeas');
}

function isPlinEmail(from, subject, text) {
    return from.includes('plin') || subject.includes('plin') || text.toLowerCase().includes('plin');
}

function isBcpEmail(from, subject) {
    return from.includes('bcp') || from.includes('viabcp') ||
        subject.includes('bcp') || subject.includes('viabcp') ||
        from.includes('notificacionesbcp');
}

function isInterbankEmail(from, subject) {
    return from.includes('interbank') || subject.includes('interbank') ||
        from.includes('intercorp');
}

function parseYape(text, date) {
    const montoMatch = text.match(/(?:yapeaste|pago\s+con\s+yape\s+por|yape\s+de)\s*S\/?\s*([\d,]+\.?\d*)/i)
        || text.match(/S\/?\s*([\d,]+\.?\d*)/i);

    if (!montoMatch) return null;

    const monto = parseFloat(montoMatch[1].replace(/,/g, ''));

    const isIncoming = /te\s+yapear|recibiste|te\s+envi/i.test(text);
    if (isIncoming) return null;

    let comercio = 'Yape';
    const comercioMatch = text.match(/(?:yapeaste\s+.*?a\s+|en\s+|pago\s+YAPE\s+a\s+|pago\s+a\s+)([A-ZÁÉÍÓÚÑa-záéíóúñ\s\d\.]+?)(?:\s+por|\s*$)/i);
    if (comercioMatch) {
        comercio = comercioMatch[1].trim().substring(0, 200);
    }

    return {
        monto,
        banco: 'YAPE',
        tipoEgreso: 'YAPE',
        comercio,
        fecha: date || new Date().toISOString(),
        origen: 'GMAIL'
    };
}

function parsePlin(text, date) {
    const montoMatch = text.match(/(?:plin|transferencia)\s*(?:por|:)?\s*S\/?\s*([\d,]+\.?\d*)/i)
        || text.match(/S\/?\s*([\d,]+\.?\d*)/i);

    if (!montoMatch) return null;

    const monto = parseFloat(montoMatch[1].replace(/,/g, ''));
    const isIncoming = /recibiste|te\s+envi/i.test(text);
    if (isIncoming) return null;

    let comercio = 'Plin';
    const comercioMatch = text.match(/(?:a\s+|para\s+|pago\s+PLIN\s+a\s+)([A-ZÁÉÍÓÚÑa-záéíóúñ\s\d\.]+?)(?:\s+por|\s*$)/i);
    if (comercioMatch) {
        comercio = comercioMatch[1].trim().substring(0, 200);
    }

    return {
        monto,
        banco: 'PLIN',
        tipoEgreso: 'PLIN',
        comercio,
        fecha: date || new Date().toISOString(),
        origen: 'GMAIL'
    };
}

function parseBcp(text, date) {
    const montoMatch = text.match(/(?:consumo|compra|pago|transferencia|operaci[oó]n)\s*.*?(?:S\/?|US\$|USD|\$)\s*([\d,]+\.?\d*)/i)
        || text.match(/por\s+(?:S\/?|US\$|USD|\$)\s*([\d,]+\.?\d*)/i)
        || text.match(/(?:S\/?|US\$|USD|\$)\s*([\d,]+\.?\d*)/i);

    if (!montoMatch) return null;

    const monto = parseFloat(montoMatch[1].replace(/,/g, ''));

    let tipoEgreso = 'TRANSFERENCIA';
    if (/tarjeta|t\.c\.|tc\b/i.test(text)) tipoEgreso = 'TARJETA';
    if (/yape/i.test(text)) tipoEgreso = 'YAPE';

    let comercio = 'BCP';

    const regex1 = /en\s+(?:el\s+establecimiento\s+)?([A-ZÁÉÍÓÚÑa-záéíóúñ0-9\s\.\-\*\&\(\)\_\/\@\,]+?)(?:\.|\n|\r|\s+por|\s+el\b)/i;
    const regex2 = /(?:a\s+favor\s+de|para)\s+([A-ZÁÉÍÓÚÑa-záéíóúñ0-9\s\.\-\*\&\(\)\_\/\@\,]+?)(?:\.|\n|\r)/i;
    const regex3 = /(?:Establecimiento|Comercio|Tienda|Empresa)\s*:\s*([^\n\r]+)/i;

    const m1 = text.match(regex1);
    const m2 = text.match(regex2);
    const m3 = text.match(regex3);

    let tempComercio = '';
    if (m1 && m1[1]) tempComercio = m1[1].trim();
    else if (m2 && m2[1]) tempComercio = m2[1].trim();
    else if (m3 && m3[1]) tempComercio = m3[1].trim();

    const lowerTmp = tempComercio.toLowerCase();
    if (tempComercio.length > 1 &&
        !lowerTmp.includes('un plazo') &&
        !lowerTmp.includes('sorteos') &&
        lowerTmp !== 'name' &&
        lowerTmp !== 'ti' &&
        !lowerTmp.startsWith('su tarjeta') &&
        lowerTmp !== 'tu cuenta') {
        comercio = tempComercio.substring(0, 200);
    } else {
        const fallback = text.match(/(?:Empresa|Comercio|Lugar|Vendido\s+por)\s*:\s*([^\n\r]+)/i);
        if (fallback) {
            comercio = fallback[1].trim().substring(0, 200);
        } else if (text.includes('YAPE') && text.includes('a ')) {
            const yapeMatch = text.match(/enviado\s+a\s+([^\n\r]+)/i);
            if (yapeMatch) comercio = yapeMatch[1].trim().substring(0, 200);
        }
    }

    if (comercio === 'BCP') {
        console.warn('[Parser] No se pudo extraer comercio para mensaje BCP. Texto:', text.substring(0, 150).replace(/\n/g, ' '));
    } else {
        console.log(`[Parser] Comercio extraído: ${comercio}`);
    }

    return {
        monto,
        banco: 'BCP',
        tipoEgreso,
        comercio,
        fecha: date || new Date().toISOString(),
        origen: 'GMAIL'
    };
}

function parseInterbank(text, date) {
    const montoMatch = text.match(/(?:consumo|compra|pago|transferencia|operaci[oó]n)\s*.*?(?:S\/?|US\$|USD|\$)\s*([\d,]+\.?\d*)/i)
        || text.match(/por\s+(?:S\/?|US\$|USD|\$)\s*([\d,]+\.?\d*)/i)
        || text.match(/(?:S\/?|US\$|USD|\$)\s*([\d,]+\.?\d*)/i);

    if (!montoMatch) return null;

    const monto = parseFloat(montoMatch[1].replace(/,/g, ''));

    let tipoEgreso = 'TRANSFERENCIA';
    if (/tarjeta|t\.c\.|tc\b/i.test(text)) tipoEgreso = 'TARJETA';
    if (/yape/i.test(text)) tipoEgreso = 'YAPE';

    let comercio = 'Interbank';
    const comercioMatch = text.match(/(?:en\s+|en\s+el\s+establecimiento\s+)([A-ZÁÉÍÓÚÑa-záéíóúñ\s\d\.\-\*\&\(\)\_\/\@\,]+?)(?:\s+por|\s+el|\s*$)/i);
    if (comercioMatch) {
        comercio = comercioMatch[1].trim().substring(0, 200);
    }

    return {
        monto,
        banco: 'INTERBANK',
        tipoEgreso,
        comercio,
        fecha: date || new Date().toISOString(),
        origen: 'GMAIL'
    };
}

export function extractTextFromMessage(message) {
    const payload = message.payload;
    if (!payload) return '';

    if (payload.mimeType === 'text/plain' && payload.body?.data) {
        return decodeBase64Url(payload.body.data);
    }

    if (payload.parts) {
        for (const part of payload.parts) {
            if (part.mimeType === 'text/plain' && part.body?.data) {
                return decodeBase64Url(part.body.data);
            }
            if (part.parts) {
                for (const subPart of part.parts) {
                    if (subPart.mimeType === 'text/plain' && subPart.body?.data) {
                        return decodeBase64Url(subPart.body.data);
                    }
                }
            }
        }
        for (const part of payload.parts) {
            if (part.mimeType === 'text/html' && part.body?.data) {
                const html = decodeBase64Url(part.body.data);
                return stripHtml(html);
            }
        }
    }

    if (payload.body?.data) {
        const html = decodeBase64Url(payload.body.data);
        return stripHtml(html);
    }

    return '';
}

function decodeBase64Url(data) {
    const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(base64, 'base64').toString('utf-8');
}

function stripHtml(html) {
    return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
