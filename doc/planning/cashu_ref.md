Cashu Wallet Implementation Tutorial for Node.js
Overview
Cashu is an ecash protocol that allows for anonymous, instant payments. This tutorial will guide you through implementing a basic Cashu wallet using the cashu-ts library in a Node.js application.

Prerequisites
Node.js (v16 or higher)
Basic understanding of JavaScript/TypeScript
A running Cashu mint (or access to a public one)
Installation
First, install the required dependencies:

bash
npm install @cashu/cashu-ts

# For TypeScript support (optional)

npm install -D typescript @types/node
Basic Wallet Setup

1. Initialize the Wallet
   javascript
   import { CashuMint, CashuWallet } from '@cashu/cashu-ts';

// Connect to a mint (replace with your mint URL)
const mintUrl = 'https://mint.example.com';
const mint = new CashuMint(mintUrl);

// Create wallet instance
const wallet = new CashuWallet(mint, {
unit: 'sat' // Bitcoin satoshis
}); 2. Check Mint Information
javascript
async function getMintInfo() {
try {
// Get mint information
const info = await mint.getInfo();
console.log('Mint info:', info);

    // Get available keysets
    const keysets = await mint.getKeySets();
    console.log('Available keysets:', keysets);

    // Get keys for current keyset
    const keys = await wallet.getKeys();
    console.log('Current keys:', keys);

} catch (error) {
console.error('Error getting mint info:', error);
}
}
Core Wallet Operations 3. Minting Tokens (Receiving)
To receive ecash, you need to create a mint quote and pay the Lightning invoice:

javascript
async function mintTokens(amount) {
try {
// Create a mint quote
const mintQuote = await wallet.createMintQuote(amount);
console.log('Pay this Lightning invoice:', mintQuote.request);
console.log('Quote ID:', mintQuote.quote);

    // After paying the invoice, check if it's paid
    const quoteStatus = await wallet.checkMintQuote(mintQuote.quote);
    if (quoteStatus.state === 'PAID') {
      // Mint the tokens
      const proofs = await wallet.mintProofs(amount, mintQuote.quote);
      console.log('Minted proofs:', proofs);
      return proofs;
    } else {
      console.log('Invoice not paid yet');
      return null;
    }

} catch (error) {
console.error('Error minting tokens:', error);
}
} 4. Sending Tokens
To send tokens to someone else:

javascript
async function sendTokens(amount, proofs) {
try {
// Create a send transaction
const sendResponse = await wallet.send(amount, proofs);
console.log('Tokens to send:', sendResponse.send);
console.log('Change tokens (keep):', sendResponse.keep);

    // Encode tokens for sharing
    const encodedToken = getEncodedToken({
      mint: mintUrl,
      proofs: sendResponse.send
    });
    console.log('Encoded token:', encodedToken);

    return {
      encodedToken,
      change: sendResponse.keep
    };

} catch (error) {
console.error('Error sending tokens:', error);
}
} 5. Receiving Tokens
To receive tokens from someone else:

javascript
async function receiveTokens(encodedToken) {
try {
// Receive and verify the token
const receivedProofs = await wallet.receive(encodedToken);
console.log('Received proofs:', receivedProofs);

    // Calculate total amount received
    const totalAmount = receivedProofs.reduce((sum, proof) => sum + proof.amount, 0);
    console.log('Total amount received:', totalAmount);

    return receivedProofs;

} catch (error) {
console.error('Error receiving tokens:', error);
}
} 6. Melting Tokens (Spending via Lightning)
To spend tokens by paying a Lightning invoice:

javascript
async function meltTokens(invoice, proofs) {
try {
// Create a melt quote
const meltQuote = await wallet.createMeltQuote(invoice);
console.log('Melt quote:', meltQuote);
console.log('Fee reserve:', meltQuote.fee_reserve);

    // Calculate total amount needed (invoice amount + fees)
    const totalNeeded = meltQuote.amount + meltQuote.fee_reserve;

    // Send the required amount
    const { send } = await wallet.send(totalNeeded, proofs, {
      includeFees: true
    });

    // Execute the melt
    const meltResponse = await wallet.meltProofs(meltQuote, send);
    console.log('Payment result:', meltResponse);

    // Return any change
    return meltResponse.change;

} catch (error) {
console.error('Error melting tokens:', error);
}
}
Advanced Features 7. P2PK (Pay-to-Public-Key) Transactions
For more secure transactions, you can lock tokens to a specific public key:

