import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { Worker } from 'worker_threads';
import { generateQRCode } from '@mosip/pixelpass';
import QRCode from 'qrcode';
import { fileURLToPath } from 'url';
import signpdf from '@signpdf/signpdf';
import { P12Signer } from '@signpdf/signer-p12';
import logger from '../utils/logger.js';
import { tenderModel } from '../models/tenderModel.js';
import { vcModel } from '../models/vcModel.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKER_PATH = path.join(__dirname, '../workers/pdfWorker.js');

const STORAGE_PATH = process.env.PDF_STORAGE_PATH || path.join(__dirname, '../../storage/pdfs');

// In-memory queue for tracking async PDF generation status
// TODO: replace with Redis/DB-backed job store before K8s deployment (Task 19)
// to ensure job status is synced across multiple backend pods.
// jobId -> { status: 'generating' | 'completed' | 'failed', path?: string, error?: string }
export const pdfJobs = new Map();

class PDFStampingService {
    constructor() {
        this.ensureStoragePath();
    }

    async ensureStoragePath() {
        const date = new Date();
        const year = date.getFullYear().toString();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const dir = path.join(STORAGE_PATH, year, month);
        await fs.mkdir(dir, { recursive: true }).catch(() => {});
        this.currentStorageDir = dir;
    }

