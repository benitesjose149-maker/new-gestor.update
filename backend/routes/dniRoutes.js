
import express from 'express';
import { getDni } from '../controllers/dniController.js';

const router = express.Router();


router.get('/:dni', getDni);

export default router;
