#!/usr/bin/env node
import "dotenv/config";
import axios from "axios";
import readline from "readline";
import { EventSource } from "eventsource";
import { connect } from "./src/services/nostr.service.js";
import {
  getAllKeys,
  generateKeyPair,
  getPrivateKeyByNpub,
} from "./src/services/identity.service.js";
import { nip19, finalizeEvent } from "nostr-tools";
import connectDB from "./src/config/db.js";
import { buildTextNote } from "./src/services/nostr.service.js";
import { mineEventPow } from "./src/services/pow.service.js";
import { v4 as uuidv4 } from "uuid";
import logUpdate from "log-update";

const API_BASE = process.env.API_URL || "http://localhost:3000";
const IGNORE_OLD_MS = Number(process.env.IGNORE_OLD) || Infinity;

// Buffer and renderer for streaming messages
let logBuffer = [];
function output(line) {
  logBuffer.push(line);
  logUpdate(logBuffer.join("\n"));
}

function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans.trim());
    })
  );
}

async function chooseKey() {
  const keys = await getAllKeys();
  if (keys.length) {
    console.log("\nSelect a user:");
    keys.forEach((k, i) => console.log(`${i + 1}) ${k.name}`));
    console.log("n) Create new user");
    const choice = await prompt("Enter number or n: ");
    if (choice.toLowerCase() === "n") {
      const name = await prompt("Enter a name for the new user: ");
      return generateKeyPair(name, "61487097701@c.us");
    }
    const idx = parseInt(choice, 10) - 1;
    if (idx >= 0 && idx < keys.length) return keys[idx];
    console.log("Invalid selection, try again.");
    return chooseKey();
  }
  console.log("\nNo users found. Creating a new user.");
  const name = await prompt("Enter a name for the new user: ");
  return generateKeyPair(name, "61487097701@c.us");
}

async function tailEvents(sessionKey) {
  const targetNpub = sessionKey.npub;
  logBuffer = [];
  let sessionId;
  try {
    const resp = await axios.post(`${API_BASE}/stream/start`, {
      npubs: [targetNpub],
    });
    sessionId = resp.data.sessionId;
  } catch (err) {
    output(`Stream start error: ${err.message}`);
    return;
  }
  output(`🕑 Subscribed for ${targetNpub} – press Ctrl+C to stop`);
  const es = new EventSource(`${API_BASE}/stream/events/${sessionId}`);
  es.onmessage = async (ev) => {
    let line;
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === "decryptedAction") {
        const {
          payload: out,
          senderNpub,
          responseNpub,
          timestamp,
          threadID,
        } = msg.data;
        const age = Date.now() - timestamp * 1000;
        if (!timestamp || age > IGNORE_OLD_MS) {
          line = `Ignored old or malformed message from ${senderNpub}`;
        } else {
          const inner = out.payload;
          if (inner.action === "sign") {
            try {
              const nsec = await getPrivateKeyByNpub(inner.signerNPub);
              const { data: privKeyHex } = nip19.decode(nsec);
              const unsignedEvent = JSON.parse(inner.event);
              const signedEvent = finalizeEvent(unsignedEvent, privKeyHex);
              const newCallID = uuidv4();
              const timestamp2 = Math.floor(Date.now() / 1000);
              const nostrMqResponse = {
                callID: newCallID,
                threadID: threadID,
                timestamp: timestamp2,
                payload: {
                  action: "signed",
                  signerNPub: inner.signerNPub,
                  signedEvent: JSON.stringify(signedEvent),
                },
              };
              await axios.post(`${API_BASE}/action/encrypted`, {
                senderNpub: inner.signerNPub,
                callNpub: responseNpub,
                responseNpub: inner.signerNPub,
                payload: nostrMqResponse,
                powBits: Number(process.env.POW_BITS) || 20,
                timeoutMs: Number(process.env.TIMEOUT_MS) || 10000,
              });
              line = `✅ Signed event sent back to ${responseNpub}`;
            } catch (signErr) {
              line = `❌ Error signing event: ${signErr.message}`;
              console.error(
                "Error details:",
                signErr.response?.data || signErr
              );
            }
          } else if (inner.action === "signed") {
            try {
              const eventToBroadcast = JSON.parse(inner.signedEvent);
              await axios.post(`${API_BASE}/post/broadcast`, {
                event: eventToBroadcast,
              });
              line = `✅ Broadcasted signed event: ${eventToBroadcast.id}`;
            } catch (broadcastErr) {
              line = `❌ Error broadcasting signed event: ${broadcastErr.message}`;
              console.error(
                "Broadcast error details:",
                broadcastErr.response?.data || broadcastErr
              );
            }
          } else {
            line = `🆕 Payload from ${senderNpub}: ${JSON.stringify(inner)}`;
          }
        }
      } else {
        line = `🆕 Raw: ${JSON.stringify(msg)}`;
      }
    } catch {
      line = `🆕 Raw data: ${ev.data}`;
    }
    output(line);
  };
  es.onerror = (err) => output(`Stream error: ${err.message}`);
}

