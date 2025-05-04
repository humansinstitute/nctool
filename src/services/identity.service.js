import NostrIdentity from '../models/NostrIdentity.model.js';
import { NDKPrivateKeySigner } from "@nostr-dev-kit/ndk";
import { logger } from '../utils/logger.js';

/**
 * Retrieves all Nostr identities from MongoDB.
 * @returns {Promise<Array<Object>>} Array of identity objects
 */
export async function getAllKeys() {
    try {
        const keys = await NostrIdentity.find({}).lean();
        console.log(`DEBUG getAllKeys found ${keys.length} keys, npubs: ${keys.map(k => k.npub).join(', ')}`);
        return keys;
    } catch (error) {
        console.error("Error fetching all keys:", error);
        throw new Error("Failed to retrieve keys from database.");
    }
}
export async function updateWalletInfo(npub, walletData) {
    if (!npub || !walletData) throw new Error("NPUB and wallet data must be provided.");
    try {
        const updated = await NostrIdentity.findOneAndUpdate(
            { npub: npub },
            { wallet: walletData },
            { new: true }
        ).lean();
        return updated;
    } catch (error) {
        console.error(`Error updating wallet info for npub ${npub}:`, error);
        throw new Error("Failed to update wallet information.");
    }
}

/**
 * Generates a new Nostr keypair, associates it with a name and wa_gate_id, and saves it.
 * @param {string} name
 * @param {string} wa_gate_id
 * @returns {Promise<Object>} Created identity object
 */
export async function generateKeyPair(name, wa_gate_id) {
    if (!name || !wa_gate_id) {
        throw new Error("Name and wa_gate_id are required to generate a key pair.");
    }
    const signer = NDKPrivateKeySigner.generate();
    const keyData = {
        name,
        privkey: signer.privateKey,
        pubkey: signer.pubkey,
        nsec: signer.nsec,
        npub: signer.userSync.npub,
        wa_gate_id
    };
    try {
        const newIdentity = new NostrIdentity(keyData);
        await newIdentity.save();
        logger.info('New user created in database:', { user: newIdentity.toObject() });
        return newIdentity.toObject();
    } catch (error) {
        console.error("Error saving generated key pair:", error);
        if (error.code === 11000) {
            throw new Error("An identity with one of these unique keys already exists.");
        }
        throw new Error("Failed to save new key pair to database.");
    }
}

/**
 * Retrieves the private key (nsec) for a given npub.
 * @param {string} npub
 * @returns {Promise<string>} nsec string
 */
export async function getPrivateKeyByNpub(npub) {
    if (!npub) throw new Error("NPUB must be provided.");
    try {
        const identity = await NostrIdentity.findOne({ npub }).select('nsec').lean();
        if (!identity) {
            throw new Error(`No key found for npub: ${npub}`);
        }
        return identity.nsec;
    } catch (error) {
        console.error(`Error fetching key for npub ${npub}:`, error);
        throw new Error("Database lookup failed.");
    }
}

/**
 * Retrieves a Nostr identity by WhatsApp Gate ID.
 * @param {string} wa_gate_id
 * @returns {Promise<Object|null>} Identity object or null
 */
export async function getIdentityByWaGateId(wa_gate_id) {
    if (!wa_gate_id) throw new Error("WhatsApp Gate ID must be provided.");
    try {
        return await NostrIdentity.findOne({ wa_gate_id }).lean();
    } catch (error) {
        console.error(`Error fetching identity for wa_gate_id ${wa_gate_id}:`, error);
        throw new Error("Database lookup failed.");
    }
}
