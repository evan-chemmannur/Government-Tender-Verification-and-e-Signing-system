import { rgb } from 'pdf-lib';
import { numberToWords } from './numberToWords.js';

export function drawGovernmentHeader(page, pdfDoc, font, boldFont) {
    const { width } = page.getSize();
    
    // Header
    const govText = 'GOVERNMENT OF MAHARASHTRA';
    const govTextWidth = boldFont.widthOfTextAtSize(govText, 18);
    page.drawText(govText, {
        x: (width - govTextWidth) / 2,
        y: 800,
        size: 18,
        font: boldFont,
        color: rgb(0, 0, 0),
    });

    // Horizontal line
    page.drawLine({
        start: { x: 50, y: 780 },
        end: { x: width - 50, y: 780 },
        thickness: 1.5,
        color: rgb(0, 0, 0),
    });
}

export function drawSignatureBlock(page, officer, font) {
    page.drawText('Authorized Signatory:', {
        x: 50,
        y: 200,
        size: 12,
        font: font,
    });
    
    // Placeholder for signature image or just name
    page.drawText(`${officer.name}`, {
        x: 50,
        y: 160,
        size: 12,
        font: font,
    });
    page.drawText(`(${officer.designation})`, {
        x: 50,
        y: 145,
        size: 10,
        font: font,
    });
}

export function drawQRSection(page, qrImage, tender, vc, font) {
    const { width } = page.getSize();
    const qrSize = 120;
    const padding = 20;
    const x = width - qrSize - padding - 20; // 400ish
    const y = 40;

    // Draw QR Code
    page.drawImage(qrImage, {
        x: x,
        y: y,
        width: qrSize,
        height: qrSize,
    });

    // Verification Text
    page.drawText('Verify this document', {
        x: x,
        y: y - 15,
        size: 10,
        font: font,
    });
    
    page.drawText('https://verify.inji.io', {
        x: x,
        y: y - 30,
        size: 10,
        font: font,
        color: rgb(0, 0, 1), // Blue link
    });

    // Tender Details next to QR
    page.drawText(`Tender ID: ${tender.tender_id}`, {
        x: x - 200,
        y: y + qrSize - 10,
        size: 10,
        font: font,
    });
    
    const issueDate = vc && vc.issued_at ? new Date(vc.issued_at).toLocaleDateString() : new Date().toLocaleDateString();
    page.drawText(`Issue Date: ${issueDate}`, {
        x: x - 200,
        y: y + qrSize - 25,
        size: 10,
        font: font,
    });
}

export function formatValueForPDF(paiseValue) {
    const rupees = Math.floor(paiseValue / 100);
    const words = numberToWords(paiseValue); // numberToWords expects paise
    
    // Format with commas for Indian Rupee system
    // Note: Replaced '₹' with 'Rs. ' because pdf-lib's StandardFonts (WinAnsi)
    // cannot encode the unicode Rupee symbol (0x20b9). 
    // This is a known technical deviation from the spec visual example (₹4,85,00,000)
    // required to prevent generation crashes without embedding a custom unicode font.
    const formattedRupees = new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(rupees).replace('₹', 'Rs. ');

    return `${formattedRupees} (${words})`;
}