// ==================== CASHU WALLET FUNCTIONS ====================

async function checkPendingReceipts(sessionKey) {
  try {
    console.log("🔄 Checking for completed payments...");
    const { data } = await axios.get(
      `${API_BASE}/api/wallet/${sessionKey.npub}/receipts/check`
    );

    if (data.receipts && data.receipts.length > 0) {
      const totalAmount = data.receipts.reduce(
        (sum, receipt) => sum + receipt.amount,
        0
      );
      console.log(
        `✅ Found ${data.receipts.length} completed payment(s): +${totalAmount} sats minted!`
      );
      return true;
    }

    return false;
  } catch (err) {
    // Log error but don't disrupt menu flow
    console.error("Receipt check error:", err.message);
    return false;
  }
}

async function cashuWalletMenu(sessionKey) {
  while (true) {
    // Check for pending receipts before displaying menu
    await checkPendingReceipts(sessionKey);

    console.log(`\n=== Cashu Wallet Menu (${sessionKey.name}) ===`);
    console.log("1) Check wallet balance");
    console.log("2) Mint tokens (Lightning to eCash)");
    console.log("3) Send tokens");
    console.log("4) Receive tokens");
    console.log("5) Melt tokens (eCash to Lightning)");
    console.log("6) Check proof states");
    console.log("7) View transaction history");
    console.log("8) Get wallet info");
    console.log("9) Return to main menu");

    const choice = await prompt("Enter 1-9: ");

    try {
      switch (choice) {
        case "1":
          await checkWalletBalance(sessionKey);
          break;
        case "2":
          await mintTokens(sessionKey);
          break;
        case "3":
          await sendTokens(sessionKey);
          break;
        case "4":
          await receiveTokens(sessionKey);
          break;
        case "5":
          await meltTokens(sessionKey);
          break;
        case "6":
          await checkProofStates(sessionKey);
          break;
        case "7":
          await viewTransactionHistory(sessionKey);
          break;
        case "8":
          await getWalletInfo(sessionKey);
          break;
        case "9":
          return; // Return to main menu
        default:
          console.log("Invalid choice. Please enter 1-9.");
      }
    } catch (err) {
      const errorMsg =
        err.response && err.response.data
          ? err.response.data.message || JSON.stringify(err.response.data)
          : err.message || String(err);
      console.error("Error:", errorMsg);
    }
  }
}

async function checkWalletBalance(sessionKey) {
  console.log("\n--- Check Wallet Balance ---");
  try {
    const { data } = await axios.get(
      `${API_BASE}/api/wallet/${sessionKey.npub}/balance`
    );
    console.log("\n✅ Wallet Balance:");
    console.log(`Total Balance: ${data.balance} sats`);
    if (data.details) {
      console.log("\nBalance Details:");
      Object.entries(data.details).forEach(([mint, amount]) => {
        console.log(`  ${mint}: ${amount} sats`);
      });
    }
  } catch (err) {
    throw err;
  }
}

async function mintTokens(sessionKey) {
  console.log("\n--- Mint Tokens (Lightning to eCash) ---");
  console.log("Convert Lightning sats to eCash tokens");

  const amountStr = await prompt("Enter amount in sats (e.g., 1000): ");
  const amount = parseInt(amountStr, 10);

  if (isNaN(amount) || amount <= 0) {
    console.log("❌ Invalid amount. Please enter a positive number.");
    return;
  }

  console.log(`\nMinting ${amount} sats...`);
  try {
    const { data } = await axios.post(
      `${API_BASE}/api/wallet/${sessionKey.npub}/mint`,
      {
        amount,
      }
    );

    console.log("\n✅ Tokens minted successfully!");
    console.log(`Amount: ${data.amount} sats`);
    if (data.invoice) {
      console.log(`Lightning Invoice: ${data.invoice}`);
    }
    if (data.tokens) {
      console.log(`Tokens created: ${data.tokens.length} token(s)`);
    }
  } catch (err) {
    throw err;
  }
}

