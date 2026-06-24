// IMPORTANT: Load polyfills FIRST before any PDF processing libraries
import '../utils/polyfills.js';

import { logger } from '../utils/logger.js';
import { AppError } from '../middleware/errorHandler.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import referenceService from './referenceService.js';

// PDF processing libraries (after polyfills are loaded)
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Node < 22 compatibility: pdfjs-dist (via pdf-parse) expects this API.
if (typeof process.getBuiltinModule !== 'function') {
  Object.defineProperty(process, 'getBuiltinModule', {
    value(moduleName) {
      try {
        return require(moduleName);
      } catch {
        return undefined;
      }
    },
    writable: true,
    configurable: true
  });
}

const pdf = require('pdf-parse');

const DEFAULT_CHUNK_SIZE = 500;
const DEFAULT_CHUNK_OVERLAP = 100;

export class PDFProcessingService {
  constructor() {
    this.supportedFormats = ['.pdf', '.PDF'];
    this.processedFiles = new Map();
    this.moduleDir = path.dirname(fileURLToPath(import.meta.url));
    this.backendRoot = path.resolve(this.moduleDir, '..', '..');
    this.projectRoot = path.resolve(this.backendRoot, '..');
    this.processingStats = {
      totalFiles: 0,
      processedFiles: 0,
      failedFiles: 0,
      totalPages: 0,
      totalTextLength: 0,
      ocrAttempts: 0,
      ocrSuccess: 0,
      ocrFailed: 0
    };
    this.ocrStatus = {
      tesseractCli: null,
      tesseractJs: null
    };
    this.pdfJsLib = null;
  }

  resetProcessingStats() {
    this.processingStats = {
      totalFiles: 0,
      processedFiles: 0,
      failedFiles: 0,
      totalPages: 0,
      totalTextLength: 0,
      ocrAttempts: 0,
      ocrSuccess: 0,
      ocrFailed: 0
    };
  }

  getSourceRoots() {
    const candidates = [process.cwd(), this.backendRoot, this.projectRoot];
    const uniqueRoots = [];
    const seen = new Set();

    for (const candidate of candidates) {
      const resolved = path.resolve(candidate);
      if (!seen.has(resolved)) {
        seen.add(resolved);
        uniqueRoots.push(resolved);
      }
    }

    return uniqueRoots;
  }

  buildSourceCandidates(relativePaths = []) {
    const sourceRoots = this.getSourceRoots();
    const normalized = Array.isArray(relativePaths) ? relativePaths : [];
    const candidates = [];

    for (const root of sourceRoots) {
      for (const relativePath of normalized) {
        const segments = (Array.isArray(relativePath) ? relativePath : [relativePath])
          .map(segment => String(segment || '').trim())
          .filter(Boolean);
        if (segments.length === 0) continue;
        candidates.push(path.resolve(path.join(root, ...segments)));
      }
    }

    return Array.from(new Set(candidates));
  }

  async findFirstExistingPath(candidates = [], expectedType = 'any') {
    for (const candidate of candidates) {
      try {
        const stats = await fs.stat(candidate);
        if (expectedType === 'directory' && !stats.isDirectory()) continue;
        if (expectedType === 'file' && !stats.isFile()) continue;
        return { path: candidate, stats };
      } catch {
        // Candidate does not exist, continue probing.
      }
    }

    return null;
  }

  buildSourceNotFoundResult(sourceLabel, candidates = []) {
    const checkedPreview = candidates.slice(0, 4).join('; ');
    const hasMore = candidates.length > 4 ? ` (+${candidates.length - 4} more)` : '';
    return {
      success: false,
      message: `${sourceLabel} source not found in expected paths${checkedPreview ? `: ${checkedPreview}${hasMore}` : ''}`,
      stats: this.processingStats
    };
  }

  async ensurePdfJs() {
    if (this.pdfJsLib) return this.pdfJsLib;
    const pdfjsModule = await import('pdfjs-dist/legacy/build/pdf.mjs');
    this.pdfJsLib = pdfjsModule.default || pdfjsModule;
    return this.pdfJsLib;
  }

