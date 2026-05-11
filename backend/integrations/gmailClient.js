import { google } from 'googleapis';
import { getSecret } from '../utils/secrets.js';

/**
 * Creates and returns an authenticated Gmail API client.
 */
export function getGmailClient() {
    const clientId = getSecret('GMAIL_CLIENT_ID');
    const clientSecret = getSecret('GMAIL_CLIENT_SECRET');
    const redirectUri = getSecret('GMAIL_REDIRECT_URI', 'https://developers.google.com/oauthplayground');
    const refreshToken = getSecret('GMAIL_REFRESH_TOKEN');

    if (!clientId || !clientSecret || !refreshToken) {
        throw new Error('Gmail OAuth2 credentials are missing. Check secrets: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN');
    }

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    return google.gmail({ version: 'v1', auth: oauth2Client });
}

/**
 * Returns the OAuth2 client for generating auth URLs.
 */
export function getOAuth2Client() {
    const clientId = getSecret('GMAIL_CLIENT_ID');
    const clientSecret = getSecret('GMAIL_CLIENT_SECRET');
    const redirectUri = getSecret('GMAIL_REDIRECT_URI', 'https://developers.google.com/oauthplayground');

    return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}
