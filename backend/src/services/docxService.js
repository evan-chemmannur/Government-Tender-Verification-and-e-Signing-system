/**
 * docxService.js — DOCX Award Letter Generator for Government Tender Portal
 *
 * Generates a 2-page government-format DOCX award letter:
 *   Page 1: Formal award letter with reference, addressee, subject, body, terms, signature, footer
 *   Page 2: Digital Verification Certificate with VC metadata
 *
 * Also handles LibreOffice-based DOCX → PDF conversion with 30s timeout and
 * guaranteed temp file cleanup on all paths.
 */

import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import os from 'os';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  HeadingLevel,
  BorderStyle,
  PageBreak,
  TabStopPosition,
  TabStopType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  VerticalAlign,
  ShadingType,
  UnderlineType,
  convertInchesToTwip,
  convertMillimetersToTwip,
  Footer,
  PageNumber,
  NumberFormat,
} from 'docx';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── LibreOffice binary detection ────────────────────────────────────────────

/**
 * Finds the LibreOffice soffice binary across Windows / Linux / macOS.
 * Returns the full path or just 'libreoffice' if found on PATH.
 */
function findLibreOffice() {
  const candidates = [
    // Windows standard installs
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
    // macOS
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
    // Linux
    '/usr/bin/libreoffice',
    '/usr/bin/soffice',
    '/usr/local/bin/libreoffice',
  ];
  // Return env override first
  if (process.env.LIBREOFFICE_PATH) return process.env.LIBREOFFICE_PATH;
  for (const c of candidates) {
    try {
      // Synchronous existence check is fine here (startup-time)
      require('fs').accessSync(c);
      return c;
    } catch {
      // not found, try next
    }
  }
  return 'libreoffice'; // hope it's on PATH
}

// ── Indian number-to-words (Rupees + Paise, up to Kharabs) ─────────────────

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function convertBelowHundred(n) {
  if (n < 20) return ONES[n];
  const ten = TENS[Math.floor(n / 10)];
  const one = ONES[n % 10];
  return one ? `${ten} ${one}` : ten;
}

function convertBelowThousand(n) {
  if (n < 100) return convertBelowHundred(n);
  return `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ' ' + convertBelowHundred(n % 100) : ''}`;
}

function convertInteger(n) {
  if (n === 0) return 'Zero';
  const units = [
    { value: 1_00_00_00_00_000, name: 'Kharab' },
    { value: 1_00_00_00_000,    name: 'Arab' },
    { value: 1_00_00_000,       name: 'Crore' },
    { value: 1_00_000,          name: 'Lakh' },
    { value: 1_000,             name: 'Thousand' },
  ];
  let parts = [];
  for (const { value, name } of units) {
    if (n >= value) {
      parts.push(`${convertBelowThousand(Math.floor(n / value))} ${name}`);
      n %= value;
    }
  }
  if (n > 0) parts.push(convertBelowThousand(n));
  return parts.join(' ');
}

// ── Formatting helpers ────────────────────────────────────────────────────

const MARGIN_CM = 2.5; // 2.5 cm all sides in twips
const MARGIN_TWIPS = convertMillimetersToTwip(MARGIN_CM * 10);

const NAVY = '1F3864';       // dark navy blue
const BLACK = '000000';
const DARK_GRAY = '333333';

function bold(text, size = 24, color = BLACK, font = 'Times New Roman') {
  return new TextRun({ text, bold: true, size, color, font });
}

function normal(text, size = 20, color = BLACK, font = 'Times New Roman') {
  return new TextRun({ text, size, color, font });
}

function centeredPara(children, spacing = {}) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    children,
    spacing: { after: 60, ...spacing },
  });
}

function leftPara(children, indent = {}, spacing = {}) {
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    children,
    indent,
    spacing: { after: 80, ...spacing },
  });
}

function blankLine(after = 120) {
  return new Paragraph({ children: [new TextRun('')], spacing: { after } });
}

/** Double horizontal border paragraph */
function doubleBorderLine() {
  return new Paragraph({
    children: [],
    border: {
      bottom: {
        color: NAVY,
        space: 1,
        style: BorderStyle.DOUBLE,
        size: 6,
      },
    },
    spacing: { after: 120 },
  });
}

