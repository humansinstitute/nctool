import { nip04, nip19 } from 'nostr-tools';
import { NDKEvent } from '@nostr-dev-kit/ndk';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import { connect } from '../services/nostr.service.js';
import { getAllKeys, updateWalletInfo } from '../services/identity.service.js';
import { generateP2PKKeypair, checkWalletExists, getWalletDetails } from '../services/cashu.service.js';

const MINT_URL = process.env.MINT_URL || 'https://mint.minibits.cash/Bitcoin';

/**
 * Creates a new eCash wallet for a user by publishing:
 *  - kind 17375 (wallet metadata)
 *  - kind 10019 (NIP-61 payment info)
 */
export const create = asyncHandler(async (req, res) => {
    const { npub } = req.body;
    console.log('Creating eCash wallet for npub:', npub);
    if (!npub) {
        return res.status(400).json({ error: 'npub is required' });
    }

    // Look up user's key object
    const keys = await getAllKeys();
    const keyObj = keys.find(k => k.npub === npub);
    if (!keyObj) {
        return res.status(404).json({ error: 'User not found' });
    }

    const { nsec } = keyObj;
    const { ndk } = await connect(keyObj);

    // Check if wallet already exists
    const exists = await checkWalletExists(npub, ndk);
    if (exists) {
        const details = await getWalletDetails(npub, nsec, ndk);
        return res.json({
            message: 'Wallet already exists',
            walletDetails: {
                mint: details.mint,
                p2pkPub: details.p2pkPub
            }
        });
    }

    // Generate new P2PK keypair
    const { privkey: p2pkPriv, pubkey: p2pkPub } = generateP2PKKeypair();

    // Decode Nostr keys for encryption
    const { data: privHex } = nip19.decode(nsec);
    const { data: pubHex } = nip19.decode(npub);

    // Build and encrypt wallet metadata event (kind 17375)
    const walletContent = JSON.stringify({ mint: MINT_URL, p2pkPriv });
    const encryptedContent = await nip04.encrypt(privHex, pubHex, walletContent);
    const walletEvent = new NDKEvent(ndk, {
        kind: 17375,
        content: encryptedContent,
        tags: [['mint', MINT_URL]]
    });
    await walletEvent.sign();
    const walletRelays = await walletEvent.publish();

    // Build Nutzap info event (kind 10019)
    const infoEvent = new NDKEvent(ndk, {
        kind: 10019,
        content: '',
        tags: [
            ['relay', process.env.RELAYS?.split(',')[0] || 'wss://relay.damus.io'],
            ['mint', MINT_URL],
            ['pubkey', '02' + p2pkPub]
        ]
    });
    await infoEvent.sign();
    const infoRelays = await infoEvent.publish();

    // Store wallet info in keys.json
    keyObj.wallet = { mint: MINT_URL, p2pkPub };
    await updateWalletInfo(npub, { mint: MINT_URL, p2pkPub });

    // Return success with details and event IDs
    res.json({
        message: 'Wallet created successfully',
        walletDetails: {
            mint: MINT_URL,
            p2pkPub
        },
        events: {
            wallet: {
                id: walletEvent.id,
                relays: [...walletRelays].map(r => r.url)
            },
            info: {
                id: infoEvent.id,
                relays: [...infoRelays].map(r => r.url)
            }
        }
    });
});
