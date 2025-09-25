import express from 'express';
import { submit } from '../controllers/cashuwall.controller.js';
import { asyncHandler } from '../middlewares/asyncHandler.js';

const router = express.Router();

// POST /cashuwall
router.post('/', asyncHandler(submit));

export default router;