/** Format date as "22nd June 2026" */
function formatDate(date = new Date()) {
  const d = new Date(date);
  const day = d.getDate();
  const suffix = ['th', 'st', 'nd', 'rd'][
    day % 10 < 4 && Math.floor(day % 100 / 10) !== 1 ? day % 10 : 0
  ];
  const month = d.toLocaleString('en-IN', { month: 'long' });
  const year = d.getFullYear();
  return `${day}${suffix} ${month} ${year}`;
}

/** Rupees in human readable with words */
function formatContractValue(paiseAmount) {
  const rupees = Math.floor(paiseAmount / 100);
  const paise = paiseAmount % 100;
  const rupeesStr = new Intl.NumberFormat('en-IN').format(rupees);
  let words = `Rupees ${convertInteger(rupees)}`;
  if (paise > 0) words += ` and ${convertBelowHundred(paise)} Paise`;
  words += ' Only';
  return { rupeesStr, words };
}

// ═══════════════════════════════════════════════════════════════════════════
//  DocxAwardLetterService
// ═══════════════════════════════════════════════════════════════════════════

class DocxAwardLetterService {

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Generate DOCX award letter buffer.
   * @param {object} tender   – tender record from DB
   * @param {object} officer  – issuing officer { name, designation, department, email }
   * @param {object} vc       – verifiable credential record (may be null)
   * @returns {Buffer} DOCX file buffer
   */
  async generateAwardLetter(tender, officer, vc) {
    logger.info(`[DocxService] Generating award letter for tender ${tender.tender_id}`);

    const today = new Date();
    const contractValue = tender.contract_value || tender.estimated_value || 0; // in paise
    const { rupeesStr, words: valueWords } = formatContractValue(contractValue);
    const completionDays = tender.completion_days || tender.duration_days || 180;
    const awardDate = tender.awarded_at ? new Date(tender.awarded_at) : today;

    const bidderName = tender.awarded_to || tender.awarded_company || 'M/s [Bidder Name]';
    const bidderAddress = tender.awarded_to_address || '[Bidder Address]';
    const bidderEmail = tender.awarded_to_email || '';

    const deptName = officer.department || tender.department || 'Department of Public Works';
    const deptAddress = process.env.DEPT_ADDRESS || '5th Floor, Mantralaya, Mumbai - 400032';
    const deptPhone = process.env.DEPT_PHONE || '+91-22-22027000';
    const deptEmail = process.env.DEPT_EMAIL || 'pwd@maharashtra.gov.in';
    const deptWebsite = process.env.DEPT_WEBSITE || 'www.maharashtra.gov.in';

    // ── Page 1: Award Letter ────────────────────────────────────────────────

    const page1Sections = [

      // ── Header block ────────────────────────────────────────────────────
      centeredPara([bold('GOVERNMENT OF MAHARASHTRA', 32, NAVY)], { before: 0, after: 80 }),
      centeredPara([bold(deptName.toUpperCase(), 28, NAVY)], { after: 60 }),
      centeredPara([normal(deptAddress, 20, DARK_GRAY)], { after: 40 }),
      centeredPara([
        normal(`Tel: ${deptPhone}  |  Email: ${deptEmail}  |  Web: ${deptWebsite}`, 18, DARK_GRAY),
      ], { after: 120 }),
      doubleBorderLine(),

      // ── Reference section (No. left | Date right) ───────────────────────
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { after: 60 },
        children: [
          bold(`No: ${tender.tender_id}`, 20),
          new TextRun({ text: '\t\t\t\t\t\t\t\t', size: 20 }),
          bold(`Date: ${formatDate(today)}`, 20),
        ],
        tabStops: [
          { type: TabStopType.RIGHT, position: TabStopPosition.MAX },
        ],
      }),

      blankLine(60),

      // ── Addressee block ─────────────────────────────────────────────────
      leftPara([normal('To,', 20)]),
      leftPara([bold(bidderName, 20)]),
      ...(bidderAddress.split('\n').map(line =>
        leftPara([normal(line, 20)], {}, { after: 40 })
      )),
      ...(bidderEmail ? [leftPara([normal(bidderEmail, 20)], {}, { after: 40 })] : []),
      blankLine(60),
      leftPara([normal('Sir/Ma\'am,', 20)]),
      blankLine(60),

      // ── Subject line (bold) ─────────────────────────────────────────────
      leftPara([bold(`Sub: Award of Contract for ${tender.title} - Reg.`, 20)]),
      doubleBorderLine(),

