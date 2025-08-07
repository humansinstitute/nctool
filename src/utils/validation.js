import { nip19 } from 'nostr-tools';
import { logger } from './logger.js';

/**
 * Validates a Nostr nsec (private key) format and structure
 * @param {string} nsec - The nsec string to validate
 * @returns {boolean} - True if valid, false otherwise
 * @throws {Error} - Throws descriptive error for invalid nsec
 */
export function validateNsec(nsec) {
    if (!nsec || typeof nsec !== 'string') {
        throw new Error('nsec must be a non-empty string');
    }

    // Check if nsec starts with "nsec1"
    if (!nsec.startsWith('nsec1')) {
        throw new Error('nsec must start with "nsec1"');
    }

    try {
        // Attempt to decode the nsec using nip19
        const decoded = nip19.decode(nsec);
        
        // Verify it's a private key type
        if (decoded.type !== 'nsec') {
            throw new Error('Invalid nsec format: not a private key type');
        }

        // Verify the data is a valid 32-byte private key
        if (!decoded.data || decoded.data.length !== 32) {
            throw new Error('Invalid nsec format: private key must be 32 bytes');
        }

        return true;
    } catch (error) {
        if (error.message.includes('nsec must start with') || 
            error.message.includes('Invalid nsec format')) {
            throw error;
        }
        // Re-throw with more descriptive message for bech32 decode errors
        throw new Error(`Invalid nsec format: ${error.message}`);
    }
}

/**
 * Extracts the raw private key bytes from a valid nsec
 * @param {string} nsec - The nsec string to decode
 * @returns {Uint8Array} - The raw private key bytes
 * @throws {Error} - Throws error if nsec is invalid
 */
export function decodeNsec(nsec) {
    validateNsec(nsec);
    
    try {
        const decoded = nip19.decode(nsec);
        return decoded.data;
    } catch (error) {
        throw new Error(`Failed to decode nsec: ${error.message}`);
    }
}