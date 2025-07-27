import { jest } from '@jest/globals';
import walletRepositoryService from "../../src/services/walletRepository.service.js";
import * as cashuService from "../../src/services/cashu.service.js";
import CashuWallet from "../../src/models/CashuWallet.model.js";
import CashuToken from "../../src/models/CashuToken.model.js";
import { setupTestDB, teardownTestDB, clearTestDB } from "../setup.js";

/**
 * End-to-End Melt Operation Flow Tests
 * 
 * Comprehensive validation of the complete melt operation flow including:
 * - Full user journey: balance check → melt operation → balance verification
 * - Post-migration scenarios with corrected historical data
 * - Edge cases: zero amounts, large amounts, concurrent operations
 * - Transaction history accuracy after fixes
 */
describe("E2E Melt Operation Flow Tests", () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    jest.clearAllMocks();
  });

  const mockWalletData = {
    npub: "npub1qy88wumn8ghj7mn0wd68ytnhd9hx2tcpydkx2efwdahkcmn4wfkx2ps3h2n8h",
    mint_url: "https://mint.example.com",
    p2pk_pubkey: "02a1633cafcc01ebfb6d78e39f687a1f0995c62fc95f51ead10a02ee0be551b5dc",
    p2pk_privkey: "5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb",
    wallet_config: { unit: "sat", created_via: "api" },
  };

  const createMockProofs = (amounts) => {
    return amounts.map((amount, index) => ({
      id: `proof_${index}_${Date.now()}`,
      amount,
      secret: `secret_${index}_${Date.now()}_${Math.random()}`,
      C: `commitment_${index}_${Date.now()}`,
    }));
  };

  const createMockWallet = () => ({
    createMeltQuote: jest.fn(),
    send: jest.fn(),
    meltProofs: jest.fn(),
    checkProofsStates: jest.fn(),
    loadMint: jest.fn(),
  });

  describe("Complete Melt Operation Flow", () => {
    let wallet;
    let mockCashuWallet;

    beforeEach(async () => {
      wallet = await walletRepositoryService.createWallet(mockWalletData);
      mockCashuWallet = createMockWallet();
      
      // Mock the initializeWallet function
      jest.spyOn(cashuService, 'initializeWallet').mockResolvedValue({
        wallet: mockCashuWallet,
        walletDoc: wallet,
        mint: { getInfo: jest.fn() }
      });
    });

    it("should complete full melt flow: balance → melt → verification", async () => {
      // Step 1: Setup initial balance
      const initialProofs = createMockProofs([1000, 2000, 5000]);
      const initialTokens = [];

      for (const proof of initialProofs) {
        const token = await walletRepositoryService.storeTokens({
          npub: mockWalletData.npub,
          wallet_id: wallet._id,
          proofs: [proof],
          mint_url: mockWalletData.mint_url,
          transaction_type: "minted",
          transaction_id: `tx_initial_${proof.id}`,
          metadata: { source: "mint", quote_id: `quote_${proof.id}` },
        });
        initialTokens.push(token);