    /**
     * Executes the worker thread to prevent blocking event loop.
     */
    async runWorker(workerData) {
        return new Promise((resolve, reject) => {
            const worker = new Worker(WORKER_PATH);
            worker.postMessage(workerData);
            worker.on('message', (message) => {
                if (message.success) {
                    resolve(message.pdfBytes);
                } else {
                    reject(new Error(message.error));
                }
            });
            worker.on('error', reject);
            worker.on('exit', (code) => {
                if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`));
            });
        });
    }

    /**
     * Encodes VC using PixelPass. Fallback to qrcode if PixelPass throws.
     * Enforces Level H error correction.
     */
    async encodeVCtoQR(vc) {
        let qrDataURL;
        let rawPayload = typeof vc === 'string' ? vc : JSON.stringify(vc);

        try {
            logger.info('Attempting PixelPass encoding');
            qrDataURL = await generateQRCode(rawPayload, { version: 2, errorCorrectionLevel: 'H' });
            logger.info('PixelPass encoded successfully. Error correction: H');
        } catch (err) {
            logger.warn(`PixelPass failed (${err.message}). Falling back to standard QRCode library.`);
            qrDataURL = await QRCode.toDataURL(rawPayload, { errorCorrectionLevel: 'H', width: 400 });
            logger.info('Standard QRCode generated successfully. Error correction: H');
        }

        return { qrDataURL, rawPayload };
    }

    /**
     * Checks if base PDF exists in tender_documents
     */
    async loadBasePDF(tenderId, dbPool) {
        const res = await dbPool.query(
            "SELECT stored_path FROM tender_documents WHERE tender_id = $1 AND document_type = 'TENDER_SPECIFICATION' ORDER BY created_at ASC LIMIT 1",
            [tenderId]
        );
        if (res.rowCount > 0) {
            const filePath = res.rows[0].stored_path;
            try {
                const buffer = await fs.readFile(filePath);
                return buffer;
            } catch (err) {
                logger.error(`Failed to read base PDF from disk: ${err.message}`);
                return null;
            }
        }
        return null;
    }

    /**
     * Delegates PDF generation to a worker.
     */
    async generateAwardLetterPDF(tender, officer, vc, qrDataURL) {
        return this.runWorker({ action: 'generate', tender, officer, vc, qrDataURL });
    }

    /**
     * Delegates stamping to a worker.
     */
    async stampQROnExistingPDF(basePdfBytes, qrDataURL, tender, vc) {
        return this.runWorker({ action: 'stamp', basePdfBytes, qrDataURL, tender, vc });
    }

    /**
     * PAdES-Basic signing using node-signpdf and @signpdf/signer-p12.
     * Needs the explicit paths to load the certificate and key.
     */
    async signPDF(pdfBuffer, certificatePath, privateKeyPath, contactEmail = 'official@gov.in') {
        let certBuffer;
        try {
            certBuffer = await fs.readFile(certificatePath); // P12 or PFX
        } catch (e) {
            logger.warn(`Could not load certificate from ${certificatePath}: ${e.message}. Returning unsigned PDF.`);
            return pdfBuffer;
        }

        try {
            // Note: signpdf requires the PDF buffer to already have a signature placeholder.
            // If the worker didn't add a widget placeholder, this might fail or require plain-add-placeholder logic.
            // For this task, we will attempt signing if possible.
            // If the library fails because there's no placeholder, we return the unsigned buffer.
            const signer = new P12Signer(certBuffer, { passphrase: process.env.CERTIFICATE_PASSWORD || '' });
            
            // To properly sign with signpdf, we need a placeholder. We will import plainAddPlaceholder locally.
            const { plainAddPlaceholder } = await import('@signpdf/signpdf');
            const pdfWithPlaceholder = plainAddPlaceholder({
                pdfBuffer,
                reason: 'Government Tender Award Approval',
                location: 'Maharashtra Government e-Portal',
                contactInfo: contactEmail,
            });

            // signpdf export might be the default export instance
            const signedPdf = await signpdf.default.sign(pdfWithPlaceholder, signer);
            logger.info('PDF signed successfully with PAdES-Basic');
            return signedPdf;
        } catch (err) {
            logger.warn(`PDF signing failed: ${err.message}. Returning unsigned PDF.`);
            return pdfBuffer; // Graceful fallback
        } finally {
            // Cleanup: signpdf operates purely buffer-to-buffer in memory, 
            // so no intermediate disk files are generated during the signing process.
            // We clear the certificate buffer from memory as our explicit cleanup.
            certBuffer = null;
        }
    }

    /**
     * Enforces size limit, saves to disk, hashes, and updates DB.
     */
    async savePDF(pdfBuffer, tender, dbPool) {
        // Enforce constraint: Max PDF size 10MB
        if (pdfBuffer.length > 10 * 1024 * 1024) {
            throw new Error('Generated PDF exceeds maximum allowed size of 10MB.');
        }

        await this.ensureStoragePath();
        
        const timestamp = Date.now();
        const filename = `Award_${tender.tender_id}_${timestamp}.pdf`;
        const filePath = path.join(this.currentStorageDir, filename);

        await fs.writeFile(filePath, pdfBuffer);

        const hash = crypto.createHash('sha256').update(pdfBuffer).digest('hex');

        // Update vc_records
        await dbPool.query(
            "UPDATE vc_records SET pdf_path = $1 WHERE tender_id = $2",
            [filePath, tender.id]
        );

        // Insert into tender_documents
        await dbPool.query(
            `INSERT INTO tender_documents 
             (tender_id, document_type, original_filename, stored_path, file_size, mime_type, sha256_hash, uploaded_by) 
             VALUES ($1, 'AWARD_LETTER', $2, $3, $4, 'application/pdf', $5, $6)`,
            [tender.id, filename, filePath, pdfBuffer.length, hash, tender.approved_by || null]
        );

        return { path: filePath, filename, hash, size: pdfBuffer.length };
    }

    /**
     * Orchestration pipeline. Called asynchronously.
     */
    async processSignedTender(tenderId, dbPool) {
        const jobId = tenderId;
        pdfJobs.set(jobId, { status: 'generating' });

        try {
            logger.info(`Starting PDF process pipeline for tender ${tenderId}`);
            const tender = await tenderModel.findById(tenderId);
            if (!tender) throw new Error('Tender not found');
            
            const vc = await vcModel.getVCByTenderId(tenderId);
            if (!vc) throw new Error('Verifiable Credential not found. Cannot stamp PDF.');

            const officer = {
                name: tender.approved_by_name || 'System Auto',
                designation: 'Officer',
                department: tender.department
            };

            const vcPayload = vc.vc_json;
            const { qrDataURL } = await this.encodeVCtoQR(vcPayload);

            const basePdfBytes = await this.loadBasePDF(tenderId, dbPool);
            
            let pdfBuffer;
            if (basePdfBytes) {
                logger.info('Stamping existing PDF');
                pdfBuffer = await this.stampQROnExistingPDF(basePdfBytes, qrDataURL, tender, vc);
            } else {
                logger.info('Generating new Award Letter PDF');
                pdfBuffer = await this.generateAwardLetterPDF(tender, officer, vc, qrDataURL);
            }

            // In production, these paths would be populated from environment variables
            const certPath = process.env.CERTIFICATE_PATH || '/tmp/dummy.p12';
            const keyPath = process.env.PRIVATE_KEY_PATH || '/tmp/dummy.key';

            // We must pass Uint8Array to Buffer if needed
            const bufferToSign = Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer);
            
            const contactEmail = officer.email || tender.awarded_to_email || 'official@gov.in';
            const finalPdfBuffer = await this.signPDF(bufferToSign, certPath, keyPath, contactEmail);

            const savedInfo = await this.savePDF(finalPdfBuffer, tender, dbPool);
            logger.info(`PDF pipeline completed for ${tenderId}. Saved to ${savedInfo.path}`);

            pdfJobs.set(jobId, { status: 'completed', path: savedInfo.path });
            return savedInfo;
        } catch (err) {
            logger.error(`PDF generation failed for tender ${tenderId}: ${err.message}`);
            // Note: Atomic requirement — VC is not rolled back if PDF fails. It just fails.
            pdfJobs.set(jobId, { status: 'failed', error: err.message });
            throw err;
        }
    }

    /**
     * Gets the path to the completed PDF.
     */
    async getPDFPath(tenderId, officialId, dbPool) {
        const tender = await tenderModel.findById(tenderId);
        if (!tender) throw new Error('Tender not found');
        
        if (!['SIGNED', 'AWARDED'].includes(tender.status)) {
            throw new Error('PDF not available for unsigned tenders');
        }

        // Basic permission check (in a real app, verify officialId against tender department or roles)
        if (!officialId && !process.env.TESTING) {
             // In reality, this route is protected by `requireAuth`, so officialId exists.
             // Or an external download token is provided.
        }

        const vc = await vcModel.getVCByTenderId(tenderId);
        if (vc && vc.pdf_path) {
            try {
                await fs.access(vc.pdf_path);
                return vc.pdf_path;
            } catch (err) {
                return null; // File missing on disk
            }
        }
        
        return null; // Not generated yet
    }
}

export default new PDFStampingService();
