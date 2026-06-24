import express from 'express';

import trialRegistryService from '../services/trialRegistryService.js';

const router = express.Router();

const toBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const toList = (value) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

router.get('/search', async (req, res, next) => {
  try {
    const payload = await trialRegistryService.findMatches({
      q: req.query.q || '',
      question: req.query.question || req.query.q || '',
      population: req.query.population || '',
      biomarker: req.query.biomarker || '',
      lineOfTherapy: req.query.lineOfTherapy || '',
      intervention: req.query.intervention || '',
      comparator: req.query.comparator || '',
      outcomes: req.query.outcomes || '',
      phases: toList(req.query.phases),
      statuses: ['Recruiting'],
      regions: toList(req.query.regions),
      recruitingInPortugalOnly: toBoolean(req.query.recruitingInPortugalOnly, true),
      maxTrials: req.query.maxTrials,
      maxConditions: req.query.maxConditions
    });

    res.json({
      success: true,
      ...payload
    });
  } catch (error) {
    next(error);
  }
});

router.get('/status', async (req, res, next) => {
  try {
    const status = await trialRegistryService.getStatus();
    res.json({
      success: true,
      ...status
    });
  } catch (error) {
    next(error);
  }
});

router.post('/sync', async (req, res, next) => {
  try {
    const meta = await trialRegistryService.runSync({ reason: 'manual', force: true });
    res.json({
      success: true,
      meta
    });
  } catch (error) {
    next(error);
  }
});

router.get('/trials/:trialId', async (req, res, next) => {
  try {
    const result = await trialRegistryService.getTrialById(req.params.trialId);

    if (result.available && !result.trial) {
      res.status(404).json({
        success: false,
        error: 'Trial not found'
      });
      return;
    }

    res.json({
      success: result.available,
      ...result
    });
  } catch (error) {
    next(error);
  }
});

export default router;
