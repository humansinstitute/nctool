import walletRepositoryService from "../../src/services/walletRepository.service.js";
import CashuWallet from "../../src/models/CashuWallet.model.js";
import CashuToken from "../../src/models/CashuToken.model.js";
import { setupTestDB, teardownTestDB } from "../setup.js";

describe("Balance Calculation Validation Tests", () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await CashuWallet.deleteMany({});
    await CashuToken.deleteMany({});
  });

  const mockWalletData = {
    npub: "npub1qy88wumn8ghj7mn0wd68ytnhd9hx2tcpydkx2efwdahkcmn4wfkx2ps3h2n8h",
    mint_url: "https://mint.example.com",
    p2pk_pubkey:
      "02a1633cafcc01ebfb6d78e39f687a1f0995c62fc95f51ead10a02ee0be551b5dc",
    p2pk_privkey:
      "5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb",
    wallet_config: {
      unit: "sat",
      created_via: "api",
    },
  };

  const createMockProofs = (amounts) => {
    return amounts.map((amount, index) => ({
      id: `proof_${index}`,
      amount,
      secret: `secret_${index}_${Date.now()}_${Math.random()}`,
      C: `commitment_${index}`,
    }));
  };

  describe("Balance Calculation Accuracy", () => {
    let wallet;

    beforeEach(async () => {
      wallet = await walletRepositoryService.createWallet(mockWalletData);
    });

    it("should calculate correct balance with mixed token statuses", async () => {
      // Create tokens with different statuses and amounts
      const tokenData = [
        { amount: 1000, status: "unspent", type: "minted" },
        { amount: 2000, status: "unspent", type: "received" },
        { amount: 500, status: "spent", type: "sent" },
        { amount: 1500, status: "pending", type: "minted" },
        { amount: 750, status: "spent", type: "melted" },
      ];

      for (let i = 0; i < tokenData.length; i++) {
        const data = tokenData[i];
        await walletRepositoryService.storeTokens(
          {
            npub: mockWalletData.npub,
            wallet_id: wallet._id,
            proofs: createMockProofs([data.amount]),
            mint_url: mockWalletData.mint_url,
            transaction_type: data.type,
            transaction_id: `tx_balance_${i}`,
            metadata: {
              source: "test",
              quote_id: `quote_${i}`,
            },
          },
          { explicitStatus: data.status }
        );
      }

      const balance = await walletRepositoryService.calculateBalance(
        mockWalletData.npub
      );

      // Expected calculations:
      // unspent: 1000 + 2000 = 3000
      // pending: 1500
      // spent: 500 + 750 = 1250
      // total: unspent + pending = 3000 + 1500 = 4500

      expect(balance.unspent_balance).toBe(3000);
      expect(balance.pending_balance).toBe(1500);
      expect(balance.spent_balance).toBe(1250);
      expect(balance.total_balance).toBe(4500);
    });

    it("should handle empty wallet correctly", async () => {
      const balance = await walletRepositoryService.calculateBalance(
        mockWalletData.npub
      );

      expect(balance.unspent_balance).toBe(0);
      expect(balance.pending_balance).toBe(0);
      expect(balance.spent_balance).toBe(0);
      expect(balance.total_balance).toBe(0);
    });

    it("should filter by mint URL correctly", async () => {
      const mint1 = "https://mint1.example.com";
      const mint2 = "https://mint2.example.com";

      // Create tokens for different mints
      await walletRepositoryService.storeTokens({
        npub: mockWalletData.npub,
        wallet_id: wallet._id,
        proofs: createMockProofs([1000]),
        mint_url: mint1,
        transaction_type: "minted",
        transaction_id: "tx_mint1",
        metadata: {
          source: "mint",
          quote_id: "quote_mint1",
        },
      });

      await walletRepositoryService.storeTokens({
        npub: mockWalletData.npub,
        wallet_id: wallet._id,
        proofs: createMockProofs([2000]),
        mint_url: mint2,
        transaction_type: "minted",
        transaction_id: "tx_mint2",
        metadata: {
          source: "mint",
          quote_id: "quote_mint2",
        },
      });

      // Test balance for specific mint
      const mint1Balance = await walletRepositoryService.calculateBalance(
        mockWalletData.npub,
        mint1
      );

      const mint2Balance = await walletRepositoryService.calculateBalance(
        mockWalletData.npub,
        mint2
      );

      const totalBalance = await walletRepositoryService.calculateBalance(
        mockWalletData.npub
      );

      expect(mint1Balance.total_balance).toBe(1000);
      expect(mint2Balance.total_balance).toBe(2000);
      expect(totalBalance.total_balance).toBe(3000);
    });

    it("should handle negative balance scenarios gracefully", async () => {
      // This shouldn't happen in normal operation, but test defensive programming
      const balance = await walletRepositoryService.calculateBalance(
        "npub1nonexistent"
      );

      expect(balance.total_balance).toBe(0);
      expect(balance.unspent_balance).toBe(0);
      expect(balance.pending_balance).toBe(0);
      expect(balance.spent_balance).toBe(0);
    });

    it("should exclude pending transactions with empty proofs from balance", async () => {
      // Create a pending transaction with empty proofs (common during minting)
      const pendingToken = new CashuToken({
        npub: mockWalletData.npub,
        wallet_id: wallet._id,
        proofs: [], // Empty proofs
        mint_url: mockWalletData.mint_url,
        transaction_type: "minted",
        transaction_id: "tx_empty_pending",
        status: "pending",
        total_amount: 0,
        metadata: {
          source: "mint",
          quote_id: "quote_empty",
          pending_amount: 1000, // Expected amount
        },
      });
      await pendingToken.save();

      // Create a normal unspent token
      await walletRepositoryService.storeTokens({
        npub: mockWalletData.npub,
        wallet_id: wallet._id,
        proofs: createMockProofs([2000]),
        mint_url: mockWalletData.mint_url,
        transaction_type: "minted",
        transaction_id: "tx_normal",
        metadata: {
          source: "mint",
          quote_id: "quote_normal",
        },
      });

      const balance = await walletRepositoryService.calculateBalance(
        mockWalletData.npub
      );

      // Should only include the normal token, not the empty pending one
      expect(balance.total_balance).toBe(2000);
      expect(balance.unspent_balance).toBe(2000);
      expect(balance.pending_balance).toBe(0); // Empty pending excluded
    });
  });

  describe("Balance Consistency Validation", () => {
    let wallet;

    beforeEach(async () => {
      wallet = await walletRepositoryService.createWallet(mockWalletData);
    });

    it("should detect balance inconsistencies from melted tokens with unspent status", async () => {
      // Create normal unspent tokens
      await walletRepositoryService.storeTokens({
        npub: mockWalletData.npub,
        wallet_id: wallet._id,
        proofs: createMockProofs([1000]),
        mint_url: mockWalletData.mint_url,
        transaction_type: "minted",
        transaction_id: "tx_normal",
        metadata: {
          source: "mint",
          quote_id: "quote_normal",
        },
      });

      // Create problematic melted token with unspent status (the bug)
      const problematicToken = new CashuToken({
        npub: mockWalletData.npub,
        wallet_id: wallet._id,
        proofs: createMockProofs([500]),
        mint_url: mockWalletData.mint_url,
        transaction_type: "melted",
        transaction_id: "tx_problematic",
        status: "unspent", // This is wrong!
        metadata: {
          source: "lightning",
          quote_id: "quote_problematic",
        },
      });
      await problematicToken.save();

      const validation =
        await walletRepositoryService.validateBalanceConsistency(
          mockWalletData.npub
        );

      expect(validation.isValid).toBe(false);
      expect(validation.issues.problematicMeltedTokens).toBe(1);

      // The balance would be incorrectly inflated due to the bug
      const balance = await walletRepositoryService.calculateBalance(
        mockWalletData.npub
      );
      expect(balance.total_balance).toBe(1500); // 1000 + 500 (incorrectly counted)
    });

    it("should validate correct balance after melt operation fix", async () => {
      // Simulate a complete melt operation using the fixed function
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
          metadata: {
            source: "mint",
            quote_id: `quote_${proof.id}`,
          },
        });
        initialTokens.push(token);
      }

      // Initial balance: 8000 sats
      const initialBalance = await walletRepositoryService.calculateBalance(
        mockWalletData.npub
      );
      expect(initialBalance.total_balance).toBe(8000);

      // Perform melt operation
      const meltData = {
        npub: mockWalletData.npub,
        walletId: wallet._id,
        tokenIds: initialTokens.map((t) => t._id),
        sendProofs: createMockProofs([7500]),
        keepProofs: createMockProofs([500]), // Change from selection
        meltChangeProofs: createMockProofs([25]), // Change from melt
        transactionId: "tx_melt_validation",
        meltQuote: {
          quote: "quote_melt_validation",
          amount: 7500,
          fee_reserve: 15,
        },
        mintUrl: mockWalletData.mint_url,
      };

      await walletRepositoryService.executeAtomicMelt(meltData);

      // Validate final balance
      const finalBalance = await walletRepositoryService.calculateBalance(
        mockWalletData.npub
      );

      // Expected: 500 (keep) + 25 (melt change) = 525 sats
      expect(finalBalance.total_balance).toBe(525);
      expect(finalBalance.unspent_balance).toBe(525);
      expect(finalBalance.spent_balance).toBe(8000); // Original tokens

      // Validate consistency
      const validation =
        await walletRepositoryService.validateBalanceConsistency(
          mockWalletData.npub
        );

      expect(validation.isValid).toBe(true);
      expect(validation.issues.problematicMeltedTokens).toBe(0);
    });

    it("should detect duplicate proof secrets affecting balance", async () => {
      const duplicateProof = createMockProofs([1000])[0];

      // Create two tokens with the same proof (should not happen in normal operation)
      const token1 = new CashuToken({
        npub: mockWalletData.npub,
        wallet_id: wallet._id,
        proofs: [duplicateProof],
        mint_url: mockWalletData.mint_url,
        transaction_type: "minted",
        transaction_id: "tx_duplicate_1",
        status: "unspent",
        metadata: {
          source: "mint",
          quote_id: "quote_1",
        },
      });

      const token2 = new CashuToken({
        npub: mockWalletData.npub,
        wallet_id: wallet._id,
        proofs: [duplicateProof], // Same proof!
        mint_url: mockWalletData.mint_url,
        transaction_type: "received",
        transaction_id: "tx_duplicate_2",
        status: "unspent",
        metadata: {
          source: "receive",
          quote_id: "quote_2",
        },
      });

      await token1.save();
      await token2.save();

      const validation =
        await walletRepositoryService.validateBalanceConsistency(
          mockWalletData.npub
        );

      expect(validation.isValid).toBe(false);
      expect(validation.issues.duplicateSecrets).toBe(1);

      // Balance would be incorrectly doubled
      const balance = await walletRepositoryService.calculateBalance(
        mockWalletData.npub
      );
      expect(balance.total_balance).toBe(2000); // 1000 + 1000 (double counted)
    });
  });

  describe("Detailed Balance Information", () => {
    let wallet;

    beforeEach(async () => {
      wallet = await walletRepositoryService.createWallet(mockWalletData);
    });

    it("should provide detailed balance with token counts", async () => {
      // Create various tokens
      const tokenConfigs = [
        { amount: 1000, status: "unspent", count: 3 },
        { amount: 500, status: "spent", count: 2 },
        { amount: 2000, status: "pending", count: 1 },
      ];

      for (const config of tokenConfigs) {
        for (let i = 0; i < config.count; i++) {
          await walletRepositoryService.storeTokens(
            {
              npub: mockWalletData.npub,
              wallet_id: wallet._id,
              proofs: createMockProofs([config.amount]),
              mint_url: mockWalletData.mint_url,
              transaction_type: "minted",
              transaction_id: `tx_${config.status}_${i}`,
              metadata: {
                source: "mint",
                quote_id: `quote_${config.status}_${i}`,
              },
            },
            { explicitStatus: config.status }
          );
        }
      }

      const detailedBalance = await walletRepositoryService.getDetailedBalance(
        mockWalletData.npub
      );

      expect(detailedBalance.unspent_balance).toBe(3000); // 3 * 1000
      expect(detailedBalance.spent_balance).toBe(1000); // 2 * 500
      expect(detailedBalance.pending_balance).toBe(2000); // 1 * 2000
      expect(detailedBalance.total_balance).toBe(5000); // 3000 + 2000

      expect(detailedBalance.token_counts.unspent).toBe(3);
      expect(detailedBalance.token_counts.spent).toBe(2);
      expect(detailedBalance.token_counts.pending).toBe(1);
      expect(detailedBalance.total_tokens).toBe(6);
    });

    it("should handle wallet with no tokens", async () => {
      const detailedBalance = await walletRepositoryService.getDetailedBalance(
        mockWalletData.npub
      );

      expect(detailedBalance.total_balance).toBe(0);
      expect(detailedBalance.token_counts.unspent).toBe(0);
      expect(detailedBalance.token_counts.spent).toBe(0);
      expect(detailedBalance.token_counts.pending).toBe(0);
      expect(detailedBalance.total_tokens).toBe(0);
    });
  });

  describe("Migration Detection", () => {
    let wallet;

    beforeEach(async () => {
      wallet = await walletRepositoryService.createWallet(mockWalletData);
    });

    it("should identify tokens needing migration due to accounting bug", async () => {
      // Create normal tokens
      await walletRepositoryService.storeTokens({
        npub: mockWalletData.npub,
        wallet_id: wallet._id,
        proofs: createMockProofs([1000]),
        mint_url: mockWalletData.mint_url,
        transaction_type: "minted",
        transaction_id: "tx_normal",
        metadata: {
          source: "mint",
          quote_id: "quote_normal",
        },
      });

      // Create problematic melted token (the bug)
      const problematicToken = new CashuToken({
        npub: mockWalletData.npub,
        wallet_id: wallet._id,
        proofs: createMockProofs([500]),
        mint_url: mockWalletData.mint_url,
        transaction_type: "melted",
        transaction_id: "tx_needs_migration",
        status: "unspent", // Wrong status
        metadata: {
          source: "lightning",
          quote_id: "quote_migration",
        },
      });
      await problematicToken.save();

      const migrationCheck =
        await walletRepositoryService.checkForUnmigratedTokens(
          mockWalletData.npub
        );

      expect(migrationCheck.migrationNeeded).toBe(true);
      expect(migrationCheck.suspiciousTokensCount).toBe(1);
      expect(migrationCheck.recommendations).toContain(
        "Fix 1 melted tokens with incorrect unspent status"
      );

      const suspiciousToken = migrationCheck.suspiciousTokens[0];
      expect(suspiciousToken.transaction_id).toBe("tx_needs_migration");
      expect(suspiciousToken.issue).toContain("melted_token_unspent_status");
    });

    it("should not flag properly structured tokens for migration", async () => {
      // Create tokens using the fixed storeTokens function
      await walletRepositoryService.storeTokens({
        npub: mockWalletData.npub,
        wallet_id: wallet._id,
        proofs: createMockProofs([1000]),
        mint_url: mockWalletData.mint_url,
        transaction_type: "minted",
        transaction_id: "tx_proper_minted",
        metadata: {
          source: "mint",
          quote_id: "quote_minted",
        },
      });

      await walletRepositoryService.storeTokens({
        npub: mockWalletData.npub,
        wallet_id: wallet._id,
        proofs: createMockProofs([500]),
        mint_url: mockWalletData.mint_url,
        transaction_type: "melted",
        transaction_id: "tx_proper_melted",
        metadata: {
          source: "lightning",
          quote_id: "quote_melted",
        },
      });

      const migrationCheck =
        await walletRepositoryService.checkForUnmigratedTokens(
          mockWalletData.npub
        );

      expect(migrationCheck.migrationNeeded).toBe(false);
      expect(migrationCheck.suspiciousTokensCount).toBe(0);
      expect(migrationCheck.recommendations).toHaveLength(0);
    });
  });
});
