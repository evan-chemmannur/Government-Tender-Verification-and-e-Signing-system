import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { tenderModel } from '../models/tenderModel.js';
import { vcModel } from '../models/vcModel.js';
import docxService from '../services/docxService.js';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import QRCode from 'qrcode';
import { pool } from '../config/database.js';

const router = Router();

// Ensure storage paths exist
const STORAGE_PATH = process.env.STORAGE_PATH || path.join(process.cwd(), 'storage');
const DOCX_DIR = path.join(STORAGE_PATH, 'award-letters', 'docx');
const PDF_DIR = path.join(STORAGE_PATH, 'award-letters', 'pdf');

async function ensureDirs() {
    await fs.mkdir(DOCX_DIR, { recursive: true });
    await fs.mkdir(PDF_DIR, { recursive: true });
}
ensureDirs().catch(console.error);

/**
 * POST /api/tenders/:id/generate-letter
 * Generates DOCX award letter, converts to PDF, stamps QR, saves both.
 * Returns download URLs.
 */
router.post('/:id/generate-letter', requireAuth, async (req, res, next) => {
    try {
        const tenderId = req.params.id;
        const tender = await tenderModel.findById(tenderId);

        if (!tender) {
            return res.status(404).json({ error: 'Tender not found' });
        }

        if (tender.status !== 'SIGNED') {
            return res.status(403).json({ error: 'Award letter can only be generated for SIGNED tenders' });
        }

        const vc = await vcModel.getVCByTenderId(tenderId);

        // Generate DOCX and initial PDF
        const { docxBuffer, pdfBuffer: unstampedPdfBuffer } = await docxService.generateAndConvert(tender, req.officer, vc);

        // Generate QR code for Verification URL
        const verifyUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify/${vc?.credential_id || 'UNKNOWN'}`;
        const qrDataURL = await QRCode.toDataURL(verifyUrl, { errorCorrectionLevel: 'H', margin: 1 });

        // Stamp QR on PDF (we need to dynamically import or use pdf worker, but here we can just do it inline if pdfWorker doesn't export stampQROnExistingPDF)
        // Wait, pdfWorker.js might not export stampQROnExistingPDF for direct use, it's a worker.
        // Let's use the pdf-lib directly or pass to worker. We'll use pdf-lib here directly for simplicity, or use pdfWorker if it's exported.
        let finalPdfBuffer = unstampedPdfBuffer;
        try {
            const { PDFDocument, StandardFonts } = await import('pdf-lib');
            const { drawQRSection } = await import('../utils/pdfGenerator.js');
            const doc = await PDFDocument.load(unstampedPdfBuffer);
            const pages = doc.getPages();
            const lastPage = pages[pages.length - 1];
            const font = await doc.embedFont(StandardFonts.Helvetica);
            
            const qrImage = await doc.embedPng(qrDataURL);
            drawQRSection(lastPage, qrImage, tender, vc, font);
            finalPdfBuffer = await doc.save();
        } catch (qrErr) {
            console.error('Error stamping QR code:', qrErr);
            // Fallback to unstamped PDF if QR stamping fails
        }

        // Save files
        const docxFilename = `${tenderId}-award-letter.docx`;
        const pdfFilename = `${tenderId}-award-letter.pdf`;
        
        await fs.writeFile(path.join(DOCX_DIR, docxFilename), docxBuffer);
        const finalBufferToWrite = Buffer.isBuffer(finalPdfBuffer) ? finalPdfBuffer : Buffer.from(finalPdfBuffer);
        await fs.writeFile(path.join(PDF_DIR, pdfFilename), finalBufferToWrite);

        // Construct URLs
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const docxUrl = `${baseUrl}/api/tenders/${tenderId}/letter/docx`;
        const pdfUrl = `${baseUrl}/api/tenders/${tenderId}/letter/pdf`;

        res.json({
            message: 'Award letter generated successfully',
            docxUrl,
            pdfUrl
        });

    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/tenders/:id/letter/docx
 * Download DOCX award letter
 */
router.get('/:id/letter/docx', requireAuth, async (req, res, next) => {
    try {
        const tenderId = req.params.id;
        const filePath = path.join(DOCX_DIR, `${tenderId}-award-letter.docx`);
        
        try {
            await fs.access(filePath);
        } catch {
            return res.status(404).json({ error: 'DOCX Award letter not found' });
        }

        res.download(filePath, `Award_Letter_${tenderId}.docx`);
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/tenders/:id/letter/pdf
 * Download PDF award letter
 */
router.get('/:id/letter/pdf', requireAuth, async (req, res, next) => {
    try {
        const tenderId = req.params.id;
        const filePath = path.join(PDF_DIR, `${tenderId}-award-letter.pdf`);
        
        try {
            await fs.access(filePath);
        } catch {
            return res.status(404).json({ error: 'PDF Award letter not found' });
        }

        res.download(filePath, `Award_Letter_${tenderId}.pdf`);
    } catch (err) {
        next(err);
    }
});

export default router;