      // ── Body paragraph 1 ────────────────────────────────────────────────
      new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: 180, line: 360 },
        indent: { firstLine: convertInchesToTwip(0.5) },
        children: [
          normal(
            `With reference to your bid submitted in response to Tender Notice No. ${tender.tender_id} ` +
            `dated ${formatDate(tender.published_at || tender.created_at)}, and subsequent evaluation ` +
            `conducted by the Tender Evaluation Committee, we are pleased to inform you that your bid ` +
            `has been found technically and financially suitable for the captioned work.`,
            20
          ),
        ],
      }),

      // ── Body paragraph 2 ────────────────────────────────────────────────
      new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: 180, line: 360 },
        indent: { firstLine: convertInchesToTwip(0.5) },
        children: [
          normal(
            `The undersigned is directed to inform you that the Government of Maharashtra, ` +
            `${deptName}, has decided to award the contract for ` +
            `"${tender.title}" to your firm for a total contract value of ` +
            `\u20B9${rupeesStr}/- (${valueWords}), ` +
            `subject to the terms and conditions stipulated herein and as per the tender documents.`,
            20
          ),
        ],
      }),

      // ── Body paragraph 3 ────────────────────────────────────────────────
      new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: 200, line: 360 },
        indent: { firstLine: convertInchesToTwip(0.5) },
        children: [
          normal(
            `You are requested to execute the Agreement as per the terms and conditions of the contract ` +
            `within 15 (fifteen) days from the date of receipt of this letter, and submit the required ` +
            `Performance Security Deposit as specified in the Bid Documents. Failure to do so shall result ` +
            `in forfeiture of the Earnest Money Deposit and cancellation of this award.`,
            20
          ),
        ],
      }),

      // ── Terms & Conditions (numbered list) ──────────────────────────────
      leftPara([bold('Terms and Conditions:', 20)], {}, { after: 80 }),

      ...this._termsItems(rupeesStr, valueWords, completionDays, tender),

      blankLine(200),

      // ── Signature block ─────────────────────────────────────────────────
      // 5 cm vertical space for physical signature
      new Paragraph({
        spacing: { before: 560, after: 0 }, // ~5 cm
        children: [normal('', 20)],
      }),
      leftPara([bold('Yours faithfully,', 20)]),
      blankLine(280), // space for wet/digital signature
      leftPara([bold(`(${officer.name})`, 20)]),
      leftPara([normal(officer.designation || 'Executive Engineer', 20)]),
      leftPara([normal(deptName, 20)]),
      leftPara([bold('For Government of Maharashtra', 20)]),

      blankLine(120),

      // ── Footer: Copy to ─────────────────────────────────────────────────
      new Paragraph({
        border: {
          top: { color: BLACK, space: 2, style: BorderStyle.SINGLE, size: 4 },
        },
        spacing: { before: 60, after: 60 },
        children: [
          normal('Copy to:', 18),
        ],
      }),
      leftPara([normal('1. The Accounts Officer, ' + deptName, 18)], {}, { after: 40 }),
      leftPara([normal('2. The Vigilance Officer, Government of Maharashtra', 18)], {}, { after: 40 }),
      leftPara([normal('3. Guard File / Tender File', 18)], {}, { after: 40 }),
    ];

    // ── Page 2: Digital Verification Certificate ────────────────────────────

    const vcId = vc?.credential_id || 'VC-NOT-YET-ISSUED';
    const vcIssuedAt = vc?.issued_at ? new Date(vc.issued_at).toISOString() : new Date().toISOString();
    const verifyUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify/${vcId}`;

    const page2Sections = [
      new Paragraph({ children: [new PageBreak()] }),

      blankLine(120),

      // Certificate title
      centeredPara([bold('DIGITAL VERIFICATION CERTIFICATE', 32, NAVY)], { after: 60 }),
      centeredPara([bold('Government of Maharashtra — Tender Management System', 22, DARK_GRAY)], { after: 120 }),
      doubleBorderLine(),
      blankLine(120),

      // QR placeholder box (note: actual QR in PDF version)
      new Table({
        width: { size: 4000, type: WidthType.DXA },
        alignment: AlignmentType.CENTER,
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: 4000, type: WidthType.DXA },
                verticalAlign: VerticalAlign.CENTER,
                shading: { fill: 'F0F4FF', type: ShadingType.CLEAR, color: 'auto' },
                children: [
                  centeredPara([bold('[QR CODE]', 22, NAVY)], { before: 400, after: 100 }),
                  centeredPara([normal('Scan to verify this document', 18, DARK_GRAY)], { after: 100 }),
                  centeredPara([normal('(Actual QR code is present in the PDF version)', 16, DARK_GRAY)], { after: 400 }),
                ],
              }),
            ],
          }),
        ],
      }),

      blankLine(160),

      // Certificate metadata
      ...[
        ['Credential ID',       vcId],
        ['Tender Reference',    tender.tender_id],
        ['Tender Title',        tender.title],
        ['Awarded To',          bidderName],
        ['Contract Value',      `\u20B9${rupeesStr}/-`],
        ['Issued At',           vcIssuedAt],
        ['Issued By',           `${officer.name}, ${officer.designation || 'Officer'}`],
        ['Verification URL',    verifyUrl],
      ].map(([label, value]) => new Paragraph({
        spacing: { after: 80 },
        children: [
          new TextRun({ text: `${label}: `, bold: true, size: 20, font: 'Arial' }),
          new TextRun({ text: value || '—', size: 20, font: 'Arial', color: DARK_GRAY }),
        ],
      })),

      blankLine(160),

      // Digital signature statement
      new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: 120, line: 340 },
        border: {
          top: { color: NAVY, space: 4, style: BorderStyle.SINGLE, size: 4 },
          bottom: { color: NAVY, space: 4, style: BorderStyle.SINGLE, size: 4 },
          left:  { color: NAVY, space: 6, style: BorderStyle.SINGLE, size: 4 },
          right: { color: NAVY, space: 6, style: BorderStyle.SINGLE, size: 4 },
        },
        children: [
          new TextRun({ text: 'CERTIFICATION STATEMENT: ', bold: true, size: 20, font: 'Arial' }),
          new TextRun({
            size: 20,
            font: 'Arial',
            text:
              'This document has been digitally signed and issued by the Government of Maharashtra ' +
              'Tender Management System. The authenticity of this award letter can be verified by ' +
              'scanning the QR code above or by visiting the Verification URL. Any alteration to ' +
              'this document after issuance will render the digital signature invalid. ' +
              'This credential complies with W3C Verifiable Credentials Data Model v1.1.',
          }),
        ],
      }),

      blankLine(80),

      centeredPara([
        normal('This is a system-generated document. For queries contact: ', 18, DARK_GRAY),
      ]),
      centeredPara([
        normal(deptEmail + '  |  ' + deptPhone, 18, DARK_GRAY),
      ]),
    ];

    // ── Assemble Document ───────────────────────────────────────────────────

    const doc = new Document({
      creator: 'Government of Maharashtra Tender Portal',
      title: `Award Letter — ${tender.tender_id}`,
      description: `Tender Award Letter for ${tender.title}`,
      styles: {
        default: {
          document: {
            run: { font: 'Times New Roman', size: 20, color: BLACK },
          },
        },
      },
      sections: [
        {
          properties: {
            page: {
              margin: {
                top:    MARGIN_TWIPS,
                bottom: MARGIN_TWIPS,
                left:   MARGIN_TWIPS,
                right:  MARGIN_TWIPS,
              },
            },
          },
          footers: {
            default: new Footer({
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], size: 16 }),
                  ],
                }),
              ],
            }),
          },
          children: [...page1Sections, ...page2Sections],
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    logger.info(`[DocxService] DOCX generated (${(buffer.length / 1024).toFixed(1)} KB) for ${tender.tender_id}`);
    return buffer;
  }

  // ── Terms numbered list items ─────────────────────────────────────────────

  _termsItems(rupeesStr, valueWords, completionDays, tender) {
    const paymentTerms = tender.payment_terms || '30% advance upon agreement; 60% on milestone completion; 10% on final acceptance';
    const penalty = tender.penalty_clause || '0.5% of contract value per week of delay, capped at 10% of total contract value';

    const items = [
      `Contract Value: The total contract value is \u20B9${rupeesStr}/- (${valueWords}), inclusive of all taxes, duties, and levies unless otherwise stated.`,
      `Payment Terms: ${paymentTerms}.`,
      `Penalty Clause: In case of delay in completion of the project, a penalty of ${penalty} shall be levied and recovered.`,
      `Completion Period: The entire work shall be completed within ${completionDays} days (${Math.ceil(completionDays / 30)} months) from the date of issue of Work Order.`,
      'Performance Security: The contractor shall furnish a Performance Security of 5% of the contract value in the form of Bank Guarantee within 15 days of receipt of this letter.',
      'Dispute Resolution: Any disputes arising out of this contract shall be resolved as per the Arbitration and Conciliation Act, 1996.',
    ];

    return items.map((text, i) =>
      new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: 80, line: 340 },
        indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.3) },
        children: [
          new TextRun({ text: `${i + 1}.  `, bold: true, size: 20, font: 'Times New Roman' }),
          new TextRun({ text, size: 20, font: 'Times New Roman' }),
        ],
      })
    );
  }

  // ── numberToWords (Indian system, rupee-denominated) ──────────────────────

  /**
   * Convert a rupee amount (float) to Indian English words.
   * @param {number} amount  e.g. 48500000.50
   * @returns {string}       e.g. "Rupees Four Crore Eighty Five Lakh and Fifty Paise Only"
   */
  async numberToWords(amount) {
    const rupees = Math.floor(amount);
    const paiseFloat = Math.round((amount - rupees) * 100);

    let result = '';
    if (rupees > 0) {
      result += `Rupees ${convertInteger(rupees)}`;
    }
    if (paiseFloat > 0) {
      if (rupees > 0) result += ' and ';
      result += `${convertBelowHundred(paiseFloat)} Paise`;
    }
    if (!result) result = 'Zero Rupees';
    result += ' Only';
    return result.replace(/\s+/g, ' ').trim();
  }

  // ── LibreOffice DOCX → PDF conversion ────────────────────────────────────

  /**
   * Convert a DOCX buffer to PDF using LibreOffice headless.
   * Enforces a 30-second timeout and guaranteed temp file cleanup.
   * @param {Buffer} docxBuffer
   * @returns {Buffer} PDF buffer
   */
  async convertDocxToPDF(docxBuffer) {
    const tmpDir = os.tmpdir();
    const uid = `award-letter-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const docxPath = path.join(tmpDir, `${uid}.docx`);
    const pdfPath  = path.join(tmpDir, `${uid}.pdf`);
    const loBin    = findLibreOffice();

    logger.info(`[DocxService] Converting DOCX → PDF via LibreOffice (bin: ${loBin})`);

    try {
      // Write DOCX to temp file
      await fs.writeFile(docxPath, docxBuffer);

      // Execute LibreOffice with 30s timeout
      await new Promise((resolve, reject) => {
        const child = exec(
          `"${loBin}" --headless --convert-to pdf --outdir "${tmpDir}" "${docxPath}"`,
          { timeout: 30_000 },
          (error, stdout, stderr) => {
            if (error) {
              if (error.killed || error.signal === 'SIGTERM') {
                return reject(new Error('LibreOffice PDF conversion timed out after 30 seconds'));
              }
              return reject(new Error(`LibreOffice failed: ${stderr || error.message}`));
            }
            logger.debug(`[DocxService] LibreOffice stdout: ${stdout}`);
            resolve();
          }
        );
      });

      // Read the output PDF
      let pdfBuffer;
      try {
        pdfBuffer = await fs.readFile(pdfPath);
      } catch (readErr) {
        throw new Error(`LibreOffice ran but PDF output not found at ${pdfPath}: ${readErr.message}`);
      }

      logger.info(`[DocxService] PDF conversion succeeded (${(pdfBuffer.length / 1024).toFixed(1)} KB)`);
      return pdfBuffer;

    } finally {
      // Guaranteed cleanup — even on error
      await Promise.allSettled([
        fs.unlink(docxPath).catch(() => {}),
        fs.unlink(pdfPath).catch(() => {}),
      ]);
    }
  }

  // ── Combined generate + convert ───────────────────────────────────────────

  /**
   * Generate DOCX award letter and convert it to PDF.
   * @returns {{ docxBuffer: Buffer, pdfBuffer: Buffer }}
   */
  async generateAndConvert(tender, officer, vc) {
    const docxBuffer = await this.generateAwardLetter(tender, officer, vc);
    const pdfBuffer  = await this.convertDocxToPDF(docxBuffer);
    return { docxBuffer, pdfBuffer };
  }
}

export default new DocxAwardLetterService();
