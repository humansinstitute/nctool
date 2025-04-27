import express from 'express';
import { createPost, viewPosts } from '../controllers/post.controller.js';
import { asyncHandler } from '../middlewares/asyncHandler.js';

const router = express.Router();

router.post('/', asyncHandler(createPost));
router.get('/view10', asyncHandler(viewPosts));

export default router;
