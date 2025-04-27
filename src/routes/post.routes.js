import express from 'express';
import { createPost, viewPosts, sendNoteController } from '../controllers/post.controller.js';
import { asyncHandler } from '../middlewares/asyncHandler.js';

const router = express.Router();

router.post('/', asyncHandler(createPost));
router.post('/note', asyncHandler(sendNoteController));
router.get('/view10', asyncHandler(viewPosts));

export default router;
