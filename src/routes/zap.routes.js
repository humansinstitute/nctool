import express from "express";
import { createZap, diagnostics } from "../controllers/zap.controller.js";

const router = express.Router();

// POST /api/zap
router.post("/zap", createZap);
router.get("/zap/diagnostics", diagnostics);

export default router;
