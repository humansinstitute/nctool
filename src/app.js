import express from 'express';
import morgan from 'morgan';
import idRoutes from './routes/id.routes.js';
import profileRoutes from './routes/profile.routes.js';
import postRoutes from './routes/post.routes.js';
import actionRoutes from './routes/action.routes.js';
import powRoutes from './routes/pow.routes.js';
import streamRoutes from './routes/stream.routes.js';
import walletRoutes from './routes/wallet.routes.js';
import { errorHandler } from './middlewares/errorHandler.js';

export const app = express();
app.use(express.json());
app.use(morgan('dev'));

app.use('/id', idRoutes);
app.use('/profile', profileRoutes);
app.use('/post', postRoutes);
app.use('/action', actionRoutes);
app.use('/pow', powRoutes);
app.use('/stream', streamRoutes);
app.use('/wallet', walletRoutes);

app.use(errorHandler);
