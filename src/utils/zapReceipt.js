import { NDKEvent } from "@nostr-dev-kit/ndk";

// Build a minimal NIP-57 zap receipt (kind 9735)
export function buildZapReceipt(ndk, { senderPubHex, recipientPubHex, invoice, amount, context = {} }) {
  const tags = [];
  if (recipientPubHex) tags.push(["p", recipientPubHex]);
  if (invoice) tags.push(["bolt11", invoice]);
  // Optional: include simple description for traceability (not a full zap request)
  tags.push(["description", JSON.stringify({ amount, ...context })]);

  const evt = new NDKEvent(ndk, {
    kind: 9735,
    tags,
    content: "", // receipts commonly use empty content
  });
  return evt;
}

