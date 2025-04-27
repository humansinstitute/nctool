import express from 'express';
import { startStream, streamEvents, stopStream } from '../controllers/stream.controller.js';

const router = express.Router();

router.post('/start', startStream);
router.get('/events/:id', streamEvents);
router.delete('/stop/:id', stopStream);

export default router;
