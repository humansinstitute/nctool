import express from 'express';
import * as walletController from '../controllers/wallet.controller.js';

const router = express.Router();

router.post('/create', walletController.create);

// Future wallet endpoints (balance, receive, spend) will go here

export default router;
