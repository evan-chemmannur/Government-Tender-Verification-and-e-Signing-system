import { parentPort } from 'worker_threads';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { drawGovernmentHeader, drawSignatureBlock, drawQRSection, formatValueForPDF } from '../utils/pdfGenerator.js';

/**
 * Worker thread for CPU-intensive PDF operations.
 */
parentPort.on('message', async (data) => {
    try {
        const { action, tender, officer, vc, qrDataURL, basePdfBytes } = data;
        let resultBuffer;

        if (action === 'generate') {
            resultBuffer = await generateAwardLetterPDF(tender, officer, vc, qrDataURL);
        } else if (action === 'stamp') {
            resultBuffer = await stampQROnExistingPDF(basePdfBytes, qrDataURL, tender, vc);
        } else {
            throw new Error(`Unknown action: ${action}`);
        }

        parentPort.postMessage({ success: true, pdfBytes: resultBuffer });
    } catch (error) {
        parentPort.postMessage({ success: false, error: error.message });
    }
});

async function generateAwardLetterPDF(tender, officer, vc, qrDataURL) {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]); // A4
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

    drawGovernmentHeader(page, doc, font, boldFont);

    // Document Details
    const titleText = 'TENDER AWARD LETTER';
    const titleWidth = boldFont.widthOfTextAtSize(titleText, 14);
    page.drawText(titleText, {
        x: (595 - titleWidth) / 2,
        y: 740,
        size: 14,
        font: boldFont,
    });

    const refText = `Ref No: ${tender.tender_id}`;
    page.drawText(refText, { x: 50, y: 700, size: 10, font: boldFont });
    
    const dateText = `Date: ${new Date().toLocaleDateString('en-IN')}`;
    page.drawText(dateText, { x: 450, y: 700, size: 10, font });

    // Salutation
    page.drawText('To,', { x: 50, y: 660, size: 12, font: boldFont });
    page.drawText(`M/s ${tender.awarded_to_name}`, { x: 50, y: 645, size: 12, font: boldFont });

    // Body
    const amountStr = formatValueForPDF(tender.actual_value || tender.estimated_value);
    const bodyText = `This is to formally notify you that your bid for the tender "${tender.title}" has been accepted by the competent authority. The contract is awarded to your firm for a total value of ${amountStr}. You are requested to commence the work from ${tender.contract_start_date ? new Date(tender.contract_start_date).toLocaleDateString() : '[Start Date]'} as per the terms and conditions outlined in the tender specification documents.`;
    
    // Simple text wrapping (basic implementation for the worker)
    const words = bodyText.split(' ');
    let line = '';
    let y = 610;
    for (const word of words) {
        const testLine = line + word + ' ';
        const testWidth = font.widthOfTextAtSize(testLine, 12);
        if (testWidth > 495) { // 595 - 50(left margin) - 50(right margin)
            page.drawText(line, { x: 50, y, size: 12, font });
            line = word + ' ';
            y -= 15;
        } else {
            line = testLine;
        }
    }
    if (line) {
        page.drawText(line, { x: 50, y, size: 12, font });
    }

    // Terms section
    page.drawText('Terms and Conditions:', { x: 50, y: y - 30, size: 12, font: boldFont });
    page.drawText('1. The execution of the contract shall be strictly in accordance with the tender specs.', { x: 50, y: y - 50, size: 10, font });
    page.drawText('2. Any deviation may result in immediate revocation of this award.', { x: 50, y: y - 65, size: 10, font });

    drawSignatureBlock(page, officer, font);

    if (qrDataURL) {
        const qrImage = await doc.embedPng(qrDataURL);
        drawQRSection(page, qrImage, tender, vc, font);
    }

    return await doc.save();
}

async function stampQROnExistingPDF(basePdfBytes, qrDataURL, tender, vc) {
    // Need to use Buffer or Uint8Array. Since data passed to worker is likely Uint8Array or Buffer.
    const doc = await PDFDocument.load(basePdfBytes);
    const pages = doc.getPages();
    const lastPage = pages[pages.length - 1];
    
    const font = await doc.embedFont(StandardFonts.Helvetica);

    if (qrDataURL) {
        const qrImage = await doc.embedPng(qrDataURL);
        drawQRSection(lastPage, qrImage, tender, vc, font);
    }

    return await doc.save();
}