  async checkTesseractCli() {
    if (this.ocrStatus.tesseractCli !== null) return this.ocrStatus.tesseractCli;
    const execFileAsync = promisify(execFile);
    try {
      await execFileAsync('tesseract', ['--version']);
      this.ocrStatus.tesseractCli = true;
    } catch {
      this.ocrStatus.tesseractCli = false;
    }
    return this.ocrStatus.tesseractCli;
  }

  async checkTesseractJs() {
    if (this.ocrStatus.tesseractJs !== null) return this.ocrStatus.tesseractJs;
    try {
      const module = await import('tesseract.js');
      const createWorker = module.createWorker || module.default?.createWorker;
      this.ocrStatus.tesseractJs = typeof createWorker === 'function';
    } catch {
      this.ocrStatus.tesseractJs = false;
    }
    return this.ocrStatus.tesseractJs;
  }

  async resolveOcrEngine(preferred = 'auto') {
    const preference = (preferred || 'auto').toString().toLowerCase();
    if (preference === 'tesseract') {
      return (await this.checkTesseractCli()) ? 'tesseract' : null;
    }
    if (preference === 'tesseractjs') {
      return (await this.checkTesseractJs()) ? 'tesseractjs' : null;
    }
    if (await this.checkTesseractCli()) return 'tesseract';
    if (await this.checkTesseractJs()) return 'tesseractjs';
    return null;
  }

  async performTesseractCli(buffer, options = {}) {
    const execFileAsync = promisify(execFile);
    const language = options.language || 'por+eng';
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sc-ocr-'));
    const inputPath = path.join(tmpDir, 'page.png');
    const outputBase = path.join(tmpDir, 'out');
    try {
      await fs.writeFile(inputPath, buffer);
      await execFileAsync('tesseract', [inputPath, outputBase, '-l', language, '--dpi', '300']);
      const text = await fs.readFile(`${outputBase}.txt`, 'utf8');
      return text;
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }

  async performTesseractJs(buffer, options = {}) {
    const language = options.language || 'por+eng';
    const module = await import('tesseract.js');
    const createWorker = module.createWorker || module.default?.createWorker;
    if (!createWorker) {
      throw new Error('tesseract.js createWorker unavailable');
    }
    const worker = await createWorker();
    try {
      await worker.loadLanguage(language);
      await worker.initialize(language);
      const result = await worker.recognize(buffer);
      return result?.data?.text || '';
    } finally {
      await worker.terminate();
    }
  }

  async renderPdfPageToImage(pdfDocument, pageNumber, scale = 2) {
    const canvasModule = await import('canvas');
    const createCanvas = canvasModule.createCanvas || canvasModule.default?.createCanvas;
    if (!createCanvas) {
      throw new Error('Canvas createCanvas unavailable');
    }
    const page = await pdfDocument.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(viewport.width, viewport.height);
    const context = canvas.getContext('2d');
    await page.render({ canvasContext: context, viewport }).promise;
    return canvas.toBuffer('image/png');
  }

  async extractTextWithOcr(filePath, options = {}) {
    const {
      maxPages = 3,
      scale = 2,
      language = 'por+eng',
      engine = 'auto'
    } = options;

    const resolvedEngine = await this.resolveOcrEngine(engine);
    if (!resolvedEngine) {
      return {
        text: '',
        pagesProcessed: 0,
        engine: null,
        warning: 'OCR engine unavailable'
      };
    }

    const pdfjsLib = await this.ensurePdfJs();
    const buffer = await fs.readFile(filePath);
    const data = new Uint8Array(buffer);
    const loadingTask = pdfjsLib.getDocument({ data, disableWorker: true });
    const pdfDocument = await loadingTask.promise;
    const totalPages = Math.min(pdfDocument.numPages, maxPages);

    let text = '';
    let processed = 0;

    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
      const imageBuffer = await this.renderPdfPageToImage(pdfDocument, pageNumber, scale);
      let pageText = '';
      if (resolvedEngine === 'tesseract') {
        pageText = await this.performTesseractCli(imageBuffer, { language });
      } else {
        pageText = await this.performTesseractJs(imageBuffer, { language });
      }
      if (pageText) {
        text += `\n\n[OCR Page ${pageNumber}]\n${pageText}`;
      }
      processed += 1;
    }

    return {
      text,
      pagesProcessed: processed,
      engine: resolvedEngine
    };
  }

