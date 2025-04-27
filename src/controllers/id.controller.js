import { generateKeyPair, getAllKeys } from '../services/identity.service.js';

export async function generateKey(req, res) {
    const keys = generateKeyPair();
    res.json(keys);
}

export async function getKeysController(req, res) {
    const keys = getAllKeys();
    if (!keys) {
        res.status(404).json({ error: 'NotFound', message: 'Keys not generated' });
    } else {
        res.json(keys);
    }
}
