import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import mammoth from 'mammoth';
import * as docx from 'docx';
import { exec } from 'child_process';
import util from 'util';
const execPromise = util.promisify(exec);
import { numberToWords } from '../utils/numberToWords.js';
import logger from '../utils/logger.js'; // Use existing logger or console
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default to backend/uploads if not set
const STORAGE_PATH = process.env.STORAGE_PATH || path.join(__dirname, '../../uploads');

// Ensure storage path exists
(async () => {
  try {
    await fs.mkdir(STORAGE_PATH, { recursive: true });
  } catch (err) {
    console.error('Failed to create storage directory:', err);
  }
})();

class DocumentService {
  /**
   * Validates file buffer with strict magic byte checks
   * @param {Buffer} buffer File buffer
   * @param {string} originalName Original filename
   * @returns {string} sha256 hash of the file
   */
  validateFileBuffer(buffer, originalName) {
    if (buffer.length > 20 * 1024 * 1024) {
      throw new Error('File exceeds 20MB limit');
    }

    const ext = path.extname(originalName).toLowerCase();
    
    // Magic byte check to prevent extension spoofing
    if (ext === '.pdf') {
      // PDF starts with %PDF- (25 50 44 46 2D)
      if (buffer.length < 5 || buffer.toString('utf8', 0, 5) !== '%PDF-') {
        throw new Error('Invalid PDF file signature');
      }
    } else if (ext === '.docx') {
      // DOCX starts with PK\x03\x04 (50 4B 03 04)
      if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4B || buffer[2] !== 0x03 || buffer[3] !== 0x04) {
        throw new Error('Invalid DOCX file signature');
      }
      // Deep Security Hardening: Prevent ZIP container loophole
      // Ensure the ZIP structure contains standard OpenXML markers
      const contentTypesMarker = Buffer.from('[Content_Types].xml');
      const wordDirMarker = Buffer.from('word/');
      
      if (buffer.indexOf(contentTypesMarker) === -1 && buffer.indexOf(wordDirMarker) === -1) {
        throw new Error('Invalid DOCX structure: Missing OpenXML markers');
      }
    } else {
      throw new Error('Only PDF and DOCX files are allowed');
    }

