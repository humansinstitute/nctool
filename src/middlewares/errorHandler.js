import { logger } from '../utils/logger.js';

/**
 * Error-handling middleware for Express.
 */
export function errorHandler(err, req, res, next) {
    logger.error(err);
    const status = err.status || 500;
    res.status(status).json({
        error: err.name || 'Error',
        message: err.message || 'An unexpected error occurred'
    });
}
