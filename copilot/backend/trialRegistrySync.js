import fetch from 'node-fetch';
import crypto from 'crypto';

const DEFAULT_BASE_URL = 'https://clinicaltrials.gov/api/v2/studies';
const DEFAULT_STATUSES = [
  'RECRUITING',
  'AVAILABLE',
  'ACTIVE_NOT_RECRUITING',
  'NOT_YET_RECRUITING',
  'ENROLLING_BY_INVITATION'
];
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 20;

// ClinicalTrials.gov condition query — AREA[Condition] with oncology terms
const DEFAULT_CONDITION_QUERY = [
  'cancer', 'carcinoma', 'lymphoma', 'leukemia', 'leukaemia',
  'melanoma', 'sarcoma', 'myeloma', 'glioblastoma', 'glioma',
  'neuroblastoma', 'mesothelioma', 'neoplasm', 'tumor', 'tumour',
  'oncology', 'blastoma', 'adenocarcinoma', 'hepatocellular',
  'cholangiocarcinoma', 'thymoma', 'retinoblastoma',
  'myelodysplastic', 'myeloproliferative', 'mastocytosis',
  'hodgkin', 'non-hodgkin', 'waldenstrom', 'polycythemia vera',
  'essential thrombocythemia', 'myelofibrosis'
].join(' OR ');

const normalizeStatusKey = (value) =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const normalizeList = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (value === undefined || value === null) return [];
  const str = String(value).trim();
  return str ? [str] : [];
};

const slugify = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const hashedKey = (raw) => crypto.createHash('sha1').update(raw).digest('hex').slice(0, 10);

const buildKey = (raw, prefix) => {
  const base = slugify(raw);
  if (!base) return `${prefix}-${hashedKey(raw)}`;
  let key = prefix ? `${prefix}-${base}` : base;
  if (key.length > 120) {
    key = `${key.slice(0, 100)}-${hashedKey(raw)}`;
  }
  return key;
};

const buildSiteKey = (facility, city, country) =>
  buildKey(`${facility || ''}|${city || ''}|${country || ''}`, 'site');

const buildConditionKey = (condition) => buildKey(condition || 'unspecified', 'cond');

const buildTrialUrl = (nctId) => {
  if (!nctId) return null;
  return `https://clinicaltrials.gov/study/${nctId}`;
};