async function sendTokens(sessionKey) {
  console.log("\n--- Send Tokens ---");
  console.log("Send eCash tokens to another user");

  const amountStr = await prompt("Enter amount in sats (e.g., 500): ");
  const amount = parseInt(amountStr, 10);

  if (isNaN(amount) || amount <= 0) {
    console.log("❌ Invalid amount. Please enter a positive number.");
    return;
  }

  const recipientPubkey = await prompt(
    "Enter recipient public key (optional, press Enter to skip): "
  );

  console.log(`\nSending ${amount} sats...`);
  try {
    const requestBody = { amount };
    if (recipientPubkey.trim()) {
      requestBody.recipientPubkey = recipientPubkey.trim();
    }

    const { data } = await axios.post(
      `${API_BASE}/api/wallet/${sessionKey.npub}/send`,
      requestBody
    );

    console.log("\n✅ Tokens sent successfully!");
    console.log(`Amount: ${data.amount} sats`);
    console.log(`Encoded Token: ${data.encodedToken}`);
    console.log("\n📋 Share this encoded token with the recipient:");
    console.log(`${data.encodedToken}`);
  } catch (err) {
    throw err;
  }
}

async function receiveTokens(sessionKey) {
  console.log("\n--- Receive Tokens ---");
  console.log("Receive eCash tokens from an encoded token");

  const encodedToken = await prompt("Enter encoded token (cashuAey...): ");

  if (!encodedToken.trim()) {
    console.log("❌ Encoded token is required.");
    return;
  }

  const privateKey = await prompt(
    "Enter private key for P2PK tokens (optional, press Enter to skip): "
  );

  console.log("\nReceiving tokens...");
  try {
    const requestBody = { encodedToken: encodedToken.trim() };
    if (privateKey.trim()) {
      requestBody.privateKey = privateKey.trim();
    }

    const { data } = await axios.post(
      `${API_BASE}/api/wallet/${sessionKey.npub}/receive`,
      requestBody
    );

    console.log("\n✅ Tokens received successfully!");
    console.log(`Amount: ${data.totalAmount || 0} sats`);
    if (data.proofs) {
      console.log(`Proofs received: ${data.proofs.length} proof(s)`);
    }
  } catch (err) {
    throw err;
  }
}

async function meltTokens(sessionKey) {
  console.log("\n--- Melt Tokens (eCash to Lightning) ---");
  console.log("Convert eCash tokens to Lightning payment");

  const invoice = await prompt("Enter Lightning invoice (lnbc...): ");

  if (!invoice.trim()) {
    console.log("❌ Lightning invoice is required.");
    return;
  }

  console.log("\nMelting tokens...");
  try {
    const { data } = await axios.post(
      `${API_BASE}/api/wallet/${sessionKey.npub}/melt`,
      {
        invoice: invoice.trim(),
      }
    );

    console.log("\n✅ Tokens melted successfully!");
    console.log(`Amount: ${data.amount} sats`);
    if (data.fee) {
      console.log(`Fee: ${data.fee} sats`);
    }
    if (data.preimage) {
      console.log(`Payment Preimage: ${data.preimage}`);
    }
  } catch (err) {
    throw err;
  }
}

async function checkProofStates(sessionKey) {
  console.log("\n--- Check Proof States ---");
  console.log("Check the status of proofs with the mint");

  const proofsInput = await prompt(
    "Enter proofs JSON array (optional, press Enter to check all): "
  );

  console.log("\nChecking proof states...");
  try {
    let url = `${API_BASE}/api/wallet/${sessionKey.npub}/proofs/status`;
    if (proofsInput.trim()) {
      try {
        const proofs = JSON.parse(proofsInput.trim());
        url += `?proofs=${encodeURIComponent(JSON.stringify(proofs))}`;
      } catch (parseErr) {
        console.log(
          "❌ Invalid JSON format for proofs. Checking all proofs instead."
        );
      }
    }

    const { data } = await axios.get(url);

    console.log("\n✅ Proof states retrieved:");
    if (data.states && Array.isArray(data.states)) {
      data.states.forEach((state, index) => {
        console.log(`  Proof ${index + 1}: ${state.state || "unknown"}`);
      });
    } else {
      console.log(JSON.stringify(data, null, 2));
    }
  } catch (err) {
    throw err;
  }
}

