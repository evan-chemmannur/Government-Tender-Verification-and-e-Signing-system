import winston from 'winston';
import { LOG_LEVEL } from '../config/constants.js';

const format = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
);

const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.printf(
        ({ level, message, timestamp, stack }) => `${timestamp} ${level}: ${message} ${stack ? '\n' + stack : ''}`
    )
);

const logger = winston.createLogger({
    level: LOG_LEVEL,
    format,
    transports: [
        new winston.transports.Console({
            format: consoleFormat
        })
    ]
});

// Do not use console.log
console.log = (...args) => logger.info(args.join(' '));
console.error = (...args) => logger.error(args.join(' '));

export default logger;
