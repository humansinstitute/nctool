import NostrIdentity from '../models/NostrIdentity.model.js';
import { NDKPrivateKeySigner } from "@nostr-dev-kit/ndk";
import { nip19, getPublicKey } from 'nostr-tools';
import { logger } from '../utils/logger.js';
import { validateNsec, decodeNsec } from '../utils/validation.js';

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

/**
 * Imports a Nostr identity from an existing nsec private key
 * @param {string} name - Name for the imported identity
 * @param {string} nsec - The nsec private key to import
 * @returns {Promise<Object>} Created identity object
 * @throws {Error} If nsec is invalid or key already exists
 */
export async function importKeyFromNsec(name, nsec) {
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        throw new Error("Name is required and must be a non-empty string.");
    }
    
    if (!nsec || typeof nsec !== 'string') {
        throw new Error("nsec is required and must be a string.");
    }

    let privateKeyBytes;
    let publicKeyHex;
    let npub;
    
    try {
        // Validate and decode the nsec
        validateNsec(nsec);
        privateKeyBytes = decodeNsec(nsec);
        
        // Derive public key from private key
        publicKeyHex = getPublicKey(privateKeyBytes);
        
        // Encode public key as npub
        npub = nip19.npubEncode(publicKeyHex);
        
    } catch (error) {
        logger.error('Failed to process nsec during import', { error: error.message });
        throw new Error(`Invalid nsec: ${error.message}`);
    }

    // Check for duplicate keys before saving
    try {
        const existingIdentity = await NostrIdentity.findOne({
            $or: [
                { privkey: Buffer.from(privateKeyBytes).toString('hex') },
                { pubkey: publicKeyHex },
                { nsec: nsec },
                { npub: npub }
            ]
        }).select('name').lean();

        if (existingIdentity) {
            throw new Error(`Key already exists with identity name: ${existingIdentity.name}`);
        }
    } catch (error) {
        if (error.message.includes('Key already exists')) {
            throw error;
        }
        logger.error('Database error during duplicate check', { error: error.message });
        throw new Error("Failed to check for duplicate keys.");
    }

    // Prepare key data for storage
    const keyData = {
        name: name.trim(),
        privkey: Buffer.from(privateKeyBytes).toString('hex'),
        pubkey: publicKeyHex,
        nsec: nsec,
        npub: npub,
        wa_gate_id: 'default'
    };

    try {
        const newIdentity = new NostrIdentity(keyData);
        await newIdentity.save();
        
        logger.info('Imported identity from nsec', {
            name: keyData.name,
            npub: keyData.npub,
            wa_gate_id: keyData.wa_gate_id
        });
        
        // Clear sensitive data from memory
        privateKeyBytes.fill(0);
        keyData.privkey = '[CLEARED]';
        keyData.nsec = '[CLEARED]';
        
        return newIdentity.toObject();
    } catch (error) {
        logger.error('Failed to save imported identity', { error: error.message });
        
        // Clear sensitive data from memory on error
        if (privateKeyBytes) {
            privateKeyBytes.fill(0);
        }
        
        if (error.code === 11000) {
            throw new Error("An identity with one of these unique keys already exists.");
        }
        throw new Error("Failed to save imported identity to database.");
    }
}
