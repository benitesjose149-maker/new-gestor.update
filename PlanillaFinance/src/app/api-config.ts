export const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://15.235.16.229:3000'
    : '';

export const getAuthHeaders = (extraHeaders = {}) => {
    const masterKey = localStorage.getItem('hwperu_master_key') || '';
    return {
        'Content-Type': 'application/json',
        'x-hwperu-key': masterKey,
        ...extraHeaders
    };
};