  async parsePdfBuffer(pdfBuffer, options = {}) {
    const maxParsePages = Number.isFinite(options?.maxParsePages)
      ? Math.max(1, Math.floor(options.maxParsePages))
      : null;

    // pdf-parse v1 API: module is a callable function.
    if (typeof pdf === 'function') {
      const legacyResult = await pdf(pdfBuffer);
      return {
        ...legacyResult,
        parsedPages: Number(legacyResult?.numpages) || 0,
        pagesData: this.normalizeParsedPagesData(legacyResult?.pages)
      };
    }

    // pdf-parse v2 API: module exports { PDFParse }.
    const PDFParseClass = pdf?.PDFParse || pdf?.default?.PDFParse;
    if (typeof PDFParseClass === 'function') {
      const parser = new PDFParseClass({ data: pdfBuffer });
      try {
        const parseParams = {};
        if (maxParsePages) {
          parseParams.first = maxParsePages;
        }
        const textResult = await parser.getText(parseParams);
        return {
          text: textResult?.text || '',
          numpages: Number(textResult?.total) || (Array.isArray(textResult?.pages) ? textResult.pages.length : 0),
          parsedPages: Array.isArray(textResult?.pages) ? textResult.pages.length : 0,
          pagesData: this.normalizeParsedPagesData(textResult?.pages)
        };
      } finally {
        if (typeof parser.destroy === 'function') {
          await parser.destroy();
        }
      }
    }

    throw new Error('Unsupported pdf-parse module shape');
  }

  normalizeParsedPagesData(pages = []) {
    if (!Array.isArray(pages) || pages.length === 0) return [];

    const normalized = [];
    for (let index = 0; index < pages.length; index++) {
      const page = pages[index];
      let text = '';
      let pageNumber = index + 1;

      if (typeof page === 'string') {
        text = page;
      } else if (page && typeof page === 'object') {
        pageNumber = Number(page.pageNumber || page.page || page.number || pageNumber) || (index + 1);
        if (typeof page.text === 'string') {
          text = page.text;
        } else if (typeof page.content === 'string') {
          text = page.content;
        } else if (typeof page.str === 'string') {
          text = page.str;
        } else if (Array.isArray(page.text)) {
          text = page.text.join(' ');
        } else if (Array.isArray(page.content)) {
          text = page.content.join(' ');
        } else if (Array.isArray(page.items)) {
          text = page.items
            .map(item => item?.str || item?.text || item?.content || '')
            .filter(Boolean)
            .join(' ');
        }
      }

      const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
      if (!cleaned) continue;
      normalized.push({
        pageNumber,
        text: cleaned,
        wordCount: cleaned.split(/\s+/).filter(Boolean).length
      });
    }

    return normalized;
  }

  extractLabeledPagesData(text = '') {
    const source = String(text || '');
    if (!source.trim()) return [];

    const matches = [...source.matchAll(/\[OCR Page (\d+)\]([\s\S]*?)(?=\n\s*\[OCR Page \d+\]|$)/g)];
    if (matches.length > 0) {
      return matches
        .map(match => {
          const pageNumber = Number.parseInt(match[1], 10);
          const cleaned = String(match[2] || '').replace(/\s+/g, ' ').trim();
          if (!cleaned) return null;
          return {
            pageNumber: Number.isFinite(pageNumber) ? pageNumber : null,
            text: cleaned,
            wordCount: cleaned.split(/\s+/).filter(Boolean).length
          };
        })
        .filter(Boolean);
    }

    const formFeedPages = source
      .split(/\f+/)
      .map((pageText, index) => {
        const cleaned = String(pageText || '').replace(/\s+/g, ' ').trim();
        if (!cleaned) return null;
        return {
          pageNumber: index + 1,
          text: cleaned,
          wordCount: cleaned.split(/\s+/).filter(Boolean).length
        };
      })
      .filter(Boolean);

    return formFeedPages;
  }

  buildPagesData(pdfData = {}, fullText = '') {
    const parsedPages = this.normalizeParsedPagesData(pdfData?.pagesData);
    if (parsedPages.length > 0) return parsedPages;

    const labeledPages = this.extractLabeledPagesData(fullText);
    if (labeledPages.length > 0) return labeledPages;

    const cleaned = String(fullText || '').replace(/\s+/g, ' ').trim();
    return cleaned ? [{
      pageNumber: 1,
      text: cleaned,
      wordCount: cleaned.split(/\s+/).filter(Boolean).length
    }] : [];
  }

