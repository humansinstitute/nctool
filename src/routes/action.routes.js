import express from 'express';
import { takeActionController, publishActionController, publishEncryptedActionController } from '../controllers/action.controller.js';
import { asyncHandler } from '../middlewares/asyncHandler.js';

const router = express.Router();

router.post('/take', asyncHandler(takeActionController));
router.post('/', asyncHandler(publishActionController));
router.post('/encrypted', asyncHandler(publishEncryptedActionController));

export default router;
