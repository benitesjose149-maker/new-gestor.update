import express from 'express';
import axios from 'axios';
import { getSecret } from '../utils/secrets.js';

const router = express.Router();

const WHMCS_API_URL = getSecret('whmcs_api_url', 'http://cliente.hwperu.com/includes/api.php');
const WHMCS_IDENTIFIER = getSecret('whmcs_identifier', 'Pb55YUTQVfK73P5U1xLu9yF0jbKvZTeq');
const WHMCS_SECRET = getSecret('whmcs_secret', 'hu8U5fQ80TVCHMW4ZBwBR7mYi1Iuw7HR');

router.get('/payment-methods', async (req, res) => {
    try {
        const params = new URLSearchParams();
        params.append('identifier', WHMCS_IDENTIFIER);
        params.append('secret', WHMCS_SECRET);
        params.append('action', 'GetPaymentMethods');
        params.append('responsetype', 'json');

        const response = await axios.post(WHMCS_API_URL, params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        if (response.data.result === 'success') {
            res.json({
                success: true,
                total: response.data.totalresults,
                paymentMethods: response.data.paymentmethods?.paymentmethod || []
            });
        } else {
            res.status(400).json({
                success: false,
                error: response.data.message || 'Error al obtener métodos de pago'
            });
        }
    } catch (error) {
        console.error('Error in GetPaymentMethods:', error.message);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor'
        });
    }
});

export default router;