  /**
   * Process all PDF files in the Breast folder
   */
  async processBreastCancerPDFs(options = {}) {
    this.resetProcessingStats();
    const breastCandidates = this.buildSourceCandidates([
      ['Breast'],
      ['breast']
    ]);
    const resolvedBreastPath = await this.findFirstExistingPath(breastCandidates, 'directory');
    if (!resolvedBreastPath) {
      logger.warn('Breast source not found in expected paths');
      return this.buildSourceNotFoundResult('Breast', breastCandidates);
    }

    return this.processPDFsInDirectory(resolvedBreastPath.path, {
      ...options,
      sourceLabel: options.sourceLabel || 'Breast'
    });
  }

  /**
   * Process all PDF files in Curia 2026 Pre-course support materials
   */
  async processCuriaMaterialsPDFs(options = {}) {
    this.resetProcessingStats();
    const curiaCandidates = this.buildSourceCandidates([
      ['Curia 2026', 'Pré-curso', 'Material de Apoio'],
      ['Curia 2026', 'Pre-curso', 'Material de Apoio'],
      ['Curia 2026', 'Material de Apoio']
    ]);
    const resolvedCuriaPath = await this.findFirstExistingPath(curiaCandidates, 'directory');
    if (!resolvedCuriaPath) {
      logger.warn('Curia materials source not found in expected paths');
      return this.buildSourceNotFoundResult('Curia 2026 - Material de Apoio', curiaCandidates);
    }

    return this.processPDFsInDirectory(resolvedCuriaPath.path, {
      ...options,
      sourceLabel: options.sourceLabel || 'Curia 2026 - Material de Apoio'
    });
  }

  /**
   * Process ASCO SEP support material (single PDF or directory)
   */
  async processAscoSepPDFs(options = {}) {
    this.resetProcessingStats();
    const candidates = this.buildSourceCandidates([
      ['ASCO-SEP_Medical_Oncology_Self-Evaluation_Program.pdf'],
      ['ASCO SEP'],
      ['ASCO_SEP'],
      ['docs', 'ASCO-SEP_Medical_Oncology_Self-Evaluation_Program.pdf']
    ]);

    for (const candidate of candidates) {
      try {
        const stats = await fs.stat(candidate);
        if (stats.isDirectory()) {
          return this.processPDFsInDirectory(candidate, {
            ...options,
            sourceLabel: options.sourceLabel || 'ASCO SEP'
          });
        }
        if (stats.isFile()) {
          const includeMetadata = options.includeMetadata !== false;
          const chunkSize = Number(options.chunkSize) || DEFAULT_CHUNK_SIZE;
          const overlap = Number(options.overlap) || DEFAULT_CHUNK_OVERLAP;
          const enableOcr = Boolean(options.enableOcr);
          const ocrMaxPages = Number(options.ocrMaxPages) || 3;
          const ocrScale = Number(options.ocrScale) || 2;
          const ocrLanguage = options.ocrLanguage || 'por+eng';
          const ocrEngine = options.ocrEngine || 'auto';
          const maxParsePages = Number.isFinite(options.maxParsePages)
            ? Math.max(1, Math.floor(options.maxParsePages))
            : null;

          this.processingStats.totalFiles = 1;
          const result = await this.processPDFFile(candidate, {
            includeMetadata,
            chunkSize,
            overlap,
            enableOcr,
            ocrMaxPages,
            ocrScale,
            ocrLanguage,
            ocrEngine,
            maxParsePages
          });

          if (result?.success) {
            this.processingStats.processedFiles += 1;
            this.processingStats.totalPages += result.pages || 0;
            this.processingStats.totalTextLength += result.textLength || 0;
            return {
              success: true,
              results: [result],
              stats: this.processingStats,
              message: 'Successfully processed ASCO SEP source'
            };
          }

          this.processingStats.failedFiles += 1;
          return {
            success: false,
            results: [result],
            stats: this.processingStats,
            message: `Failed to process ASCO SEP source: ${result?.error || 'unknown error'}`
          };
        }
      } catch {
        // Candidate does not exist, continue probing.
      }
    }

    logger.warn('ASCO SEP source not found in expected paths');
    return this.buildSourceNotFoundResult('ASCO SEP', candidates);
  }

