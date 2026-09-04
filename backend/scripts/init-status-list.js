#!/usr/bin/env node

/**
 * init-status-list.js — Setup script for the W3C BitString Status List.
 *
 * Creates the current year's status list if it doesn't already exist.
 * Run once at the start of each year, or on first deployment.
 *
 * Usage:
 *   node scripts/init-status-list.js
 *   node scripts/init-status-list.js 2027   # specific year
 */

import { pool } from '../src/config/database.js';
import statusListService from '../src/services/statusListService.js';
import logger from '../src/utils/logger.js';

async function main() {
    const year = parseInt(process.argv[2], 10) || new Date().getFullYear();

    logger.info(`Initializing status list for year ${year}...`);

    try {
        const record = await statusListService.getOrCreateStatusList(year, pool);

        logger.info(`Status list for ${year}: list_id=${record.list_id}, ` +
            `next_index=${record.next_available_index}, capacity=${record.capacity}`);

        // Capacity monitoring check
        if (record.next_available_index >= 80_000) {
            logger.warn(
                `⚠️  CAPACITY ALERT: Year ${year} status list is at ` +
                `${record.next_available_index}/${record.capacity} (${((record.next_available_index / record.capacity) * 100).toFixed(1)}% full). ` +
                `Consider provisioning a new status list.`
            );
        } else {
            logger.info(`✅ Capacity OK: ${record.next_available_index}/${record.capacity} used.`);
        }

        logger.info('Status list initialization complete.');
    } catch (err) {
        logger.error(`Failed to initialize status list: ${err.message}`);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

main();
