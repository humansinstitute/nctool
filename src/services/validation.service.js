import { nip19 } from "nostr-tools";
import { logger } from "../utils/logger.js";
import walletRepositoryService from "./walletRepository.service.js";

/**
 * Validation Service for Lightning Minting Operations
 *
 * Provides comprehensive input validation and safeguards for Lightning minting
 * to ensure reliability and prevent invalid operations.
 */
class ValidationService {
  // Minting limits configuration
  static MINT_LIMITS = {
    MIN_AMOUNT: 1, // Minimum 1 satoshi
    MAX_AMOUNT: 1000000, // Maximum 1M satoshis (10,000 USD at $100k/BTC)
    MAX_PENDING_PER_USER: 5, // Maximum pending transactions per user
  };

  /**
   * Validate Lightning minting request parameters
   * @param {Object} params - Minting parameters
   * @param {string} params.npub - User's npub
   * @param {number} params.amount - Amount to mint
   * @returns {Promise<Object>} Validation result
   */
  static async validateMintingRequest(params) {
    const { npub, amount } = params;
    const errors = [];
    const warnings = [];

    try {
      logger.info("Validating Lightning minting request", { npub, amount });

      // 1. Validate npub format
      const npubValidation = this.validateNpub(npub);
      if (!npubValidation.isValid) {
        errors.push(`Invalid npub format: ${npubValidation.error}`);
      }

      // 2. Validate amount
      const amountValidation = this.validateAmount(amount);
      if (!amountValidation.isValid) {
        errors.push(`Invalid amount: ${amountValidation.error}`);
      }

      // 3. Check if wallet exists
      const walletValidation = await this.validateWalletExists(npub);
      if (!walletValidation.isValid) {
        errors.push(`Wallet validation failed: ${walletValidation.error}`);
      }

      // 4. Check pending transaction limits
      const pendingValidation = await this.validatePendingLimits(npub);
      if (!pendingValidation.isValid) {
        errors.push(
          `Pending transaction limit exceeded: ${pendingValidation.error}`
        );
      } else if (pendingValidation.warning) {
        warnings.push(pendingValidation.warning);
      }

      // 5. Check for stuck pending transactions
      const stuckValidation = await this.checkStuckTransactions(npub);
      if (stuckValidation.hasStuckTransactions) {
        warnings.push(
          `Found ${stuckValidation.count} stuck pending transactions. Consider cleanup.`
        );
      }

      const isValid = errors.length === 0;

      logger.info("Minting request validation completed", {
        npub,
        amount,
        isValid,
        errorCount: errors.length,
        warningCount: warnings.length,
      });

      return {
        isValid,
        errors,
        warnings,
        validatedParams: isValid ? { npub, amount } : null,
      };
    } catch (error) {
      logger.error("Error during minting request validation", {
        npub,
        amount,
        error: error.message,
      });

      return {
        isValid: false,
        errors: [`Validation error: ${error.message}`],
        warnings,
        validatedParams: null,
      };
    }
  }

  /**
   * Validate npub format
   * @param {string} npub - User's npub
   * @returns {Object} Validation result
   */
  static validateNpub(npub) {
    if (!npub || typeof npub !== "string") {
      return { isValid: false, error: "npub is required and must be a string" };
    }

    try {
      const decoded = nip19.decode(npub);
      if (decoded.type !== "npub") {
        return { isValid: false, error: "Invalid npub type" };
      }
      return { isValid: true };
    } catch (error) {
      return { isValid: false, error: "Invalid npub format" };
    }
  }

  /**
   * Validate minting amount
   * @param {number} amount - Amount to mint
   * @returns {Object} Validation result
   */
  static validateAmount(amount) {
    if (amount === undefined || amount === null) {
      return { isValid: false, error: "amount is required" };
    }

    if (typeof amount !== "number") {
      return { isValid: false, error: "amount must be a number" };
    }

    if (!Number.isInteger(amount)) {
      return { isValid: false, error: "amount must be an integer (satoshis)" };
    }

    if (amount < this.MINT_LIMITS.MIN_AMOUNT) {
      return {
        isValid: false,
        error: `amount must be at least ${this.MINT_LIMITS.MIN_AMOUNT} satoshi`,
      };
    }

    if (amount > this.MINT_LIMITS.MAX_AMOUNT) {
      return {
        isValid: false,
        error: `amount cannot exceed ${this.MINT_LIMITS.MAX_AMOUNT} satoshis`,
      };
    }

    return { isValid: true };
  }