  /**
   * Process all PDF files in a directory
   */
  async processPDFsInDirectory(directoryPath, options = {}) {
    try {
      const { 
        maxFiles = null, 
        includeMetadata = true, 
        chunkSize = DEFAULT_CHUNK_SIZE,
        overlap = DEFAULT_CHUNK_OVERLAP,
        sourceLabel = '',
        enableOcr = false,
        ocrMaxPages = 3,
        ocrScale = 2,
        ocrLanguage = 'por+eng',
        ocrEngine = 'auto',
        maxParsePages = null
      } = options;

      logger.info(`Starting PDF processing${sourceLabel ? ` (${sourceLabel})` : ''}...`);
      
      const pdfFiles = await this.getPDFFiles(directoryPath);
      
      if (pdfFiles.length === 0) {
        logger.warn(`No PDF files found in ${directoryPath}`);
        return {
          success: false,
          message: `No PDF files found in ${directoryPath}`,
          stats: this.processingStats
        };
      }

      this.processingStats.totalFiles = maxFiles ? Math.min(pdfFiles.length, maxFiles) : pdfFiles.length;
      
      logger.info(`Found ${pdfFiles.length} PDF files, processing ${this.processingStats.totalFiles} files`);

      const results = [];
      const filesToProcess = maxFiles ? pdfFiles.slice(0, maxFiles) : pdfFiles;

      for (const filePath of filesToProcess) {
        try {
          logger.info(`Processing: ${path.basename(filePath)}`);
          
          const result = await this.processPDFFile(filePath, {
            includeMetadata,
            chunkSize,
            overlap,
            enableOcr,
            ocrMaxPages,
            ocrScale,
            ocrLanguage,
            ocrEngine,
            maxParsePages
          });

          if (result.success) {
            results.push(result);
            this.processingStats.processedFiles++;
            this.processingStats.totalPages += result.pages;
            this.processingStats.totalTextLength += result.textLength;
          } else {
            this.processingStats.failedFiles++;
            logger.warn(`Failed to process ${path.basename(filePath)}: ${result.error}`);
          }

        } catch (error) {
          this.processingStats.failedFiles++;
          logger.error(`Error processing ${path.basename(filePath)}: ${error.message}`);
        }
      }

      logger.info(`PDF processing completed. Processed: ${this.processingStats.processedFiles}, Failed: ${this.processingStats.failedFiles}`);

      return {
        success: true,
        results,
        stats: this.processingStats,
        message: `Successfully processed ${this.processingStats.processedFiles} out of ${this.processingStats.totalFiles} files`
      };

    } catch (error) {
      logger.error(`PDF processing failed: ${error.message}`);
      throw new AppError('PDF processing failed', 500);
    }
  }

  /**
   * Get all PDF files from a directory
   */
  async getPDFFiles(directoryPath) {
    try {
      const files = await fs.readdir(directoryPath);
      const pdfFiles = files
        .filter(file => this.supportedFormats.some(format => file.endsWith(format)))
        .map(file => path.join(directoryPath, file));

      return pdfFiles;
    } catch (error) {
      logger.error(`Failed to read directory ${directoryPath}: ${error.message}`);
      return [];
    }
  }

