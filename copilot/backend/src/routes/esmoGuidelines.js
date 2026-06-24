import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

import esmoGuidelinesService from '../services/esmoGuidelinesService.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configure multer for PDF uploads
const uploadDir = process.env.ESMO_UPLOAD_DIR || path.resolve(__dirname, '..', '..', 'data', 'esmo_pdfs');
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedMimes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.ms-powerpoint'];
    const allowedExts = ['.pdf', '.pptx', '.ppt'];
    if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF and PPTX files are accepted'), false);
    }
  }
});

// ---------------------------------------------------------------------------
// POST /api/esmo-guidelines/upload
//
// Upload an ESMO guideline PDF for processing. Extracts structured
// recommendations via LLM and stores them for query.
// ---------------------------------------------------------------------------
router.post('/upload', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No PDF file uploaded' });
    }

    // Rename the uploaded file to keep the original name
    const originalName = req.file.originalname || 'guideline.pdf';
    const newPath = path.join(uploadDir, `${Date.now()}-${originalName}`);
    await fs.rename(req.file.path, newPath);

    const metadata = {
      title: req.body.title || originalName.replace('.pdf', ''),
      cancerType: req.body.cancerType || req.body.cancer_type || '',
      version: req.body.version || ''
    };

    const result = await esmoGuidelinesService.processGuidelinePdf(newPath, metadata);

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    // Clean up uploaded file on error
    if (req.file?.path) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /api/esmo-guidelines/search
//
// Query structured ESMO recommendations by cancer type, drug, biomarker.
// ---------------------------------------------------------------------------
router.get('/search', async (req, res, next) => {
  try {
    const payload = await esmoGuidelinesService.findRecommendations({
      question: req.query.q || req.query.question || '',
      substance: req.query.substance || req.query.drug || '',
      cancerType: req.query.cancerType || req.query.cancer || '',
      biomarker: req.query.biomarker || '',
      lineOfTherapy: req.query.lineOfTherapy || req.query.line || '',
      population: req.query.population || '',
      intervention: req.query.intervention || ''
    });

    res.json({
      success: true,
      ...payload
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /api/esmo-guidelines/status
//
// Service status, uploaded guidelines, recommendation counts.
// ---------------------------------------------------------------------------
router.get('/status', async (req, res, next) => {
  try {
    const status = await esmoGuidelinesService.getStatus();
    res.json({
      success: true,
      ...status
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/esmo-guidelines/:id
//
// Remove a guideline and its recommendations.
// ---------------------------------------------------------------------------
router.delete('/:id', async (req, res, next) => {
  try {
    await esmoGuidelinesService.deleteGuideline(req.params.id);
    res.json({
      success: true,
      message: `Guideline ${req.params.id} deleted`
    });
  } catch (error) {
    next(error);
  }
});

export default router;
