import 'dotenv/config';
import express from 'express';
import {
  buildZapRequest,
  buildZapReceipt,
  getLnurlpMeta,
  requestInvoice,
  payInvoice,
  publish,
  discoverLnurl,
} from './zap.service.js';

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

// POST /zap
// Body: { recipientNpub: 'npub1...', amount: <sats>, lightningAddress?: 'name@domain', comment?: string, targetType?: 'e'|'a', target?: string, relays?: string[] }
app.post('/zap', async (req, res) => {
  try {
    const { recipientNpub, amount, lightningAddress, comment, targetType, target, relays } = req.body || {};
    if (!recipientNpub || typeof recipientNpub !== 'string') return res.status(400).json({ error: 'recipientNpub required' });
    const sats = Number(amount);
    if (!Number.isFinite(sats) || sats <= 0) return res.status(400).json({ error: 'amount (sats) must be > 0' });
    const msats = Math.floor(sats * 1000);

    const extraTags = [];
    if (comment && String(comment).trim()) extraTags.push(['comment', String(comment).trim()]);
    if (targetType === 'e' && target) extraTags.push(['e', String(target).trim()]);
    if (targetType === 'a' && target) extraTags.push(['a', String(target).trim()]);

    const zapReq = buildZapRequest({ recipientNpub, msats, extraTags });

    let callback;
    let meta;
    if (lightningAddress) {
      ({ meta } = await getLnurlpMeta(lightningAddress));
      callback = meta.callback;
    } else {
      const ln = await discoverLnurl(recipientNpub);
      meta = ln.meta;
      callback = ln.callback;
    }
    const min = Math.ceil((meta.minSendable || 0) / 1000);
    const max = Math.floor((meta.maxSendable || Infinity) / 1000);
    if (msats < (meta.minSendable || 0) || msats > (meta.maxSendable || msats)) {
      return res.status(400).json({ error: `Amount must be between ${min} and ${max} sats` });
    }

    const invoice = await requestInvoice(callback, msats, zapReq);
    const meltResult = await payInvoice(invoice);

    const relaysList = Array.isArray(relays) ? relays : String(process.env.RELAYS || '').split(',').map(s=>s.trim()).filter(Boolean);
    const receipt = buildZapReceipt({ zapRequest: zapReq, invoice, preimage: null, relays: relaysList });
    const publishedRelays = await publish(receipt, relaysList);

    res.json({
      success: true,
      data: {
        invoice,
        melt: meltResult,
        receiptId: receipt.id,
        publishedRelays,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

const PORT = process.env.PORT || 4055;
app.listen(PORT, () => console.log(`as_zapper listening on ${PORT}`));