  /**
   * Process a single PDF file
   */
  async processPDFFile(filePath, options = {}) {
    try {
      const { 
        includeMetadata = true,
        chunkSize = DEFAULT_CHUNK_SIZE,
        overlap = DEFAULT_CHUNK_OVERLAP,
        enableOcr = false,
        ocrMaxPages = 3,
        ocrScale = 2,
        ocrLanguage = 'por+eng',
        ocrEngine = 'auto',
        maxParsePages = null
      } = options;
      
      // Read PDF file
      const pdfBuffer = await fs.readFile(filePath);
      const fileName = path.basename(filePath);
      const fileStats = await fs.stat(filePath);
      
      logger.info(`Processing PDF: ${fileName}`);

      // Extract text using pdf-parse (supports v1 and v2 APIs)
      const pdfData = await this.parsePdfBuffer(pdfBuffer, { maxParsePages });
      let fullText = pdfData?.text || '';
      const numPages = Number(pdfData?.numpages) || 0;
      const parsedPages = Number(pdfData?.parsedPages) || numPages;
      const ocrRecommended = fullText.length < 800;
      
      logger.info(`Extracted text from ${parsedPages} page(s)${numPages ? ` (document total: ${numPages})` : ''}`);
      if (Number.isFinite(maxParsePages) && numPages && parsedPages < numPages) {
        logger.warn(`PDF parsing capped at ${parsedPages}/${numPages} pages by maxParsePages=${maxParsePages}.`);
      }
      if (ocrRecommended) {
        logger.warn(`Low text extraction for ${fileName}. OCR recommended for slide-based PDFs.`);
      }

      let ocrUsed = false;
      let ocrPages = 0;
      let ocrEngineUsed = '';
      if (enableOcr && ocrRecommended) {
        this.processingStats.ocrAttempts += 1;
        try {
          const ocrResult = await this.extractTextWithOcr(filePath, {
            maxPages: ocrMaxPages,
            scale: ocrScale,
            language: ocrLanguage,
            engine: ocrEngine
          });
          if (ocrResult?.text) {
            if (ocrResult.text.length > fullText.length) {
              fullText = ocrResult.text;
            } else {
              fullText = `${fullText}\n\n${ocrResult.text}`;
            }
            ocrUsed = true;
            ocrPages = ocrResult.pagesProcessed || 0;
            ocrEngineUsed = ocrResult.engine || '';
            this.processingStats.ocrSuccess += 1;
          } else {
            this.processingStats.ocrFailed += 1;
          }
        } catch (error) {
          this.processingStats.ocrFailed += 1;
          logger.warn(`OCR failed for ${fileName}: ${error.message}`);
        }
      }

      // Create pages array (simplified since pdf-parse doesn't give page-by-page text)
      const pagesData = this.buildPagesData(pdfData, fullText);

      // Extract citation metadata from the PDF
      const citationMetadata = await this.extractCitationMetadata(fullText, fileName);
      
      // Create document metadata
      const metadata = includeMetadata ? {
        fileName,
        filePath,
        fileSize: fileStats.size,
        createdAt: fileStats.birthtime,
        modifiedAt: fileStats.mtime,
        totalPages: numPages,
        parsedPages,
        totalTextLength: fullText.length,
        wordCount: fullText.split(/\s+/).length,
        ocrRecommended,
        citation: citationMetadata,
        ocrUsed,
        ocrPages,
        ocrEngine: ocrEngineUsed
      } : {};

      // Chunk the text for better retrieval
      const chunks = pagesData.length > 1
        ? this.createTextChunksFromPages(pagesData, chunkSize, overlap)
        : this.createTextChunks(fullText, chunkSize, overlap);

      // Enhance chunks with citation metadata
      const enhancedChunks = chunks.map((chunk, index) => ({
        ...chunk,
        id: `${fileName}_chunk_${index}`,
        sourceFile: fileName,
        citation: citationMetadata,
        amaReference: referenceService.formatAMAReference(citationMetadata),
        inTextCitation: `^${index + 1}^`
      }));

      const result = {
        success: true,
        fileName,
        filePath,
        pages: parsedPages,
        documentPages: numPages,
        textLength: fullText.length,
        wordCount: fullText.split(/\s+/).length,
        ocrRecommended,
        ocrUsed,
        ocrPages,
        ocrEngine: ocrEngineUsed,
        chunkCount: enhancedChunks.length,
        metadata,
        pagesData,
        chunks: enhancedChunks,
        fullText: fullText.substring(0, 5000) + (fullText.length > 5000 ? '...' : '') // Preview only
      };

      // Store in memory for quick access
      this.processedFiles.set(fileName, result);

      return result;

    } catch (error) {
      logger.error(`Failed to process PDF ${filePath}: ${error.message}`);
      return {
        success: false,
        fileName: path.basename(filePath),
        error: error.message
      };
    }
  }

