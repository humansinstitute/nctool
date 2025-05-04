import express from 'express';
import { generateKey, getKeysController, getIdentityByGateId } from '../controllers/id.controller.js';
import { asyncHandler } from '../middlewares/asyncHandler.js';

const router = express.Router();

router.post('/generateKey', asyncHandler(generateKey));
router.get('/getKeys', asyncHandler(getKeysController));
router.get('/gate/:wa_gate_id', asyncHandler(getIdentityByGateId));

export default router;
