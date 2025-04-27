import express from 'express';
import { updateProfile } from '../controllers/profile.controller.js';
import { asyncHandler } from '../middlewares/asyncHandler.js';

const router = express.Router();

router.post('/update', asyncHandler(updateProfile));

export default router;