  /**
   * Create text chunks for better retrieval
   */
  createTextChunks(text, chunkSize = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_CHUNK_OVERLAP) {
    const chunks = [];
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const safeChunkSize = Math.max(1, Number(chunkSize) || DEFAULT_CHUNK_SIZE);
    const safeOverlap = Math.max(0, Math.min(Number(overlap) || 0, safeChunkSize - 1));
    const step = Math.max(1, safeChunkSize - safeOverlap);

    for (let start = 0; start < words.length; start += step) {
      const end = Math.min(start + safeChunkSize, words.length);
      const chunkWords = words.slice(start, end);
      const chunkText = chunkWords.join(' ');
      
      if (chunkText.trim()) {
        chunks.push({
          id: `chunk_${chunks.length}`,
          text: chunkText,
          startIndex: start,
          endIndex: end,
          wordCount: chunkWords.length,
          characterCount: chunkText.length
        });
      }

      if (end >= words.length) {
        break;
      }
    }
    
    return chunks;
  }

  createTextChunksFromPages(pagesData = [], chunkSize = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_CHUNK_OVERLAP) {
    const normalizedPages = Array.isArray(pagesData) ? pagesData : [];
    if (normalizedPages.length === 0) return [];

    const tokens = [];
    for (const page of normalizedPages) {
      const pageNumber = Number(page?.pageNumber) || null;
      const words = String(page?.text || '').split(/\s+/).filter(Boolean);
      for (const word of words) {
        tokens.push({ word, pageNumber });
      }
    }

    if (tokens.length === 0) return [];

    const safeChunkSize = Math.max(1, Number(chunkSize) || DEFAULT_CHUNK_SIZE);
    const safeOverlap = Math.max(0, Math.min(Number(overlap) || 0, safeChunkSize - 1));
    const step = Math.max(1, safeChunkSize - safeOverlap);
    const chunks = [];

    for (let start = 0; start < tokens.length; start += step) {
      const end = Math.min(start + safeChunkSize, tokens.length);
      const slice = tokens.slice(start, end);
      const chunkText = slice.map(item => item.word).join(' ');
      if (chunkText.trim()) {
        const pageNumbers = [...new Set(slice
          .map(item => item.pageNumber)
          .filter(value => Number.isFinite(value)))];
        const pageStart = pageNumbers.length > 0 ? Math.min(...pageNumbers) : null;
        const pageEnd = pageNumbers.length > 0 ? Math.max(...pageNumbers) : null;

        chunks.push({
          id: `chunk_${chunks.length}`,
          text: chunkText,
          startIndex: start,
          endIndex: end,
          wordCount: slice.length,
          characterCount: chunkText.length,
          pageStart,
          pageEnd
        });
      }

      if (end >= tokens.length) {
        break;
      }
    }

    return chunks;
  }

  /**
   * Search within processed PDFs
   */
  async searchInPDFs(query, options = {}) {
    try {
      const { 
        maxResults = 10, 
        includeContext = true,
        contextLength = 200 
      } = options;

      const results = [];
      
      for (const [fileName, fileData] of this.processedFiles) {
        if (!fileData.success) continue;

        const fileResults = this.searchInFile(fileData, query, {
          includeContext,
          contextLength
        });

        if (fileResults.length > 0) {
          results.push({
            fileName,
            filePath: fileData.filePath,
            matches: fileResults,
            totalMatches: fileResults.length
          });
        }
      }

      // Sort by relevance and limit results
      const sortedResults = results
        .sort((a, b) => b.totalMatches - a.totalMatches)
        .slice(0, maxResults);

      return {
        success: true,
        query,
        results: sortedResults,
        totalFiles: this.processedFiles.size,
        totalMatches: results.reduce((sum, r) => sum + r.totalMatches, 0)
      };

    } catch (error) {
      logger.error(`PDF search failed: ${error.message}`);
      throw new AppError('PDF search failed', 500);
    }
  }

  /**
   * Search within a single file
   */
  searchInFile(fileData, query, options = {}) {
    const { includeContext = true, contextLength = 200 } = options;
    const queryLower = query.toLowerCase();
    const matches = [];

    // Search in chunks
    for (const chunk of fileData.chunks) {
      const chunkTextLower = chunk.text.toLowerCase();
      const queryIndex = chunkTextLower.indexOf(queryLower);
      
      if (queryIndex !== -1) {
        let context = chunk.text;
        if (includeContext) {
          const start = Math.max(0, queryIndex - contextLength);
          const end = Math.min(chunk.text.length, queryIndex + query.length + contextLength);
          context = chunk.text.substring(start, end);
        }

        matches.push({
          chunkId: chunk.id,
          text: chunk.text,
          context,
          relevance: this.calculateRelevance(chunk.text, query),
          position: queryIndex
        });
      }
    }

    return matches.sort((a, b) => b.relevance - a.relevance);
  }

