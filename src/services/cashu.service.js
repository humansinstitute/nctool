import crypto from 'crypto';
import { getPublicKey, nip19, nip04 } from 'nostr-tools';

/**
 * Generates a P2PK keypair for an eCash wallet.
 * @returns {{ privkey: string, pubkey: string }} Private key and public key (hex without prefix).
 */
export function generateP2PKKeypair() {
    try {
        const privkey = crypto.randomBytes(32).toString('hex');
        const fullPubKey = getPublicKey(privkey);
        // Remove '02' prefix for storage per NIP-61
        const pubkey = fullPubKey.startsWith('02') ? fullPubKey.slice(2) : fullPubKey;
        return { privkey, pubkey };
    } catch (error) {
        console.error('Error generating P2PK keypair:', error);
        throw error;
    }
}

/**
 * Checks if a wallet metadata event (kind 17375) exists for the given user.
 * @param {string} npub - User's Nostr npub string.
 * @param {NDK} ndk - Connected NDK instance.
 * @returns {Promise<boolean>} True if a wallet event exists, false otherwise.
 */
export async function checkWalletExists(npub, ndk) {
    try {
        const { data: pubHex } = nip19.decode(npub);
        const events = await ndk.fetchEvents({ authors: [pubHex], kinds: [17375], limit: 1 });
        return events.size > 0;
    } catch (error) {
        console.error('Error checking wallet existence:', error);
        throw error;
    }
}

/**
 * Retrieves and decrypts the wallet metadata for the given user.
 * @param {string} npub - User's Nostr npub string.
 * @param {string} nsec - User's Nostr nsec (private key).
 * @param {NDK} ndk - Connected NDK instance.
 * @returns {Promise<{ mint: string, p2pkPriv: string, p2pkPub: string } | null>}
 */
export async function getWalletDetails(npub, nsec, ndk) {
    try {
        const { data: pubHex } = nip19.decode(npub);
        const { data: privHex } = nip19.decode(nsec);

        const walletEvents = await ndk.fetchEvents({ authors: [pubHex], kinds: [17375], limit: 1 });
        if (walletEvents.size === 0) {
            return null;
        }
        const [event] = [...walletEvents];
        // Decrypt the content
        const decrypted = await nip04.decrypt(privHex, pubHex, event.content);
        const { mint, p2pkPriv } = JSON.parse(decrypted);

        // Fetch Nutzap info event (kind 10019) to get the public receiving key
        const infoEvents = await ndk.fetchEvents({ authors: [pubHex], kinds: [10019], limit: 1 });
        let p2pkPub = null;
        if (infoEvents.size > 0) {
            const [info] = [...infoEvents];
            const tag = info.tags.find(t => t[0] === 'pubkey');
            if (tag && tag[1]) {
                p2pkPub = tag[1].startsWith('02') ? tag[1].slice(2) : tag[1];
            }
        }

        return { mint, p2pkPriv, p2pkPub };
    } catch (error) {
        console.error('Error getting wallet details:', error);
        throw error;
    }
}
