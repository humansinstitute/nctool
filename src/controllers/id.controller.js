import {
    generateKeyPair,
    getAllKeys,
    getIdentityByWaGateId
} from '../services/identity.service.js';

/**
 * POST /id/generateKey
 * Body: { name: string, wa_gate_id: string }
 */
export async function generateKey(req, res) {
    const { name, wa_gate_id } = req.body;
    if (!name || !wa_gate_id) {
        return res.status(400).json({
            error: 'BadRequest',
            message: 'Both name and wa_gate_id are required'
        });
    }
    const newIdentity = await generateKeyPair(name, wa_gate_id);
    res.json(newIdentity);
}

/**
 * GET /id/getKeys
 */
export async function getKeysController(req, res) {
    const keys = await getAllKeys();
    if (!keys || keys.length === 0) {
        return res.status(404).json({
            error: 'NotFound',
            message: 'No identities found'
        });
    }
    res.json(keys);
}

/**
 * GET /id/gate/:wa_gate_id
 */
export async function getIdentityByGateId(req, res) {
    const { wa_gate_id } = req.params;
    if (!wa_gate_id) {
        return res.status(400).json({
            error: 'BadRequest',
            message: 'wa_gate_id parameter is required'
        });
    }
    const identity = await getIdentityByWaGateId(wa_gate_id);
    if (!identity) {
        return res.status(404).json({
            error: 'NotFound',
            message: `Identity not found for wa_gate_id ${wa_gate_id}`
        });
    }
    const publicIdentity = {
        pubkey: identity.pubkey,
        npub: identity.npub,
        name: identity.name,
        wa_gate_id: identity.wa_gate_id
    };
    res.json(publicIdentity);
}