async function viewTransactionHistory(sessionKey) {
  console.log("\n--- View Transaction History ---");

  const limitStr = await prompt(
    "Enter number of transactions to show (1-100, default 10): "
  );
  const limit = limitStr.trim()
    ? Math.min(Math.max(parseInt(limitStr, 10), 1), 100)
    : 10;

  const skipStr = await prompt(
    "Enter number of transactions to skip (default 0): "
  );
  const skip = skipStr.trim() ? Math.max(parseInt(skipStr, 10), 0) : 0;

  const transactionType = await prompt(
    "Filter by transaction type (mint/melt/send/receive, optional): "
  );
  const mintUrl = await prompt("Filter by mint URL (optional): ");

  console.log("\nRetrieving transaction history...");
  try {
    let url = `${API_BASE}/api/wallet/${sessionKey.npub}/transactions?limit=${limit}&skip=${skip}`;
    if (transactionType.trim()) {
      url += `&transaction_type=${encodeURIComponent(transactionType.trim())}`;
    }
    if (mintUrl.trim()) {
      url += `&mint_url=${encodeURIComponent(mintUrl.trim())}`;
    }

    const { data } = await axios.get(url);

    console.log(
      `\n✅ Transaction History (${
        data.transactions?.length || 0
      } transactions):`
    );
    if (data.transactions && data.transactions.length > 0) {
      data.transactions.forEach((tx, index) => {
        try {
          // Safely extract values with fallbacks - map database fields to display
          const amount =
            typeof tx.total_amount === "number" ? tx.total_amount : 0;
          const dateValue = tx.created_at || tx.createdAt;
          const date = dateValue ? new Date(dateValue) : null;
          const transactionType =
            tx.transaction_type?.toUpperCase() || "UNKNOWN";

          console.log(`\n${index + 1}. ${transactionType}`);
          console.log(`   Amount: ${amount} sats`);

          if (date && !isNaN(date.getTime())) {
            console.log(`   Date: ${date.toLocaleString()}`);
          } else {
            console.log(`   Date: Unknown`);
          }

          console.log(`   Mint: ${tx.mint_url || "N/A"}`);
          console.log(`   Status: ${tx.status || "unknown"}`);

          // Optional additional details for better debugging
          if (tx.transaction_id) {
            console.log(
              `   Transaction ID: ${tx.transaction_id.substring(0, 16)}...`
            );
          }
        } catch (error) {
          console.log(
            `\n${index + 1}. ERROR displaying transaction: ${error.message}`
          );
          console.log(`   Raw data: ${JSON.stringify(tx, null, 2)}`);
        }
      });
    } else {
      console.log("No transactions found.");
    }
  } catch (err) {
    throw err;
  }
}

async function getWalletInfo(sessionKey) {
  console.log("\n--- Get Wallet Info ---");

  console.log("Retrieving wallet information...");
  try {
    const { data } = await axios.get(
      `${API_BASE}/api/wallet/${sessionKey.npub}/info`
    );

    console.log("\n✅ Wallet Information:");
    console.log(`NPub: ${data.walletInfo?.npub || sessionKey.npub}`);
    console.log(`Mint URL: ${data.walletInfo?.mintUrl || "N/A"}`);
    console.log(
      `Public Key (P2PK): ${data.walletInfo?.walletDetails?.p2pkPub || "N/A"}`
    );
    console.log(`Total Balance: ${data.walletInfo?.balance || 0} sats`);

    if (data.walletInfo?.statistics?.total_transactions !== undefined) {
      console.log(
        `Total Transactions: ${data.walletInfo.statistics.total_transactions}`
      );
    }

    if (data.walletInfo?.statistics?.wallet_count !== undefined) {
      console.log(`Wallet Count: ${data.walletInfo.statistics.wallet_count}`);
    }

    if (data.walletInfo?.createdAt) {
      console.log(
        `Created At: ${new Date(data.walletInfo.createdAt).toLocaleString()}`
      );
    }
  } catch (err) {
    throw err;
  }
}

