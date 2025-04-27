import { connect } from './nostr.service.js';
import { nip19 } from 'nostr-tools';
import { randomUUID } from 'crypto';

const sessions = new Map();

/**
 * Start a streaming session by creating an NDK subscription.
 * @param {string} npub - NIP-19 encoded public key (npub...).
 * @returns {string} sessionId
 */
export async function startSession(npub) {
    const id = randomUUID();
    const { ndk } = await connect();
    let filter = { kinds: [30078] };
    if (npub) {
        const { data: authorHex } = nip19.decode(npub);
        filter = { ...filter, authors: [authorHex] };
    }
    const sub = ndk.subscribe(filter, { closeOnEose: false });
    sessions.set(id, { sub, clients: [] });
    return id;
}

/**
 * Retrieve a session by ID.
 * @param {string} id
 */
export function getSession(id) {
    return sessions.get(id);
}

/**
 * Stop a session and remove it.
 * @param {string} id
 * @returns {boolean} True if session was found and stopped.
 */
export function stopSession(id) {
    const session = sessions.get(id);
    if (!session) return false;
    session.sub.stop();
    sessions.delete(id);
    return true;
}

export { sessions };
