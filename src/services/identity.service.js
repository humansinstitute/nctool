import fs from 'fs';
import os from 'os';
import path from 'path';
import { NDKPrivateKeySigner } from "@nostr-dev-kit/ndk";

const KEY_DIR = path.join(os.homedir(), ".nctool");
const KEY_FILE = path.join(KEY_DIR, "keys.json");

function ensureKeyFile() {
    if (!fs.existsSync(KEY_DIR)) {
        fs.mkdirSync(KEY_DIR, { recursive: true });
    }
    if (!fs.existsSync(KEY_FILE)) {
        fs.writeFileSync(KEY_FILE, JSON.stringify({ keys: [] }, null, 2));
    }
}

/**
 * Retrieves all named key entries from ~/.nctool/keys.json.
 * @returns {Array<{ name: string, privkey: string, pubkey: string, nsec: string, npub: string }>}
 */
export function getAllKeys() {
    ensureKeyFile();
    const raw = fs.readFileSync(KEY_FILE, "utf-8");
    let data = JSON.parse(raw);
    if (!Array.isArray(data.keys)) {
        const legacy = data;
        data = {
            keys: [
                {
                    name: legacy.npub || 'default',
                    privkey: legacy.privkey,
                    pubkey: legacy.pubkey,
                    nsec: legacy.nsec,
                    npub: legacy.npub
                }
            ]
        };
        fs.writeFileSync(KEY_FILE, JSON.stringify(data, null, 2));
    }
    return data.keys;
}

/**
 * Persists an array of key entries to ~/.nctool/keys.json.
 * @param {Array<{ name: string, privkey: string, pubkey: string, nsec: string, npub: string }>} keysArray
 */
export function saveAllKeys(keysArray) {
    ensureKeyFile();
    fs.writeFileSync(KEY_FILE, JSON.stringify({ keys: keysArray }, null, 2));
}

/**
 * Generates a new Nostr keypair, associates it with a name, and saves it.
 * @param {string} name
 * @returns {{ name: string, privkey: string, pubkey: string, nsec: string, npub: string }}
 */
export function generateKeyPair(name) {
    ensureKeyFile();
    const signer = NDKPrivateKeySigner.generate();
    const keyObj = {
        name,
        privkey: signer.privateKey,
        pubkey: signer.pubkey,
        nsec: signer.nsec,
        npub: signer.userSync.npub
    };
    const keys = getAllKeys();
    keys.push(keyObj);
    saveAllKeys(keys);
    return keyObj;
}
