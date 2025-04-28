import { connect } from './nostr.service.js';
import { nip19, nip04 } from 'nostr-tools';
import { getAllKeys } from './identity.service.js';
import { randomUUID } from 'crypto';

const sessions = new Map();

/**
 * Start a streaming session by creating an NDK subscription.
 * @param {string[]} npubs - Array of NIP-19 encoded public keys (npub...).
 * @returns {string} sessionId
 */
export async function startSession(npubs) {
    const id = randomUUID();
    const { ndk } = await connect();
    let filter = { kinds: [30078] }; // Default filter for kind 30078

    // If npubs array is provided and not empty, decode them and add to authors filter
    if (Array.isArray(npubs) && npubs.length > 0) {
        const authorHexKeys = npubs.map(npub => {
            try {
                return nip19.decode(npub).data;
            } catch (e) {
                console.error(`Failed to decode npub: ${npub}`, e);
                return null; // Handle potential decoding errors
            }
        }).filter(hex => hex !== null); // Filter out any nulls from failed decodes

        if (authorHexKeys.length > 0) {
            filter = { kinds: [30078], '#p': authorHexKeys };
        }
    }
    // If no valid npubs are provided, the filter will just be { kinds: [30078] }
    // which might subscribe to all kind 30078 events depending on relay behavior.
    // Consider if a default behavior is needed when no authors are specified.

    const sub = ndk.subscribe(filter, { closeOnEose: false });
    sessions.set(id, { sub, clients: [], npubs });
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