    // Hash calculation
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    return hash;
  }

  async readDocxContent(filePath) {
    try {
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value;
    } catch (err) {
      throw new Error('Failed to read DOCX content: ' + err.message);
    }
  }

  async extractTenderDataFromDocx(filePath) {
    const text = await this.readDocxContent(filePath);
    
    // Simple regex extractors (simulated logic for extraction)
    const titleMatch = text.match(/Title:\s*(.+)/i);
    const valueMatch = text.match(/Estimated Value:\s*(.+)/i);
    
    return {
      title: titleMatch ? titleMatch[1].trim() : null,
      extractedValue: valueMatch ? valueMatch[1].trim() : null,
      fullText: text
    };
  }

  async generateAwardLetterDocx(tender, officer, vc) {
    const amountInWords = numberToWords(parseInt(tender.estimated_value, 10)); // Assuming paise

    const doc = new docx.Document({
      sections: [{
        properties: {},
        children: [
          new docx.Paragraph({
            text: "GOVERNMENT OF INDIA",
            heading: docx.HeadingLevel.HEADING_1,
            alignment: docx.AlignmentType.CENTER,
          }),
          new docx.Paragraph({
            text: `Department: ${tender.department.replace(/_/g, ' ')}`,
            alignment: docx.AlignmentType.CENTER,
          }),
          new docx.Paragraph({ text: "" }), // spacing
          new docx.Paragraph({
            text: "LETTER OF AWARD",
            heading: docx.HeadingLevel.HEADING_2,
            alignment: docx.AlignmentType.CENTER,
          }),
          new docx.Paragraph({ text: "" }),
          new docx.Paragraph({
            text: `Date: ${new Date().toLocaleDateString('en-IN')}`,
          }),
          new docx.Paragraph({
            text: `Tender ID: ${tender.tender_id}`,
          }),
          new docx.Paragraph({ text: "" }),
          new docx.Paragraph({
            text: `To,`,
          }),
          new docx.Paragraph({
            text: `${tender.awarded_to_name}`,
          }),
          new docx.Paragraph({
            text: `GSTIN: ${tender.awarded_to_gstin}`,
          }),
          new docx.Paragraph({ text: "" }),
          new docx.Paragraph({
            text: `Subject: Award for "${tender.title}"`,
            heading: docx.HeadingLevel.HEADING_3,
          }),
          new docx.Paragraph({ text: "" }),
          new docx.Paragraph({
            text: `This is to notify you that your bid for the aforementioned tender has been accepted. The estimated value of the contract is ${tender.currency} ${tender.estimated_value / 100} (${amountInWords}).`,
          }),
          new docx.Paragraph({ text: "" }),
          new docx.Paragraph({
            text: `Digital Signature Verifiable Credential ID: ${vc ? vc.credential_id : 'PENDING'}`,
          }),
          new docx.Paragraph({ text: "" }),
          new docx.Paragraph({
            text: `Authorized Signatory:`,
          }),
          new docx.Paragraph({
            text: `${officer.name} (${officer.designation})`,
          })
        ],
      }],
    });

    return await docx.Packer.toBuffer(doc);
  }

  async convertDocxToPDF(docxBuffer) {
    const id = crypto.randomUUID();
    const inputPath = path.join(STORAGE_PATH, `temp_${id}.docx`);
    const outputDir = path.join(STORAGE_PATH, `out_${id}`);
    const profileDir = path.join(STORAGE_PATH, `profile_${id}`);
    
    try {
      await fs.writeFile(inputPath, docxBuffer);
      await fs.mkdir(outputDir, { recursive: true });
      await fs.mkdir(profileDir, { recursive: true });

      // Run LibreOffice with strict isolation to prevent concurrency crash
      // Fallback: Check if OS is windows and mock it if libreoffice isn't there, 
      // but we write the real command first as requested.
      // Use soffice or libreoffice. We will attempt a standard command.
      const libreOfficeCmd = process.platform === 'win32' ? 'soffice' : 'libreoffice';
      
      const cmd = `"${libreOfficeCmd}" --headless --invisible --nologo --nofirststartwizard --convert-to pdf --outdir "${outputDir}" -env:UserInstallation=file:///"${profileDir.replace(/\\/g, '/')}" "${inputPath}"`;
      
      try {
        await execPromise(cmd, { timeout: 30000 }); // 30s timeout
      } catch (execErr) {
        // If libreoffice doesn't exist (e.g. CI/CD or local dev without it), we mock the PDF generation for safety rather than crashing completely, IF IT'S ENOENT.
        // But for production, this should throw.
        throw new Error(`LibreOffice conversion failed: ${execErr.message}`);
      }

      const pdfFiles = await fs.readdir(outputDir);
      const pdfFile = pdfFiles.find(f => f.endsWith('.pdf'));
      
      if (!pdfFile) throw new Error('PDF output not found after conversion');
      
      const pdfBuffer = await fs.readFile(path.join(outputDir, pdfFile));
      return pdfBuffer;

    } finally {
      // Always cleanup temp files
      try { await fs.unlink(inputPath).catch(() => {}); } catch(e){}
      try { await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {}); } catch(e){}
      try { await fs.rm(profileDir, { recursive: true, force: true }).catch(() => {}); } catch(e){}
    }
  }

  async saveUploadedFile(fileBuffer, originalName, mimeType, tenderId, documentType, officialId, dbPool) {
    // 1. Validate
    const hash = this.validateFileBuffer(fileBuffer, originalName);
    
    // 2. Sanitize filename (prevent path traversal)
    const sanitizedName = path.basename(originalName).replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const uniqueName = `${crypto.randomUUID()}_${sanitizedName}`;
    const storedPath = path.join(STORAGE_PATH, uniqueName);

    // Ensure it's strictly inside STORAGE_PATH
    if (!storedPath.startsWith(path.resolve(STORAGE_PATH))) {
      throw new Error('Invalid file path');
    }

    // 3. Save to disk
    await fs.writeFile(storedPath, fileBuffer);

    // 4. Save to DB
    const res = await dbPool.query(`
      INSERT INTO tender_documents (
        tender_id, document_type, original_filename, stored_path, 
        file_size, mime_type, sha256_hash, uploaded_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [tenderId, documentType, originalName, storedPath, fileBuffer.length, mimeType, hash, officialId]);

    // 5. Audit Log
    await dbPool.query(`
      INSERT INTO audit_log (official_id, action, tender_id, new_value)
      VALUES ($1, $2, $3, $4)
    `, [officialId, 'DOCUMENT_UPLOADED', tenderId, res.rows[0]]);

    return res.rows[0];
  }

  async getDocumentForDownload(documentId, officialId, dbPool) {
    const res = await dbPool.query(`
      SELECT d.*, t.department 
      FROM tender_documents d
      JOIN tenders t ON d.tender_id = t.id
      WHERE d.id = $1
    `, [documentId]);

    const doc = res.rows[0];
    if (!doc) {
      throw new Error('Document not found');
    }

    // IDOR Protection Contextual Check is handled in the route layer generally, 
    // but returning the department/tender info here helps the route make the decision.
    
    try {
      await fs.access(doc.stored_path);
    } catch {
      throw new Error('File missing on disk');
    }

    return doc;
  }
}

export default new DocumentService();
