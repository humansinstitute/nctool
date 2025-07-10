import ValidationService from "../../src/services/validation.service.js";
import { nip19 } from "nostr-tools";
import walletRepositoryService from "../../src/services/walletRepository.service.js";

// Mock dependencies
jest.mock("nostr-tools");
jest.mock("../../src/services/walletRepository.service.js");
jest.mock("../../src/services/identity.service.js", () => ({
  getAllKeys: jest.fn(),
}));

describe("ValidationService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("validateNpubFormat", () => {
    it("should return valid for correct npub format", () => {
      nip19.decode.mockReturnValue({ type: "npub", data: "validhex" });

      const result = ValidationService.validateNpubFormat("npub1validnpub");

      expect(result.isValid).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return invalid for incorrect npub format", () => {
      nip19.decode.mockImplementation(() => {
        throw new Error("Invalid format");
      });

      const result = ValidationService.validateNpubFormat("invalid_npub");

      expect(result.isValid).toBe(false);
      expect(result.error).toBe("Invalid npub format");
    });

    it("should return invalid for missing npub", () => {
      const result = ValidationService.validateNpubFormat(null);

      expect(result.isValid).toBe(false);
      expect(result.error).toBe("npub is required");
    });
  });

  describe("validateAmount", () => {
    it("should return valid for amount within limits", () => {
      const result = ValidationService.validateAmount(1000);

      expect(result.isValid).toBe(true);
      expect(result.error).toBeNull();
      expect(result.warnings).toEqual([]);
    });

    it("should return invalid for amount below minimum", () => {
      const result = ValidationService.validateAmount(0);

      expect(result.isValid).toBe(false);
      expect(result.error).toBe("Amount must be between 1 and 1000000 sats");
    });

    it("should return invalid for amount above maximum", () => {
      const result = ValidationService.validateAmount(1000001);

      expect(result.isValid).toBe(false);
      expect(result.error).toBe("Amount must be between 1 and 1000000 sats");
    });

    it("should return warning for large amount", () => {
      const result = ValidationService.validateAmount(500000);

      expect(result.isValid).toBe(true);
      expect(result.error).toBeNull();
      expect(result.warnings).toContain(
        "Large amount detected (>100k sats). Please verify this is intentional."
      );
    });

    it("should return invalid for non-number amount", () => {
      const result = ValidationService.validateAmount("not_a_number");

      expect(result.isValid).toBe(false);
      expect(result.error).toBe("Amount must be a positive number");
    });

    it("should return invalid for missing amount", () => {
      const result = ValidationService.validateAmount(null);

      expect(result.isValid).toBe(false);
      expect(result.error).toBe("Amount is required");
    });
  });

  describe("validateMintingRequest", () => {
    beforeEach(() => {
      nip19.decode.mockReturnValue({ type: "npub", data: "validhex" });
      walletRepositoryService.findWallet.mockResolvedValue({
        _id: "wallet123",
      });
      walletRepositoryService.countPendingTransactions.mockResolvedValue(2);
      walletRepositoryService.findStuckTransactions.mockResolvedValue([]);
    });

    it("should return valid for correct minting request", async () => {
      const request = {
        npub: "npub1validnpub",
        amount: 1000,
      };

      const result = await ValidationService.validateMintingRequest(request);

      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    it("should return invalid for invalid npub", async () => {
      nip19.decode.mockImplementation(() => {
        throw new Error("Invalid format");
      });

      const request = {
        npub: "invalid_npub",
        amount: 1000,
      };

      const result = await ValidationService.validateMintingRequest(request);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Invalid npub format");
    });

    it("should return invalid for invalid amount", async () => {
      const request = {
        npub: "npub1validnpub",
        amount: 0,
      };

      const result = await ValidationService.validateMintingRequest(request);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "Amount must be between 1 and 1000000 sats"
      );
    });

    it("should return invalid when wallet not found", async () => {
      walletRepositoryService.findWallet.mockResolvedValue(null);

      const request = {
        npub: "npub1validnpub",
        amount: 1000,
      };

      const result = await ValidationService.validateMintingRequest(request);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Wallet not found for this user");
    });

    it("should return invalid when too many pending transactions", async () => {
      walletRepositoryService.countPendingTransactions.mockResolvedValue(6);

      const request = {
        npub: "npub1validnpub",
        amount: 1000,
      };

      const result = await ValidationService.validateMintingRequest(request);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "Too many pending transactions (6/5). Please wait for some to complete."
      );
    });

    it("should return warning when stuck transactions detected", async () => {
      walletRepositoryService.findStuckTransactions.mockResolvedValue([
        {
          transaction_id: "stuck1",
          created_at: new Date(Date.now() - 2 * 60 * 60 * 1000),
        },
      ]);

      const request = {
        npub: "npub1validnpub",
        amount: 1000,
      };

      const result = await ValidationService.validateMintingRequest(request);

      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain(
        "1 stuck transaction(s) detected (>1 hour old). Consider cleanup."
      );
    });
  });

  describe("validateCompletionRequest", () => {
    it("should return valid for correct completion request", () => {
      nip19.decode.mockReturnValue({ type: "npub", data: "validhex" });

      const request = {
        npub: "npub1validnpub",
        quoteId: "quote123",
        amount: 1000,
        transactionId: "tx123",
      };

      const result = ValidationService.validateCompletionRequest(request);

      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("should return invalid for missing required fields", () => {
      const request = {
        npub: "npub1validnpub",
        // missing quoteId, amount, transactionId
      };

      const result = ValidationService.validateCompletionRequest(request);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("quoteId is required");
      expect(result.errors).toContain("amount is required");
      expect(result.errors).toContain("transactionId is required");
    });

    it("should return invalid for invalid npub", () => {
      nip19.decode.mockImplementation(() => {
        throw new Error("Invalid format");
      });

      const request = {
        npub: "invalid_npub",
        quoteId: "quote123",
        amount: 1000,
        transactionId: "tx123",
      };

      const result = ValidationService.validateCompletionRequest(request);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Invalid npub format");
    });

    it("should return invalid for invalid amount", () => {
      nip19.decode.mockReturnValue({ type: "npub", data: "validhex" });

      const request = {
        npub: "npub1validnpub",
        quoteId: "quote123",
        amount: "not_a_number",
        transactionId: "tx123",
      };

      const result = ValidationService.validateCompletionRequest(request);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Amount must be a positive number");
    });
  });
});
