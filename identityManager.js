import { NDKPrivateKeySigner } from "@nostr-dev-kit/ndk";
import fs from "fs";
import os from "os";
import path from "path";

const KEY_DIR = path.join(os.homedir(), ".nctool");
const KEY_FILE = path.join(KEY_DIR, "keys.json");

/**
 * Load or generate a Nostr keypair and persist it to ~/.nctool/keys.json.
 */
export function loadKeys() {
    // Ensure the directory exists
    if (!fs.existsSync(KEY_DIR)) {
        fs.mkdirSync(KEY_DIR, { recursive: true });
    }

    if (fs.existsSync(KEY_FILE)) {
        return JSON.parse(fs.readFileSync(KEY_FILE, "utf-8"));
    } else {
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
}
