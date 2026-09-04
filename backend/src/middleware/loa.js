import { ForbiddenError } from '../utils/errors.js';
import logger from '../utils/logger.js';

/**
 * Middleware to check if the user meets the required Level of Assurance (LoA)
 * @param {string} requiredLoa 
 */
export const requireLoa = (requiredLoa) => {
    return (req, res, next) => {
        const userLoa = req.session?.loa;
        
        if (!userLoa) {
            return next(new ForbiddenError('LoA not present in session'));
        }

        // Simplistic LoA check (assuming LoA 3 > LoA 2 > LoA 1)
        const userLoaNum = parseInt(userLoa.replace(/\D/g, ''), 10) || 0;
        const reqLoaNum = parseInt(requiredLoa.replace(/\D/g, ''), 10) || 0;

        if (userLoaNum < reqLoaNum) {
            logger.warn(`User LoA ${userLoa} is insufficient for required ${requiredLoa}`);
            return next(new ForbiddenError(`This action requires Level of Assurance ${requiredLoa}`));
        }

        next();
    };
};
