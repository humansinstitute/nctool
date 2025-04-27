import express from 'express';
import { minePowController } from '../controllers/pow.controller.js';
import { asyncHandler } from '../middlewares/asyncHandler.js';

const router = express.Router();

router.post('/', asyncHandler(minePowController));

export default router;
