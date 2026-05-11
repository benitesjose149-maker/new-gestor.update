import fs from 'fs';
import path from 'path';

export function getSecret(secretName, defaultValue = null) {
    const secretPath = path.join('/run/secrets', secretName);
    try {
        if (fs.existsSync(secretPath)) {
            return fs.readFileSync(secretPath, 'utf8').trim();
        }
    } catch (err) {
    }

    const envValue = process.env[secretName] || process.env[secretName.toUpperCase()] || process.env[secretName.toLowerCase()];
    if (envValue !== undefined) {
        return envValue;
    }

    return defaultValue;
}

export default getSecret;
