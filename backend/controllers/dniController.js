
import https from 'https';
import { Buffer } from 'buffer';

async function consultarApiPeruDev(dni) {
    try {
        const token = process.env.APIPERUDEV_TOKEN || 'N1DvhA0R9U1rssITvTVU6rM95RjnELBqii07Cayuw0ekRsKL9e';
        const url = 'https://apiperu.dev/api/dni';

        const postData = JSON.stringify({ dni: dni });
        const urlObj = new URL(url);

        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });

                res.on('end', () => {
                    try {
                        const jsonData = JSON.parse(data);
                        if (res.statusCode === 200 && jsonData.success && jsonData.data) {
                            console.log('✔ ApiPeruDev: Datos encontrados.');
                            resolve({
                                nombres: jsonData.data.nombres || '',
                                apellidos: `${jsonData.data.apellido_paterno || ''} ${jsonData.data.apellido_materno || ''}`.trim(),
                                dni: jsonData.data.numero || dni,
                                direccion: jsonData.data.direccion || '',
                                nacionalidad: 'Peruana'
                            });
                        } else {
                            resolve(null);
                        }
                    } catch (error) { resolve(null); }
                });
            });
            req.on('error', (err) => { resolve(null); });
            req.write(postData);
            req.end();
        });
    } catch (error) { return null; }
}

async function consultarRENIEC(dni) {
    try {
        const token = process.env.APIS_NET_PE_TOKEN || 'sk_14038.HppYB1ULaHGSNFFOCKFyORMdFUlE3Nzt';
        // Usando v2 que es más estable y compatible con tokens sk_
        const url = `https://api.apis.net.pe/v2/reniec/dni?numero=${dni}`;

        const options = {
            headers: {
                'Accept': 'application/json',
                'Authorization': `Bearer ${token}`,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            }
        };

        return new Promise((resolve, reject) => {
            https.get(url, options, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });

                res.on('end', () => {
                    try {
                        const jsonData = JSON.parse(data);
                        // En v2 la estructura puede variar ligeramente
                        if (res.statusCode === 200 && jsonData) {
                            console.log('✔ APIs.net.pe (v2): Datos encontrados.');
                            resolve({
                                nombres: jsonData.nombres || '',
                                apellidos: `${jsonData.apellidoPaterno || ''} ${jsonData.apellidoMaterno || ''}`.trim(),
                                dni: jsonData.numeroDocumento || dni,
                                direccion: jsonData.direccion || '',
                                nacionalidad: 'Peruana'
                            });
                        } else {
                            resolve(null);
                        }
                    } catch (error) { resolve(null); }
                });
            }).on('error', (err) => { resolve(null); });
        });
    } catch (error) { return null; }
}

export const getDni = async (req, res) => {
    try {
        const { dni } = req.params;

        console.log(`Buscando DNI: ${dni}...`);

        console.log('Intentando con ApiPeruDev...');
        let data = await consultarApiPeruDev(dni);

        if (!data) {
            console.log('ApiPeruDev falló o no encontró datos. Intentando con RENIEC fallback...');
            data = await consultarRENIEC(dni);
        }

        if (data) {
            console.log('Datos encontrados:', data);
            res.json(data);
        } else {
            console.log('No se encontraron datos en ninguna API.');
            res.status(404).json({ error: 'No se encontraron datos para este DNI' });
        }
    } catch (error) {
        console.error('Error en controlador DNI:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
};
