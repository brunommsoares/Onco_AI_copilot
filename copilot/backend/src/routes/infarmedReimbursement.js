import express from 'express';

import infarmedReimbursementService from '../services/infarmedReimbursementService.js';

const router = express.Router();

// ---------------------------------------------------------------------------
// GET /api/infarmed-reimbursement/search
//
// Query reimbursement data by substance, cancer type, biomarker, line.
// Used both by the frontend and internally by simpleChat.
// ---------------------------------------------------------------------------
router.get('/search', async (req, res, next) => {
  try {
    const payload = await infarmedReimbursementService.findReimbursementData({
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
// GET /api/infarmed-reimbursement/status
//
// Service health, sync status, drug/indication counts.
// ---------------------------------------------------------------------------
router.get('/status', async (req, res, next) => {
  try {
    const status = await infarmedReimbursementService.getStatus();
    res.json({
      success: true,
      ...status
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /api/infarmed-reimbursement/sync
//
// Manual sync trigger. Re-scrapes all INFARMED sources and re-runs LLM
// indication extraction.
// ---------------------------------------------------------------------------
router.post('/sync', async (req, res, next) => {
  try {
    const meta = await infarmedReimbursementService.runSync({
      reason: 'manual',
      force: true
    });
    res.json({
      success: true,
      meta
    });
  } catch (error) {
    next(error);
  }
});

export default router;