const normalizeText = (value = '') =>
  String(value || '')
    .replace(/\r/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const truncate = (value = '', max = 240) => {
  const text = normalizeText(value);
  if (!text || text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
};

const dedupe = (items = []) => [...new Set(items.filter(Boolean))];

const REGION_MAP = new Map([
  ['portugal', 'Europe'],
  ['spain', 'Europe'],
  ['france', 'Europe'],
  ['germany', 'Europe'],
  ['italy', 'Europe'],
  ['united kingdom', 'Europe'],
  ['ireland', 'Europe'],
  ['belgium', 'Europe'],
  ['netherlands', 'Europe'],
  ['switzerland', 'Europe'],
  ['austria', 'Europe'],
  ['sweden', 'Europe'],
  ['norway', 'Europe'],
  ['denmark', 'Europe'],
  ['poland', 'Europe'],
  ['czech republic', 'Europe'],
  ['united states', 'North America'],
  ['canada', 'North America'],
  ['mexico', 'North America'],
  ['brazil', 'Latin America'],
  ['argentina', 'Latin America'],
  ['chile', 'Latin America'],
  ['colombia', 'Latin America'],
  ['peru', 'Latin America'],
  ['china', 'Asia-Pacific'],
  ['japan', 'Asia-Pacific'],
  ['south korea', 'Asia-Pacific'],
  ['australia', 'Asia-Pacific'],
  ['new zealand', 'Asia-Pacific'],
  ['india', 'Asia-Pacific'],
  ['singapore', 'Asia-Pacific'],
  ['taiwan', 'Asia-Pacific'],
  ['hong kong', 'Asia-Pacific'],
  ['israel', 'Middle East/Africa'],
  ['saudi arabia', 'Middle East/Africa'],
  ['united arab emirates', 'Middle East/Africa'],
  ['south africa', 'Middle East/Africa'],
  ['egypt', 'Middle East/Africa']
]);

const buildRegionTags = (countries = []) => {
  const tags = new Set();
  countries.forEach((country) => {
    const region = REGION_MAP.get(String(country || '').trim().toLowerCase());
    if (region) tags.add(region);
  });
  if (tags.size > 1) tags.add('Global');
  return [...tags];
};

const normalizePhaseKey = (value = '') =>
  String(value || '')
    .toLowerCase()
    .replace(/phase/g, ' ')
    .replace(/early/g, '')
    .trim()
    .replace(/\b1\b/g, 'i')
    .replace(/\b2\b/g, 'ii')
    .replace(/\b3\b/g, 'iii')
    .replace(/\b4\b/g, 'iv')
    .replace(/\s+/g, '')
    .replace(/[^iv/]+/g, '');

const computePhaseRank = (phases = []) => {
  let best = 0;
  (Array.isArray(phases) ? phases : []).forEach((p) => {
    const n = normalizePhaseKey(p);
    if (['ii/iii', '2/3'].includes(n)) best = Math.max(best, 4.5);
    else if (['iii', '3'].includes(n)) best = Math.max(best, 5);
    else if (['ii', '2'].includes(n)) best = Math.max(best, 4);
    else if (['i/ii', '1/2'].includes(n)) best = Math.max(best, 3);
    else if (['iv', '4'].includes(n)) best = Math.max(best, 2);
    else if (['i', '1'].includes(n)) best = Math.max(best, 1);
  });
  return best;
};

const checkIpoPorto = (locations = []) => {
  const ipoPattern = /(?:\bipo\b.*\bporto\b)|(?:instituto portugu[eê]s de oncologia.*porto)|(?:oncologia do porto)/i;
  return (locations || []).some((loc) => {
    const facility = String(loc?.facility || '');
    const city = String(loc?.city || '');
    return ipoPattern.test(facility) || (/\bipo\b/i.test(facility) && /\bporto\b/i.test(city));
  });
};

const STAGE_PATTERNS = [
  { stage: 'metastatic', pattern: /\b(?:metast[aá]tic[oa]?s?|metast[aá]tico|stage\s*iv|est[aá]dio\s*iv|advanced\/metastatic|avan[çc]ado\/metast[aá]tico)\b/i },
  { stage: 'locally advanced', pattern: /\b(?:locally\s+advanced|localmente\s+avan[çc]ado|stage\s*iii[abc]?|est[aá]dio\s*iii[abc]?|unresectable|irressec[aá]vel|inoper[aá]vel)\b/i },
  { stage: 'localized', pattern: /\b(?:localiz(?:ed|ado)|early[- ]stage|est[aá]dio\s*precoce|stage\s*i[ab]?\b|stage\s*ii[abc]?\b|est[aá]dio\s*i[ab]?\b|est[aá]dio\s*ii[abc]?\b|resectable|ressec[aá]vel|operable|oper[aá]vel|non[- ]metastatic|n[aã]o[- ]metast[aá]tico|curative|curativ[oa])\b/i }
];

const extractDiseaseStage = (texts = []) => {
  const combined = texts.filter(Boolean).join(' ');
  for (const { stage, pattern } of STAGE_PATTERNS) {
    if (pattern.test(combined)) return stage;
  }
  return 'unspecified';
};

const extractPortugalLocations = (locations, locationCountry) => {
  const target = String(locationCountry || '').trim().toLowerCase();
  return (locations || []).filter((loc) => {
    const country = String(loc.country || '').trim().toLowerCase();
    return country === target;
  });
};

const filterLocationsByStatus = (locations, allowedStatusKeys) =>
  locations.filter((loc) => allowedStatusKeys.has(normalizeStatusKey(loc.status)));

const normalizeLocation = (loc, fallbackStatus, fallbackCountry) => ({
  facility: loc.facility || 'Unknown site',
  city: loc.city || '',
  state: loc.state || '',
  country: loc.country || fallbackCountry || '',
  status: loc.status || fallbackStatus || 'Unknown',
  statusKey: normalizeStatusKey(loc.status || fallbackStatus),
  zip: loc.zip || ''
});

const splitEligibilityCriteria = (rawCriteria = '') => {
  const text = String(rawCriteria || '').replace(/\r/g, '').trim();
  if (!text) {
    return {
      eligibilitySummary: '',
      inclusionCriteria: [],
      exclusionCriteria: []
    };
  }

  const normalized = text
    .replace(/\u2022/g, '- ')
    .replace(/\t/g, ' ')
    .replace(/\n{3,}/g, '\n\n');

  const inclusionMatch = normalized.match(/inclusion criteria\s*:?\s*([\s\S]*?)(?=\n\s*exclusion criteria\s*:|\Z)/i);
  const exclusionMatch = normalized.match(/exclusion criteria\s*:?\s*([\s\S]*)$/i);

  const toBulletList = (segment = '') =>
    segment
      .split(/\n+/)
      .map((line) => line.replace(/^\s*[-*•]+\s*/, '').trim())
      .filter(Boolean)
      .slice(0, 12);

  const inclusionCriteria = toBulletList(inclusionMatch?.[1] || '');
  const exclusionCriteria = toBulletList(exclusionMatch?.[1] || '');

  return {
    eligibilitySummary: truncate(normalized, 500),
    inclusionCriteria,
    exclusionCriteria
  };
};

const normalizeInterventions = (module = {}) => {
  const interventions = Array.isArray(module.interventions) ? module.interventions : [];
  return interventions.map((entry) => ({
    name: entry.name || '',
    type: entry.type || '',
    description: truncate(entry.description || '', 220),
    armGroupLabels: normalizeList(entry.armGroupLabels)
  }));
};

const normalizeArms = (module = {}) => {
  const armGroups = Array.isArray(module.armGroups) ? module.armGroups : [];
  return armGroups.map((arm) => ({
    label: arm.label || '',
    type: arm.type || '',
    description: truncate(arm.description || '', 220),
    interventionNames: normalizeList(arm.interventionNames)
  }));
};

const normalizeTrial = (study, options) => {
  const protocol = study?.protocolSection || {};
  const identification = protocol.identificationModule || {};
  const statusModule = protocol.statusModule || {};
  const conditionsModule = protocol.conditionsModule || {};
  const designModule = protocol.designModule || {};
  const descriptionModule = protocol.descriptionModule || {};
  const contactsModule = protocol.contactsLocationsModule || {};
  const eligibilityModule = protocol.eligibilityModule || {};
  const sponsorModule = protocol.sponsorCollaboratorsModule || {};
  const keywordsModule = protocol.keywordsModule || {};
  const armsInterventionsModule = protocol.armsInterventionsModule || {};

  const nctId = identification.nctId;
  if (!nctId) return null;

  const title = identification.briefTitle || identification.officialTitle || 'Untitled trial';
  const overallStatusRaw = statusModule.overallStatus || 'Unknown';
  const overallStatusKey = normalizeStatusKey(overallStatusRaw);

  const phases = normalizeList(designModule.phases);
  const conditionsRaw = normalizeList(conditionsModule.conditions);
  const conditions = conditionsRaw.length > 0 ? conditionsRaw : ['Unspecified condition'];

  const allLocations = Array.isArray(contactsModule.locations) ? contactsModule.locations : [];
  const portugalLocations = extractPortugalLocations(allLocations, options.location);
  if (portugalLocations.length === 0) return null;

  const allowedStatusKeys = options.statuses;
  const recruitingLocations = filterLocationsByStatus(portugalLocations, allowedStatusKeys);

  const qualifiesByLocation = recruitingLocations.length > 0;
  const qualifiesByOverall = allowedStatusKeys.has(overallStatusKey);
  if (!qualifiesByLocation && !qualifiesByOverall) return null;

  const portugalLocationRecords = portugalLocations.map((loc) =>
    normalizeLocation(loc, overallStatusRaw, options.location)
  );
  const recruitingLocationRecords = recruitingLocations.map((loc) =>
    normalizeLocation(loc, overallStatusRaw, options.location)
  );

  const allCountries = dedupe(
    allLocations
      .map((loc) => String(loc.country || '').trim())
      .filter(Boolean)
  );

  const studyFirstPostDate =
    statusModule.studyFirstPostDateStruct?.date ||
    statusModule.studyFirstPostDate ||
    statusModule.studyFirstSubmitDate ||
    statusModule.studyFirstSubmitDateStruct?.date ||
    '';

  const lastUpdatePostDate =
    statusModule.lastUpdatePostDateStruct?.date ||
    statusModule.lastUpdatePostDate ||
    '';

  const referenceDate = lastUpdatePostDate || studyFirstPostDate || '';
  const year = referenceDate ? String(referenceDate).slice(0, 4) : '';
  const recruitingInPortugal = recruitingLocationRecords.length > 0;

  const eligibility = splitEligibilityCriteria(eligibilityModule.eligibilityCriteria || '');
  const interventions = normalizeInterventions(armsInterventionsModule);
  const arms = normalizeArms(armsInterventionsModule);

  return {
    nctId,
    title,
    officialTitle: identification.officialTitle || '',
    overallStatus: overallStatusRaw,
    overallStatusKey,
    studyType: designModule.studyType || '',
    phases,
    conditions,
    keywords: normalizeList(keywordsModule.keywords),
    year,
    geography: allCountries.length > 1 ? `${options.location} + ${allCountries.length - 1} other countries` : options.location,
    countries: allCountries,
    regionTags: buildRegionTags(allCountries),
    studyFirstPostDate,
    lastUpdatePostDate,
    referenceDate,
    recruitingInPortugal,
    portugalSiteCount: portugalLocationRecords.length,
    portugalRecruitingSiteCount: recruitingLocationRecords.length,
    allSiteCount: allLocations.length,
    locations: portugalLocationRecords,
    recruitingLocations: recruitingLocationRecords,
    sponsor: {
      leadSponsorName: sponsorModule.leadSponsor?.name || '',
      leadSponsorClass: sponsorModule.leadSponsor?.class || ''
    },
    briefSummary: truncate(descriptionModule.briefSummary || '', 700),
    detailedDescription: truncate(descriptionModule.detailedDescription || '', 1200),
    enrollmentCount: designModule.enrollmentInfo?.count || designModule.enrollmentCount || null,
    enrollmentType: designModule.enrollmentInfo?.type || '',
    sex: eligibilityModule.sex || 'All',
    minimumAge: eligibilityModule.minimumAge || '',
    maximumAge: eligibilityModule.maximumAge || '',
    standardAges: normalizeList(eligibilityModule.stdAges),
    healthyVolunteers: eligibilityModule.healthyVolunteers || '',
    eligibilityCriteria: eligibilityModule.eligibilityCriteria || '',
    eligibilitySummary: eligibility.eligibilitySummary,
    inclusionCriteria: eligibility.inclusionCriteria,
    exclusionCriteria: eligibility.exclusionCriteria,
    interventions,
    arms,
    diseaseStage: extractDiseaseStage([
      title,
      identification.officialTitle,
      conditions.join(' '),
      descriptionModule.briefSummary
    ]),
    phaseRank: computePhaseRank(phases),
    ipoPorto: checkIpoPorto(portugalLocationRecords),
    source: 'clinicaltrials.gov',
    sourceUrl: buildTrialUrl(nctId),
    syncedAt: new Date().toISOString()
  };
};

const fetchStudies = async (options, logger) => {
  const baseUrl = options.baseUrl || DEFAULT_BASE_URL;
  const pageSize = options.pageSize || DEFAULT_PAGE_SIZE;
  const maxPages = options.maxPages || DEFAULT_MAX_PAGES;

  const studies = [];
  let pageToken = null;

  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams();
    params.set('query.locn', options.location);
    if (options.conditionQuery) {
      params.set('query.cond', options.conditionQuery);
    }
    params.set('pageSize', String(pageSize));
    if (pageToken) params.set('pageToken', pageToken);

    const url = `${baseUrl}?${params.toString()}`;
    logger.info(`[TrialRegistry] ClinicalTrials.gov fetch: ${url}`);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`ClinicalTrials.gov API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (Array.isArray(data.studies)) {
      studies.push(...data.studies);
    }

    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  return studies;
};

// -------------------------------------------------------------------
// CTIS (EU Clinical Trials Information System) — EMA public API
// Fetches oncology trials authorised in the EU, enriching the registry
// with EU-specific trials not always present on ClinicalTrials.gov.
// -------------------------------------------------------------------
const CTIS_BASE_URL = 'https://euclinicaltrials.eu/ctis-public/search';

const fetchCTISStudies = async (options, logger) => {
  const maxPages = Math.min(options.maxPages || 5, 10);
  const pageSize = Math.min(options.pageSize || 50, 100);
  const studies = [];

  try {
    for (let page = 1; page <= maxPages; page += 1) {
      const body = {
        pagination: { page, size: pageSize },
        sort: { property: 'decisionDate', direction: 'DESC' },
        searchCriteria: {
          containAll: (options.conditionQuery || 'cancer').split(' OR ').slice(0, 8).map((t) => t.trim()),
          countriesOfRecruitment: [options.location || 'Portugal'],
          trialStatus: ['Authorised']
        }
      };

      logger.info(`[TrialRegistry] CTIS fetch page ${page}`);
      const response = await fetch(CTIS_BASE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        logger.warn(`[TrialRegistry] CTIS API returned ${response.status} — skipping EU source`);
        break;
      }

      const data = await response.json();
      const results = Array.isArray(data.data) ? data.data : (Array.isArray(data.results) ? data.results : []);
      if (results.length === 0) break;

      results.forEach((ct) => {
        const ctNumber = ct.ctNumber || ct.eudraCtNumber || '';
        if (!ctNumber) return;

        studies.push({
          ctNumber,
          title: ct.fullTitle || ct.title || '',
          sponsor: ct.sponsorName || ct.sponsor || '',
          conditions: normalizeList(ct.medicalConditions || ct.therapeuticArea || []),
          status: ct.trialStatus || ct.overallStatus || 'Authorised',
          phases: normalizeList(ct.trialPhase || ct.phase || []),
          countries: normalizeList(ct.countriesOfRecruitment || ct.memberStates || []),
          decisionDate: ct.decisionDate || ct.startDate || '',
          summary: normalizeText(ct.summary || ct.objectives || ''),
          source: 'ctis'
        });
      });

      const totalPages = data.totalPages || data.pagination?.totalPages || page;
      if (page >= totalPages) break;
    }
  } catch (error) {
    logger.warn(`[TrialRegistry] CTIS fetch failed (non-fatal): ${error.message}`);
  }

  return studies;
};

const normalizeCTISTrial = (ct, options) => {
  const location = options.location || 'Portugal';
  const countries = ct.countries || [];
  const regionTags = [];
  countries.forEach((c) => {
    const region = REGION_MAP.get(c.toLowerCase());
    if (region) regionTags.push(region);
  });
  if (regionTags.length > 1) regionTags.push('Global');

  const recruitingInPortugal = countries.some((c) => c.toLowerCase() === location.toLowerCase());

  return {
    nctId: ct.ctNumber,
    title: ct.title,
    officialTitle: ct.title,
    briefSummary: ct.summary || '',
    detailedDescription: '',
    overallStatus: ct.status || 'Authorised',
    overallStatusKey: 'RECRUITING',
    phases: ct.phases,
    studyType: 'Interventional',
    conditions: ct.conditions.length > 0 ? ct.conditions : ['Oncology'],
    keywords: [],
    interventions: [],
    arms: [],
    inclusionCriteria: [],
    exclusionCriteria: [],
    eligibilitySummary: '',
    minimumAge: '',
    maximumAge: '',
    sex: 'All',
    standardAges: [],
    sponsor: { leadSponsorName: ct.sponsor },
    locations: recruitingInPortugal ? [{ facility: '', city: '', country: location, status: 'Recruiting' }] : [],
    countries: dedupe(countries),
    geography: countries.join(', '),
    regionTags: dedupe(regionTags),
    recruitingInPortugal,
    portugalSiteCount: recruitingInPortugal ? 1 : 0,
    portugalRecruitingSiteCount: recruitingInPortugal ? 1 : 0,
    year: (ct.decisionDate || '').slice(0, 4) || new Date().getFullYear().toString(),
    studyFirstPostDate: ct.decisionDate || '',
    lastUpdatePostDate: ct.decisionDate || '',
    referenceDate: ct.decisionDate || '',
    diseaseStage: extractDiseaseStage([ct.title, ct.summary]),
    phaseRank: computePhaseRank(ct.phases),
    ipoPorto: false,
    source: 'ctis',
    sourceUrl: `https://euclinicaltrials.eu/ctis-public/view/${ct.ctNumber}`,
    syncedAt: new Date().toISOString()
  };
};

const buildIndexes = (trials) => {
  const sitesMap = new Map();
  const conditionsMap = new Map();

  trials.forEach((trial) => {
    const trialSummary = {
      nctId: trial.nctId,
      title: trial.title,
      officialTitle: trial.officialTitle,
      overallStatus: trial.overallStatus,
      phases: trial.phases,
      studyType: trial.studyType,
      conditions: trial.conditions,
      year: trial.year,
      geography: trial.geography,
      regionTags: trial.regionTags,
      studyFirstPostDate: trial.studyFirstPostDate || '',
      lastUpdatePostDate: trial.lastUpdatePostDate || '',
      referenceDate: trial.referenceDate || '',
      recruitingInPortugal: Boolean(trial.recruitingInPortugal),
      portugalSiteCount: trial.portugalSiteCount || 0,
      portugalRecruitingSiteCount: trial.portugalRecruitingSiteCount || 0,
      interventionSummary: dedupe(trial.interventions.map((item) => item.name).filter(Boolean)).slice(0, 3).join(' + '),
      eligibilitySummary: trial.eligibilitySummary || '',
      sourceUrl: trial.sourceUrl
    };

    trial.locations.forEach((location) => {
      const siteKey = buildSiteKey(location.facility, location.city, location.country);
      const existingSite = sitesMap.get(siteKey) || {
        siteKey,
        facility: location.facility,
        city: location.city,
        country: location.country,
        trials: [],
        conditions: new Set(),
        lastSyncedAt: trial.syncedAt
      };

      existingSite.trials.push(trialSummary);
      trial.conditions.forEach((condition) => existingSite.conditions.add(condition));
      existingSite.lastSyncedAt = trial.syncedAt;
      sitesMap.set(siteKey, existingSite);
    });

    trial.conditions.forEach((condition) => {
      const conditionKey = buildConditionKey(condition);
      const existingCondition = conditionsMap.get(conditionKey) || {
        conditionKey,
        condition,
        trials: [],
        lastSyncedAt: trial.syncedAt
      };

      existingCondition.trials.push(trialSummary);
      existingCondition.lastSyncedAt = trial.syncedAt;
      conditionsMap.set(conditionKey, existingCondition);
    });
  });

  const sites = Array.from(sitesMap.values()).map((site) => ({
    ...site,
    conditions: Array.from(site.conditions)
  }));

  const conditions = Array.from(conditionsMap.values());

  return { sites, conditions };
};

export const runTrialRegistrySync = async ({ store, logger = console, options = {} }) => {
  const statusKeys = new Set(
    (options.statuses && options.statuses.length ? options.statuses : DEFAULT_STATUSES)
      .map(normalizeStatusKey)
      .filter(Boolean)
  );

  const resolvedOptions = {
    location: options.location || 'Portugal',
    statuses: statusKeys,
    conditionQuery: options.conditionQuery || DEFAULT_CONDITION_QUERY,
    baseUrl: options.baseUrl || DEFAULT_BASE_URL,
    pageSize: options.pageSize || DEFAULT_PAGE_SIZE,
    maxPages: options.maxPages || DEFAULT_MAX_PAGES,
    collectionPrefix: options.collectionPrefix || 'trial_registry'
  };

  const startedAt = new Date();

  // Fetch from both ClinicalTrials.gov and CTIS (EU) in parallel
  const [ctGovStudies, ctisStudies] = await Promise.all([
    fetchStudies(resolvedOptions, logger),
    fetchCTISStudies(resolvedOptions, logger)
  ]);

  const ctGovTrials = ctGovStudies
    .map((study) => normalizeTrial(study, resolvedOptions))
    .filter(Boolean);

  const ctisTrials = ctisStudies
    .map((ct) => normalizeCTISTrial(ct, resolvedOptions))
    .filter(Boolean);

  // Merge: ClinicalTrials.gov first, then CTIS trials not already present
  const existingIds = new Set(ctGovTrials.map((t) => t.nctId));
  const uniqueCTIS = ctisTrials.filter((t) => !existingIds.has(t.nctId));
  const trials = [...ctGovTrials, ...uniqueCTIS];

  logger.info(`[TrialRegistry] Sources: ClinicalTrials.gov=${ctGovTrials.length}, CTIS=${ctisTrials.length} (${uniqueCTIS.length} unique EU-only)`);

  const { sites, conditions } = buildIndexes(trials);
  const finishedAt = new Date().toISOString();

  const snapshot = {
    meta: {
      location: resolvedOptions.location,
      statuses: Array.from(statusKeys),
      trialsCount: trials.length,
      ctGovCount: ctGovTrials.length,
      ctisCount: uniqueCTIS.length,
      sitesCount: sites.length,
      conditionsCount: conditions.length,
      startedAt: startedAt.toISOString(),
      finishedAt,
      lastSyncedAt: finishedAt,
      source: 'clinicaltrials.gov+ctis'
    },
    trials,
    sites,
    conditions
  };

  if (!store || typeof store.writeSnapshot !== 'function') {
    throw new Error('Trial registry store is not configured');
  }

  await store.writeSnapshot(snapshot);

  return snapshot.meta;
};