  /**
   * Calculate relevance score for a match
   */
  calculateRelevance(text, query) {
    const textLower = text.toLowerCase();
    const queryLower = query.toLowerCase();
    
    let score = 0;
    
    // Exact match bonus
    if (textLower.includes(queryLower)) {
      score += 1.0;
    }
    
    // Word frequency bonus
    const queryWords = queryLower.split(/\s+/);
    const textWords = textLower.split(/\s+/);
    
    for (const queryWord of queryWords) {
      const frequency = textWords.filter(word => word.includes(queryWord)).length;
      score += frequency * 0.1;
    }
    
    // Length penalty (shorter matches are more relevant)
    const lengthRatio = query.length / text.length;
    score += lengthRatio * 0.5;
    
    return Math.min(score, 1.0);
  }

  /**
   * Get processing statistics
   */
  getProcessingStats() {
    return {
      ...this.processingStats,
      processedFilesMap: this.processedFiles.size,
      averageTextLength: this.processingStats.totalTextLength / Math.max(this.processingStats.processedFiles, 1),
      averagePages: this.processingStats.totalPages / Math.max(this.processingStats.processedFiles, 1)
    };
  }

  /**
   * Get processed file by name
   */
  getProcessedFile(fileName) {
    return this.processedFiles.get(fileName);
  }

  /**
   * Clear processed files from memory
   */
  clearProcessedFiles() {
    this.processedFiles.clear();
    this.processingStats = {
      totalFiles: 0,
      processedFiles: 0,
      failedFiles: 0,
      totalPages: 0,
      totalTextLength: 0,
      ocrAttempts: 0,
      ocrSuccess: 0,
      ocrFailed: 0
    };
    this.ocrStatus = {
      tesseractCli: null,
      tesseractJs: null
    };
    logger.info('Cleared all processed files from memory');
  }

  /**
   * Get list of processed files
   */
  getProcessedFilesList() {
    return Array.from(this.processedFiles.keys());
  }

  /**
   * Extract citation metadata from PDF text
   */
  async extractCitationMetadata(text, fileName) {
    try {
      // Use the reference service to extract citation metadata
      const citation = await referenceService.extractCitationMetadata(text, fileName);
      
      // Add additional metadata specific to PDF processing
      citation.fileName = fileName;
      citation.extractedAt = new Date().toISOString();
      citation.textLength = text.length;
      
      return citation;
    } catch (error) {
      logger.error(`Citation metadata extraction failed for ${fileName}: ${error.message}`);
      return referenceService.createFallbackCitation(fileName);
    }
  }

  /**
   * Get enhanced search results with references
   */
  async searchWithReferences(query, options = {}) {
    try {
      const searchResults = await this.searchInPDFs(query, options);
      
      // Enhance results with reference information
      const enhancedResults = searchResults.results.map(fileResult => ({
        ...fileResult,
        references: fileResult.matches.map(match => ({
          ...match,
          amaReference: match.citation ? referenceService.formatAMAReference(match.citation) : null,
          inTextCitation: match.inTextCitation || '^?^'
        }))
      }));

      // Generate reference list
      const allCitations = new Map();
      enhancedResults.forEach(fileResult => {
        fileResult.references.forEach(ref => {
          if (ref.citation) {
            const citationKey = `${ref.citation.authors?.join(',')}_${ref.citation.title}_${ref.citation.year}`;
            if (!allCitations.has(citationKey)) {
              allCitations.set(citationKey, ref.citation);
            }
          }
        });
      });

      const referenceList = Array.from(allCitations.values()).map((citation, index) => ({
        number: index + 1,
        reference: referenceService.formatAMAReference(citation),
        citation: citation,
        inTextCitation: `^${index + 1}^`
      }));

      return {
        ...searchResults,
        results: enhancedResults,
        referenceList,
        totalReferences: referenceList.length
      };

    } catch (error) {
      logger.error(`Enhanced search with references failed: ${error.message}`);
      throw new AppError('Enhanced search failed', 500);
    }
  }
}

export default new PDFProcessingService();
