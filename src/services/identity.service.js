import fs from 'fs';
import os from 'os';
import path from 'path';
import { NDKPrivateKeySigner } from "@nostr-dev-kit/ndk";

const KEY_DIR = path.join(os.homedir(), ".nctool");
const KEY_FILE = path.join(KEY_DIR, "keys.json");

/**
 * Generates a new Nostr keypair and persists to ~/.nctool/keys.json.
 * @returns {{ privkey: string, pubkey: string, nsec: string, npub: string }}
 */
export function generateKeyPair() {
    if (!fs.existsSync(KEY_DIR)) {
        fs.mkdirSync(KEY_DIR, { recursive: true });
    }
    const signer = NDKPrivateKeySigner.generate();
    const keys = {
        privkey: signer.privateKey,
        pubkey: signer.pubkey,
        nsec: signer.nsec,
        npub: signer.userSync.npub
    };
    fs.writeFileSync(KEY_FILE, JSON.stringify(keys, null, 2));
    return keys;
}

/**
 * Reads existing keys from ~/.nctool/keys.json.
 * @returns {{ privkey: string, pubkey: string, nsec: string, npub: string } | null}
 */
export function getKeys() {
    if (!fs.existsSync(KEY_FILE)) {
        return null;
    }
    return JSON.parse(fs.readFileSync(KEY_FILE, "utf-8"));
}
