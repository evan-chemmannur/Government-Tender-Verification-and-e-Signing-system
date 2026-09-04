import './config/envValidator.js'; // Ensure env vars are loaded BEFORE anything else
import app from './app.js';
import { PORT } from './config/constants.js';
import { testDbConnection } from './config/database.js';
import logger from './utils/logger.js';

async function startServer() {
    try {
        await testDbConnection();
        
        app.listen(PORT, () => {
            logger.info(`Server is running on port ${PORT}`);
        });

    } catch (error) {
        logger.error(`Failed to start server: ${error.message}`);
        process.exit(1);
    }
}

// Handle unexpected errors (never throw uncaught exceptions)
process.on('uncaughtException', (err) => {
    logger.error('UNCAUGHT EXCEPTION! Shutting down...', { error: err.message, stack: err.stack });
    process.exit(1);
});

process.on('unhandledRejection', (err) => {
    logger.error('UNHANDLED REJECTION! Shutting down...', { error: err.message, stack: err.stack });
    process.exit(1);
});

startServer();
