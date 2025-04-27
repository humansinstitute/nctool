import express from 'express';
import { generateKey, getKeysController } from '../controllers/id.controller.js';
import { asyncHandler } from '../middlewares/asyncHandler.js';

const router = express.Router();

router.post('/generateKey', asyncHandler(generateKey));
router.get('/getKeys', asyncHandler(getKeysController));

export default router;