  /**
   * Validate that wallet exists for user
   * @param {string} npub - User's npub
   * @returns {Promise<Object>} Validation result
   */
  static async validateWalletExists(npub) {
    try {
      const MINT_URL = process.env.MINT_URL || "https://testnut.cashu.space";
      const wallet = await walletRepositoryService.findWallet(npub, MINT_URL);

      if (!wallet) {
        return {
          isValid: false,
          error: "Wallet not found. Please create a wallet first.",
        };
      }

      return { isValid: true, wallet };
    } catch (error) {
      return {
        isValid: false,
        error: `Failed to validate wallet existence: ${error.message}`,
      };
    }
  }

  /**
   * Validate pending transaction limits
   * @param {string} npub - User's npub
   * @returns {Promise<Object>} Validation result
   */
  static async validatePendingLimits(npub) {
    try {
      // Check pending transactions in last 24 hours
      const cutoffDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const pendingTransactions =
        await walletRepositoryService.findPendingMintTransactions(
          npub,
          cutoffDate
        );

      const pendingCount = pendingTransactions.length;

      if (pendingCount >= this.MINT_LIMITS.MAX_PENDING_PER_USER) {
        return {
          isValid: false,
          error: `Too many pending transactions (${pendingCount}/${this.MINT_LIMITS.MAX_PENDING_PER_USER}). Please wait for existing transactions to complete.`,
        };
      }

      let warning = null;
      if (pendingCount >= this.MINT_LIMITS.MAX_PENDING_PER_USER - 1) {
        warning = `Approaching pending transaction limit (${pendingCount}/${this.MINT_LIMITS.MAX_PENDING_PER_USER})`;
      }

      return {
        isValid: true,
        pendingCount,
        warning,
      };
    } catch (error) {
      return {
        isValid: false,
        error: `Failed to check pending transaction limits: ${error.message}`,
      };
    }
  }

  /**
   * Check for stuck pending transactions (older than 1 hour)
   * @param {string} npub - User's npub
   * @returns {Promise<Object>} Check result
   */
  static async checkStuckTransactions(npub) {
    try {
      // Check for transactions older than 1 hour that are still pending
      const stuckCutoff = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
      const recentCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago

      const allPending =
        await walletRepositoryService.findPendingMintTransactions(
          npub,
          recentCutoff
        );

      const stuckTransactions = allPending.filter(
        (tx) => new Date(tx.created_at) < stuckCutoff
      );

      return {
        hasStuckTransactions: stuckTransactions.length > 0,
        count: stuckTransactions.length,
        stuckTransactions,
      };
    } catch (error) {
      logger.error("Error checking stuck transactions", {
        npub,
        error: error.message,
      });
      return {
        hasStuckTransactions: false,
        count: 0,
        stuckTransactions: [],
      };
    }
  }

  /**
   * Validate completion request parameters
   * @param {Object} params - Completion parameters
   * @returns {Object} Validation result
   */
  static validateCompletionRequest(params) {
    const { npub, quoteId, amount, transactionId } = params;
    const errors = [];

    // Validate npub
    const npubValidation = this.validateNpub(npub);
    if (!npubValidation.isValid) {
      errors.push(`Invalid npub: ${npubValidation.error}`);
    }

    // Validate quoteId
    if (!quoteId || typeof quoteId !== "string") {
      errors.push("quoteId is required and must be a string");
    }

    // Validate amount
    const amountValidation = this.validateAmount(amount);
    if (!amountValidation.isValid) {
      errors.push(`Invalid amount: ${amountValidation.error}`);
    }

    // Validate transactionId
    if (!transactionId || typeof transactionId !== "string") {
      errors.push("transactionId is required and must be a string");
    }

    return {
      isValid: errors.length === 0,
      errors,
      validatedParams: errors.length === 0 ? params : null,
    };
  }
}

export default ValidationService;
