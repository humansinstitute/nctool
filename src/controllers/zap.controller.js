import { asyncHandler } from "../middlewares/asyncHandler.js";
import { zapHandler } from "../services/zap.service.js";

export const createZap = asyncHandler(async (req, res) => {
  const result = await zapHandler(req.body);
  if (!result.success) {
    res.status(result.status || 500).json(result);
    return;
  }
  res.json(result);
});

export const diagnostics = asyncHandler(async (req, res) => {
  const mode = (process.env.NOSTR_RELAY_MODE || "").toLowerCase() || "local";
  const envStr = (process.env.NOSTR_REMOTE_RELAYS || process.env.NOSTR_LOCAL_RELAYS || "").trim();
  let relayList = envStr ? envStr.split(",").map((s) => s.trim()).filter(Boolean) : [];
  if (!relayList.includes("wss://purplepag.es")) relayList.push("wss://purplepag.es");
  const timeoutMs = parseInt(process.env.ZAP_PROFILE_TIMEOUT_MS || "5000", 10);
  res.json({ mode, relays: relayList, profileTimeoutMs: timeoutMs });
});