javascript
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';

async function sendP2PKTokens(amount, proofs, recipientPubkey) {
try {
const { send } = await wallet.send(amount, proofs, {
pubkey: recipientPubkey
});

    return getEncodedToken({
      mint: mintUrl,
      proofs: send
    });

} catch (error) {
console.error('Error sending P2PK tokens:', error);
}
}

async function receiveP2PKTokens(encodedToken, privateKey) {
try {
const receivedProofs = await wallet.receive(encodedToken, {
privkey: privateKey
});
return receivedProofs;
} catch (error) {
console.error('Error receiving P2PK tokens:', error);
}
} 8. Checking Proof States
javascript
async function checkProofStates(proofs) {
try {
const states = await wallet.checkProofsStates(proofs);
states.forEach((state, index) => {
console.log(`Proof ${index}: ${state.state}`);
// States: UNSPENT, SPENT, or PENDING
});
return states;
} catch (error) {
console.error('Error checking proof states:', error);
}
} 9. Wallet Utilities
javascript
import { sumProofs, splitAmount } from '@cashu/cashu-ts';

// Calculate total balance
function getWalletBalance(allProofs) {
return sumProofs(allProofs);
}

// Split amount into denominations
function splitIntoAmounts(amount) {
return splitAmount(amount);
}

// Get fees for a set of proofs
function calculateFees(proofs) {
return wallet.getFeesForProofs(proofs);
}
Complete Example Application
Here's a simple CLI wallet example:

javascript
import { CashuMint, CashuWallet, getEncodedToken } from '@cashu/cashu-ts';
import readline from 'readline';

class SimpleCashuWallet {
constructor(mintUrl) {
this.mint = new CashuMint(mintUrl);
this.wallet = new CashuWallet(this.mint, { unit: 'sat' });
this.proofs = [];
}

async getBalance() {
return this.proofs.reduce((sum, proof) => sum + proof.amount, 0);
}

async mint(amount) {
const quote = await this.wallet.createMintQuote(amount);
console.log(`Pay this invoice: ${quote.request}`);

    // Wait for payment (in real app, you'd poll or use webhooks)
    console.log('Waiting for payment...');

    const newProofs = await this.wallet.mintProofs(amount, quote.quote);
    this.proofs.push(...newProofs);
    console.log(`Minted ${amount} sats`);

}

async send(amount) {
if (await this.getBalance() < amount) {
throw new Error('Insufficient balance');
}

    const { send, keep } = await this.wallet.send(amount, this.proofs);
    this.proofs = keep;

    return getEncodedToken({
      mint: this.mint.mintUrl,
      proofs: send
    });

}

async receive(encodedToken) {
const receivedProofs = await this.wallet.receive(encodedToken);
this.proofs.push(...receivedProofs);
console.log(`Received ${receivedProofs.reduce((s, p) => s + p.amount, 0)} sats`);
}
}

// Usage
const wallet = new SimpleCashuWallet('https://your-mint-url.com');
WebSocket Support
For real-time updates on mint quotes and proof states:

javascript
// Listen for mint quote updates
async function watchMintQuote(quoteId) {
const unsub = await wallet.onMintQuoteUpdates(
[quoteId],
(update) => {
console.log('Quote updated:', update);
if (update.state === 'PAID') {
console.log('Payment received!');
unsub(); // Unsubscribe
}
},
(error) => {
console.error('WebSocket error:', error);
}
);
}
Best Practices
Store proofs securely: In production, encrypt and store proofs in a secure database
Handle errors gracefully: Network issues and mint downtime are common
Validate inputs: Always validate amounts and token formats
Use appropriate denominations: The library handles this automatically, but be aware of the concept
Monitor proof states: Check if proofs are still unspent before using them
Backup strategies: Implement proper backup and recovery mechanisms
Production Considerations
Use environment variables for mint URLs and sensitive data
Implement proper logging and monitoring
Add rate limiting and retry logic
Consider using a proper database for proof storage
Implement proper error handling and user feedback
Use HTTPS and validate SSL certificates
This tutorial covers the basics of implementing a Cashu wallet. For more advanced features and detailed documentation, refer to the official Cashu documentation and the cashu-ts library.
