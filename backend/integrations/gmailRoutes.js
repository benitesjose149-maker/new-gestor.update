import express from 'express';
import { testConnection, processEmails, debugParser, rawSearch, getMessage } from './gmailController.js';

const router = express.Router();

router.get('/gmail/test', testConnection);

router.get('/gmail/process', processEmails);

router.post('/gmail/debug-parser', debugParser);

router.get('/gmail/raw-search', rawSearch);
router.get('/gmail/message/:id', getMessage);

export default router;