async function main() {
  await connectDB();

  // Attempt to start NostrMQ Remote API (graceful degradation on failure)
  let nostrMq;
  try {
    nostrMq = new NostrMQService();
    await nostrMq.initialize();
    await nostrMq.start();
    console.log("✅ NostrMQ remote API enabled");
  } catch (err) {
    console.warn(
      "⚠️  NostrMQ failed to start, continuing without remote API:",
      err.message || err
    );
  }

  const sessionKey = await chooseKey();
  tailEvents(sessionKey);

  while (true) {
    console.log(`\nHello ${sessionKey.name}, choose:`);
    console.log("a) Update profile");
    console.log("b) Create post");
    console.log("c) View last 10 posts");
    console.log("d) Publish action");
    console.log("f) Sign remotely");
    console.log("g) Create eCash wallet");
    console.log("h) Cashu Wallet Menu");
    console.log("e) Exit");
    const choice = await prompt("Enter a, b, c, d, f, g, h or e: ");

    try {
      if (choice === "a") {
        const name = await prompt("Name: ");
        const about = await prompt("About: ");
        const picture = await prompt("Picture (url): ");
        const resp = await axios.post(`${API_BASE}/profile/update`, {
          name,
          about,
          picture,
          npub: sessionKey.npub,
        });
        console.log("Profile updated:", resp.data);
      } else if (choice === "b") {
        const content = await prompt("Content: ");
        const { npub } = await connect(sessionKey);
        const resp = await axios.post(`${API_BASE}/post/note`, {
          npub,
          content,
        });
        console.log("Note created:", resp.data);
      } else if (choice === "c") {
        const resp = await axios.get(`${API_BASE}/post/view10`, {
          params: { npub: sessionKey.npub },
        });
        resp.data.forEach((p, i) => console.log(`${i + 1}. ${p.content}`));
      } else if (choice === "d") {
        // Encrypted action publishing via API
        const callNpub = await prompt("Call NPub (target): ");
        const responseNpubInput = await prompt(
          `Response NPub (default ${sessionKey.npub}): `
        );
        const responseNpub = responseNpubInput || sessionKey.npub;
        const input = await prompt(
          "Enter JSON payload or leave blank for default: "
        );
        const defaultPayload = {
          cmd: "pay",
          target: callNpub,
          amount: "21000",
        };
        let payload;
        if (!input) {
          payload = defaultPayload;
        } else {
          try {
            payload = JSON.parse(input);
          } catch {
            console.error("Invalid JSON. Aborting.");
            continue;
          }
        }
        const powBits = Number(process.env.POW_BITS) || 20;
        const timeoutMs = Number(process.env.TIMEOUT_MS) || 10000;
        const actionResp = await axios.post(`${API_BASE}/action/encrypted`, {
          senderNpub: sessionKey.npub,
          callNpub,
          responseNpub,
          payload,
          powBits,
          timeoutMs,
        });
        console.log("Encrypted action published:", actionResp.data);
      } else if (choice === "f") {
        // Remote sign request via API
        const callNpubInput = await prompt(
          "Call NPub (target, default npub1nsyfmmrjlak0hm3trww7qhk4zpvgqunsc4vpg0csczxykgaak5fq5hn58z): "
        );
        const callNpub =
          callNpubInput ||
          "npub17nqywpr8hvssklds0hd7uml8ydkw5vy2fj4dt6x93snh5tt9wl0sy56jrh";
        const responseNpubInput = await prompt(
          `Response NPub (default ${sessionKey.npub}): `
        );
        const responseNpub = responseNpubInput || sessionKey.npub;
        const signerNpubInput = await prompt(
          `Signer NPub (default ${sessionKey.npub}): `
        );
        const signerNpub = signerNpubInput || sessionKey.npub;
        const noteContent = await prompt("Enter note content: ");
        console.log("I AM HERE 1");
        try {
          const remoteResp = await axios.post(`${API_BASE}/post/note_remote`, {
            senderNpub: sessionKey.npub,
            callNpub,
            responseNpub,
            signerNpub,
            noteContent,
          });
          console.log("Remote sign request sent:", remoteResp.data);
        } catch (err) {
          console.error(
            "Error sending remote sign request:",
            err.response
              ? JSON.stringify(err.response.data, null, 2)
              : err.message || err
          );
        }
      } else if (choice === "g") {
        try {
          const { data } = await axios.post(`${API_BASE}/api/wallet/create`, {
            npub: sessionKey.npub,
          });
          if (data.message === "Wallet already exists") {
            console.log("\nWallet already exists:");
            console.log(`Mint: ${data.walletDetails.mint}`);
            console.log(
              `Public Key for receiving: ${data.walletDetails.p2pkPub}`
            );
          } else {
            console.log("\nWallet created successfully:");
            console.log(`Mint: ${data.walletDetails.mint}`);
            console.log(
              `Public Key for receiving: ${data.walletDetails.p2pkPub}`
            );
          }
        } catch (err) {
          const errorMsg =
            err.response && err.response.data
              ? err.response.data.message || JSON.stringify(err.response.data)
              : err.message || String(err);
          console.error("Error creating eCash wallet:", errorMsg);
        }
        continue;
      } else if (choice === "h") {
        await cashuWalletMenu(sessionKey);
      } else if (choice === "e") {
        console.log("Exiting.");
        process.exit(0);
      } else {
        console.log("Invalid choice.");
      }
    } catch (err) {
      console.error("Error:", err.message || err);
    }
  }
}

main();
