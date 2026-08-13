
import React, { useState, useRef, useEffect, useMemo } from "react";
import { flushSync } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import appLogo from '../../logo.jpg';
import {
  Search,
  Copy,
  CheckCircle,
  BookOpen,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Loader2,
  SlidersHorizontal,
  Sparkles,
  BookmarkPlus,
  Play,
  Trash2,
  Clock3,
  Menu,
  X,
  Plus,
  Send,
  ArrowUp,
  FlaskConical,
  FileSearch,
  Columns2,
  LogOut,
  Square,
  RefreshCw
} from "lucide-react";
import { toast } from "react-hot-toast";
import { Toaster } from "react-hot-toast";
import { useSettings } from "../contexts/SettingsContext";
import { useAuth } from "../contexts/AuthContext";
import { auth, dbConversations } from "../services/firebase";
import { collection, query, where, getDocs, doc, setDoc, deleteDoc } from "firebase/firestore";

// API service — derive from current location in production, use localhost in dev
const API_BASE_URL = process.env.NODE_ENV === "production"
  ? `${window.location.protocol}//${window.location.host}`
  : "http://localhost:3004";

// Bearer header with the signed-in user's Firebase ID token. The clinical data
// routes verify it server-side (backend dataRouteAuth); anonymous callers get 401.
const buildAuthHeaders = async () => {
  try {
    const token = await auth.currentUser?.getIdToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
};

// UUID helper
const uuid = () =>
  (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

const STUDY_TYPE_OPTIONS = [
  { value: "Randomized controlled trial", label: "ECR" },
  { value: "Systematic review", label: "Revisões sistemáticas" },
  { value: "Meta-analysis", label: "Meta-análises" },
  { value: "Clinical trial", label: "Ensaios clínicos" },
  { value: "Practice guideline", label: "Guidelines" },
  { value: "Observational study", label: "Observacionais" }
];

const ENDPOINT_OPTIONS = [
  { value: "Overall survival (OS)", label: "SG" },
  { value: "Progression-free survival (PFS)", label: "SLP" },
  { value: "Objective response rate (ORR)", label: "TRO" },
  { value: "Disease-free survival (DFS)", label: "SLD" },
  { value: "Safety and toxicity", label: "Segurança" },
  { value: "Quality of life", label: "QdV" },
  { value: "Biomarker-driven outcomes", label: "Biomarcadores" }
];

const RECENCY_OPTIONS = [
  { value: "any", label: "Qualquer período" },
  { value: "last_3_years", label: "Últimos 3 anos" },
  { value: "last_5_years", label: "Últimos 5 anos" },
  { value: "last_10_years", label: "Últimos 10 anos" }
];

const LANGUAGE_OPTIONS = [
  { value: "auto", label: "Automático" },
  { value: "en", label: "Inglês" },
  { value: "pt", label: "Português (PT)" },
  { value: "bilingual", label: "Bilingue" }
];

const EVIDENCE_MODE_OPTIONS = [
  { value: "conservative", label: "Conservador" },
  { value: "balanced", label: "Equilibrado" },
  { value: "exploratory", label: "Exploratório" }
];

const DEPTH_OPTIONS = [
  { value: "executive", label: "Análise breve" },
  { value: "detailed", label: "Síntese completa" }
];

const TRIAL_PHASE_OPTIONS = [
  { value: "Phase I", label: "Phase I" },
  { value: "Phase I/II", label: "Phase I/II" },
  { value: "Phase II", label: "Phase II" },
  { value: "Phase III", label: "Phase III" },
  { value: "Phase IV", label: "Phase IV" }
];

const STATUS_OPTIONS = [
  { value: "Recruiting", label: "Em recrutamento" }
];

const REGION_OPTIONS = [
  { value: "North America", label: "América do Norte" },
  { value: "Europe", label: "Europa" },
  { value: "Asia-Pacific", label: "Ásia-Pacífico" },
  { value: "Global", label: "Global" }
];

const WATCHLIST_STORAGE_KEY = "silvercancer_watchlist_v1";
const CONVERSATIONS_STORAGE_KEY = "silvercancer_conversations_v1";
const MAX_WATCHLIST_ITEMS = 12;
const MAX_CONVERSATIONS = 30;
const QUICK_QUESTION_EXAMPLES = [
  "Resultados de ensaios Fase III para osimertinib adjuvante em NSCLC EGFR+ ressecado.",
  "Comparar trastuzumab deruxtecan vs sacituzumab govitecan em CMM HR+/HER2-low.",
  "Elegibilidade e resultados do pembrolizumab em tumores sólidos MSI-H.",
  "Ensaios de imunoterapia neoadjuvante em melanoma ressecável.",
  "Tripleto vs dupleto em primeira linha no cancro colorretal metastático.",
  "Inibidores de PARP no cancro do ovário BRCA1/2: sinais de SLP e SG."
];

const normalizeStoredArray = (value) => Array.isArray(value) ? value.filter(Boolean) : [];

const normalizeWatchSettings = (settings = {}) => ({
  structuredMode: Boolean(settings.structuredMode),
  population: String(settings.population || ""),
  intervention: String(settings.intervention || ""),
  comparator: String(settings.comparator || ""),
  outcomes: String(settings.outcomes || ""),
  biomarker: String(settings.biomarker || ""),
  lineOfTherapy: String(settings.lineOfTherapy || ""),
  studyTypes: normalizeStoredArray(settings.studyTypes),
  endpoints: normalizeStoredArray(settings.endpoints),
  trialPhases: normalizeStoredArray(settings.trialPhases),
  recruitmentStatus: ["Recruiting"],
  regions: normalizeStoredArray(settings.regions || settings.trialRegions),
  recruitingInPortugalOnly: true,
  recency: String(settings.recency || "any"),
  detailLevel: String(settings.detailLevel || "detailed"),
  languagePreference: String(settings.languagePreference || settings.language || "pt"),
  evidenceMode: String(settings.evidenceMode || "balanced")
});

const buildWatchFingerprint = (question = "", settings = {}) =>
  JSON.stringify({
    question: String(question || "").trim().toLowerCase(),
    settings: normalizeWatchSettings(settings)
  });

const loadWatchlist = () => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(WATCHLIST_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === "object" && String(item.question || "").trim())
      .map((item) => ({
        id: String(item.id || uuid()),
        question: String(item.question || "").trim(),
        createdAt: item.createdAt || new Date().toISOString(),
        fingerprint: String(item.fingerprint || buildWatchFingerprint(item.question, item.settings)),
        settings: normalizeWatchSettings(item.settings),
        snapshot: {
          evidenceCount: Number(item?.snapshot?.evidenceCount) || 0,
          trialMatchCount: Number(item?.snapshot?.trialMatchCount) || 0,
          readinessLabel: String(item?.snapshot?.readinessLabel || ""),
          detailLabel: String(item?.snapshot?.detailLabel || ""),
          recencyLabel: String(item?.snapshot?.recencyLabel || ""),
          languageLabel: String(item?.snapshot?.languageLabel || "")
        }
      }))
      .slice(0, MAX_WATCHLIST_ITEMS);
  } catch (error) {
    console.error("Failed to load watchlist:", error);
    return [];
  }
};

const loadConversations = () => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CONVERSATIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((c) => c && c.id && Array.isArray(c.messages) && c.messages.length > 0)
      .slice(0, MAX_CONVERSATIONS);
  } catch {
    return [];
  }
};

const saveConversations = (conversations) => {
  try {
    const trimmed = conversations.slice(0, MAX_CONVERSATIONS).map((c) => ({
      id: c.id,
      title: c.title || "",
      createdAt: c.createdAt,
      updatedAt: c.updatedAt || c.createdAt,
      messages: c.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: typeof m.content === "string" ? m.content.slice(0, 8000) : "",
        timestamp: m.timestamp
      }))
    }));
    window.localStorage.setItem(CONVERSATIONS_STORAGE_KEY, JSON.stringify(trimmed));
  } catch (e) {
    console.warn("Failed to save conversations:", e);
  }
};

const deriveConversationTitle = (messages = []) => {
  const first = messages.find((m) => m.role === "user");
  if (!first) return "Nova conversa";
  const text = String(first.content || "").trim();
  return text.length > 60 ? text.slice(0, 57) + "…" : text;
};

// ── Firestore conversation sync helpers ──────────────────────────────────────
const FIRESTORE_CONVERSATIONS_COLLECTION = "conversations";

const loadConversationsFromFirestore = async (uid) => {
  if (!uid || !dbConversations) return [];
  try {
    const q = query(
      collection(dbConversations, FIRESTORE_CONVERSATIONS_COLLECTION),
      where("uid", "==", uid)
    );
    const snapshot = await getDocs(q);
    return snapshot.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || ""))
      .slice(0, MAX_CONVERSATIONS);
  } catch (err) {
    console.warn("[Firestore] Failed to load conversations:", err);
    return [];
  }
};

const saveConversationToFirestore = async (uid, conv) => {
  if (!uid || !dbConversations || !conv?.id) return;
  try {
    const ref = doc(dbConversations, FIRESTORE_CONVERSATIONS_COLLECTION, conv.id);
    await setDoc(ref, {
      uid,
      title: conv.title || "",
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt || conv.createdAt,
      messages: (conv.messages || []).map((m) => ({
        id: m.id,
        role: m.role,
        content: typeof m.content === "string" ? m.content.slice(0, 8000) : "",
        timestamp: m.timestamp || null
      }))
    }, { merge: true });
  } catch (err) {
    console.warn("[Firestore] Failed to save conversation:", err);
  }
};

const deleteConversationFromFirestore = async (convId) => {
  if (!dbConversations || !convId) return;
  try {
    await deleteDoc(doc(dbConversations, FIRESTORE_CONVERSATIONS_COLLECTION, convId));
  } catch (err) {
    console.warn("[Firestore] Failed to delete conversation:", err);
  }
};

const mergeConversations = (local, remote) => {
  const map = new Map();
  for (const c of [...remote, ...local]) {
    const existing = map.get(c.id);
    if (!existing || (c.updatedAt || c.createdAt) > (existing.updatedAt || existing.createdAt)) {
      map.set(c.id, c);
    }
  }
  return [...map.values()]
    .sort((a, b) => (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || ""))
    .slice(0, MAX_CONVERSATIONS);
};

const extractPhase = (value) => {
  const source = Array.isArray(value) ? value.join(" ") : String(value || "");
  const match = source.match(/phase\s*(ii\/iii|i\/ii|iv|iii|ii|i|2\/3|1\/2|4|3|2|1)/i);
  if (!match) return "—";
  const normalized = match[1].toUpperCase();
  const phaseLabelMap = {
    "1": "I",
    "1/2": "I/II",
    "2": "II",
    "2/3": "II/III",
    "3": "III",
    "4": "IV",
    I: "I",
    "I/II": "I/II",
    II: "II",
    "II/III": "II/III",
    III: "III",
    IV: "IV"
  };
  return `Phase ${phaseLabelMap[normalized] || normalized}`;
};

const getStatusClass = (status = "") => {
  const normalized = status.toLowerCase();
  if (normalized.includes("recruit")) return "recruiting";
  if (normalized.includes("active")) return "active";
  if (normalized.includes("complete")) return "complete";
  if (normalized.includes("terminate")) return "halted";
  return "pending";
};

const detectTrialIntent = (value = "") =>
  /\b(trial|trials|clinical trial|recruiting study|recruiting studies|ensaio|ensaios)\b/i
    .test(String(value || ""));

const TRIAL_TEXT_PREVIEW_LEN = 150;

const TrialExpandableText = ({ text, previewLen = TRIAL_TEXT_PREVIEW_LEN }) => {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;
  const needsTruncation = text.length > previewLen;
  if (!needsTruncation) return <>{text}</>;
  return (
    <>
      {expanded ? text : `${text.slice(0, previewLen).trim()}…`}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
        className="sc-expand-toggle"
      >
        {expanded ? "ver menos" : "ver mais"}
      </button>
    </>
  );
};

const summarizeTrialInterventions = (trial = {}) => {
  if (trial.interventionSummary) return trial.interventionSummary;
  const names = Array.isArray(trial.interventions)
    ? trial.interventions.map((entry) => entry?.name).filter(Boolean)
    : [];
  return names.slice(0, 3).join(" + ");
};

const summarizeTrialEligibility = (trial = {}) => {
  if (trial.eligibilitySummary) return trial.eligibilitySummary;
  const parts = [
    trial.minimumAge && trial.maximumAge
      ? `${trial.minimumAge} to ${trial.maximumAge}`
      : trial.minimumAge || trial.maximumAge || "",
    Array.isArray(trial.inclusionCriteria) && trial.inclusionCriteria.length > 0
      ? trial.inclusionCriteria[0]
      : ""
  ].filter(Boolean);
  return parts.join(" • ");
};

const STAGE_LABELS = {
  metastatic: "Metastático",
  "locally advanced": "Localmente avançado",
  localized: "Localizado",
  unspecified: "—"
};

const mapTrialRow = (trial, index) => ({
  id: trial.nctId || trial.id || "—",
  title: trial.title || `Resultado de ensaio ${index + 1}`,
  phase: extractPhase(trial.phases || trial.phase),
  status: trial.overallStatus || trial.status || "—",
  year: trial.year || "—",
  geography: trial.geography || "Portugal",
  sourceUrl: trial.sourceUrl || trial.url || (trial.nctId ? `https://clinicaltrials.gov/study/${trial.nctId}` : ""),
  interventionSummary: summarizeTrialInterventions(trial),
  armsSummary: trial.armsSummary || "",
  briefSummary: trial.briefSummaryShort || trial.briefSummary || "",
  eligibilitySummary: summarizeTrialEligibility(trial),
  sponsor: trial.sponsor?.leadSponsorName || trial.sponsor || "",
  siteSummary: typeof trial.portugalRecruitingSiteCount === "number"
    ? `${trial.portugalRecruitingSiteCount}/${trial.portugalSiteCount || trial.portugalRecruitingSiteCount} PT sites recruiting`
    : "",
  portugueseRecruitingSites: Array.isArray(trial.portugueseRecruitingSites) ? trial.portugueseRecruitingSites : [],
  matchReasons: Array.isArray(trial.matchReasons) ? trial.matchReasons.slice(0, 3) : [],
  diseaseStage: trial.diseaseStage || "unspecified",
  diseaseStageLabel: STAGE_LABELS[trial.diseaseStage] || "—",
  questionMatch: Boolean(trial.questionMatch),
  llmRelevance: trial.llmRelevance || null,
  llmReason: trial.llmReason || null,
  source: trial.source || "clinicaltrials.gov",
  conditions: Array.isArray(trial.conditions) ? trial.conditions : []
});

const stripReferenceSections = (text = "") => {
  if (typeof text !== "string") return text;
  const patterns = [
    /\n+##\s*📚\s*(Referências|Referencias|References|Scientific References|Referências Científicas)\b[\s\S]*$/i,
    /\n+##\s*📖\s*(Referências|Referencias|References|Scientific References|Referências Científicas)\b[\s\S]*$/i,
    /\n+##\s*(Referências|Referencias|References|Scientific References|Referências Científicas)\b[\s\S]*$/i,
    /\n+\*\*(Referências|References)\*\*[\s\S]*$/i
  ];
  let cleaned = text;
  for (const pattern of patterns) {
    cleaned = cleaned.replace(pattern, "");
  }
  return cleaned.trimEnd();
};

const stripInlineCitations = (text = "") => {
  if (typeof text !== "string") return text;
  return text.replace(/\s*\[(?:\d+(?:\s*-\s*\d+)?)(?:\s*,\s*\d+(?:\s*-\s*\d+)?)*\]/g, "");
};

const cleanAnswerText = (text = "") =>
  stripReferenceSections(text).replace(/[ \t]+\n/g, "\n").trimEnd();

const hasEmbeddedEvidenceSnapshot = (content = "") =>
  /(?:evidence readiness|prontid[aã]o da evid[eê]ncia|certainty \(heuristic\)|certeza \(heur[ií]stica\)|trial signals|sinais de ensaio|overall grade|grade:|years:\s*\d{4})/i.test(
    String(content || "")
  );

const dedupeReferences = (refs = []) => {
  const seen = new Set();
  return refs.filter((ref) => {
    if (!ref || typeof ref !== "object") return true;
    const keyRaw =
      ref.pmid ||
      ref.doi ||
      ref.url ||
      `${ref.title || ""}::${ref.publicationYear || ref.year || ""}`;
    const key = String(keyRaw || "").toLowerCase().trim();
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const getReferenceId = (ref) => {
  if (!ref) return "—";
  if (ref.pmid) return `PMID ${ref.pmid}`;
  if (ref.doi) return `DOI ${ref.doi}`;
  if (ref.url) return "URL";
  return "—";
};

const toTitleCase = (value = "") =>
  String(value)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());

const mapDomainLabel = (rawKey = "") => {
  const normalized = String(rawKey).toLowerCase().replace(/[^a-z]/g, "");
  const labels = {
    riskofbias: "Risco de viés",
    inconsistency: "Inconsistência",
    indirectness: "Imprecisão indireta",
    imprecision: "Imprecisão",
    publicationbias: "Viés de publicação"
  };
  return labels[normalized] || toTitleCase(rawKey);
};

const getOverallGrade = (ref) => {
  if (!ref || typeof ref !== "object") return "";
  const candidates = [
    ref.overallGrade,
    ref.gradeOverall,
    ref.grade?.overall,
    ref.grade?.overallGrade,
    ref.grade?.rating,
    ref.grade?.grade
  ];
  return candidates.find((value) => value) || "";
};

const getGradeDomains = (ref) => {
  if (!ref || typeof ref !== "object") return [];
  const sources = [
    ref.gradeDomains,
    ref.grade_domains,
    ref.grade?.domains,
    ref.grade?.domainSignals,
    ref.gradeDomainSignals,
    ref.gradeSignals
  ];
  const domains = sources.find((source) => source && (Array.isArray(source) || typeof source === "object"));
  if (!domains) return [];

  const entries = [];

  if (Array.isArray(domains)) {
    domains.forEach((item) => {
      if (!item) return;
      if (typeof item === "string") {
        const [rawKey, rawValue] = item.split(":").map((part) => part.trim());
        if (rawKey && rawValue) {
          entries.push({ label: mapDomainLabel(rawKey), rating: rawValue });
        }
        return;
      }
      if (typeof item === "object") {
        const rawKey = item.domain || item.name || item.key || item.metric || item.type;
        const rating = item.rating || item.level || item.value || item.signal || item.assessment;
        if (rawKey && rating) {
          entries.push({ label: mapDomainLabel(rawKey), rating });
        }
      }
    });
  } else if (typeof domains === "object") {
    Object.entries(domains).forEach(([rawKey, rating]) => {
      if (rating === undefined || rating === null || rating === "") return;
      entries.push({ label: mapDomainLabel(rawKey), rating });
    });
  }

  const seen = new Set();
  return entries.filter((entry) => {
    const key = entry.label.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const getGradeTone = (value, context = "domain") => {
  const normalized = String(value || "").toLowerCase();
  if (!normalized) return "neutral";

  if (context === "domain") {
    if (normalized.includes("low")) return "positive";
    if (normalized.includes("some") || normalized.includes("moderate") || normalized.includes("concern")) {
      return "caution";
    }
    if (normalized.includes("high") || normalized.includes("serious") || normalized.includes("very")) {
      return "negative";
    }
  }

  if (context === "overall") {
    if (normalized.includes("high")) return "positive";
    if (normalized.includes("moderate")) return "caution";
    if (normalized.includes("low") || normalized.includes("very")) return "negative";
  }

  return "neutral";
};

const getAdequacyStatus = (adequacy) => {
  if (!adequacy || typeof adequacy !== "object") return "";
  const candidate = adequacy.status || adequacy.level || adequacy.state;
  return String(candidate || "").toLowerCase();
};

const getAdequacyTone = (status) => {
  if (!status) return "neutral";
  if (status === "adequate") return "positive";
  if (status === "borderline") return "caution";
  if (status === "limited") return "negative";
  if (status === "insufficient") return "negative";
  return "neutral";
};

const getAdequacyLabel = (adequacy) => {
  if (!adequacy || typeof adequacy !== "object") return "";
  if (adequacy.label) return adequacy.label;
  const status = getAdequacyStatus(adequacy);
  const labels = {
    adequate: "Adequado para apresentação",
    borderline: "Utilizar com cautela",
    limited: "Evidência limitada",
    insufficient: "Evidência insuficiente"
  };
  return labels[status] || "Prontidão da evidência";
};

const normalizeKey = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const getStudyTypeCount = (studyTypes, aliases) => {
  if (!studyTypes || typeof studyTypes !== "object") return 0;
  const normalizedAliases = aliases.map((alias) => normalizeKey(alias));
  let total = 0;
  Object.entries(studyTypes).forEach(([rawKey, rawValue]) => {
    const normalizedKey = normalizeKey(rawKey);
    if (!normalizedKey) return;
    if (normalizedAliases.some((alias) => normalizedKey.includes(alias))) {
      const value = Number(rawValue);
      if (Number.isFinite(value)) total += value;
    }
  });
  return total;
};

const buildClinicalSummaryLines = ({
  readinessLabel,
  readinessScore,
  gradeOverall,
  yearRange,
  recentCount,
  sampleMedian,
  studyTypes,
  language
}) => {
  const isPt = String(language || "").toLowerCase().startsWith("pt") || language === "bilingual";
  const labels = isPt
    ? {
        readiness: "Prontidão da evidência",
        grade: "GRADE",
        years: "Anos",
        recent: "Estudos recentes",
        srma: "RS/MA",
        rct: "ECR",
        median: "Mediana N"
      }
    : {
        readiness: "Prontidão da evidência",
        grade: "GRADE",
        years: "Anos",
        recent: "Estudos recentes",
        srma: "RS/MA",
        rct: "ECR",
        median: "Mediana N"
      };

  const line1Parts = [];
  if (readinessLabel) {
    const scoreSuffix = typeof readinessScore === "number" ? ` (${readinessScore})` : "";
    line1Parts.push(`${labels.readiness}: ${readinessLabel}${scoreSuffix}`);
  }
  if (gradeOverall) line1Parts.push(`${labels.grade}: ${gradeOverall}`);
  if (yearRange) line1Parts.push(`${labels.years}: ${yearRange}`);

  const line2Parts = [];
  if (typeof recentCount === "number") line2Parts.push(`${labels.recent}: ${recentCount}`);
  const srCount = getStudyTypeCount(studyTypes, ["systematicreview", "systematic_review", "systematic review"]);
  const maCount = getStudyTypeCount(studyTypes, ["metaanalysis", "meta_analysis", "meta analysis", "meta-analysis"]);
  const srmaCount = srCount + maCount;
  if (srmaCount > 0) line2Parts.push(`${labels.srma}: ${srmaCount}`);
  const rctCount = getStudyTypeCount(studyTypes, [
    "rct",
    "randomizedcontrolledtrial",
    "randomized controlled trial",
    "randomised controlled trial"
  ]);
  if (rctCount > 0) line2Parts.push(`${labels.rct}: ${rctCount}`);
  if (sampleMedian) line2Parts.push(`${labels.median}: ${sampleMedian}`);

  return [line1Parts.join(" • "), line2Parts.join(" • ")].filter(Boolean);
};

const insertClinicalSummary = (content, summaryLines) => {
  if (!summaryLines || summaryLines.length === 0) return content;
  if (hasEmbeddedEvidenceSnapshot(content)) return content;
  const summaryBlock = summaryLines.map((line) => `- ${line}`).join("\n");
  const evidenceHeadingPattern = /##\s+(Evidence Identified|Evidência encontrada)[^\n]*\n/i;
  if (evidenceHeadingPattern.test(content)) {
    return content.replace(evidenceHeadingPattern, (match) => `${match}${summaryBlock}\n\n`);
  }
  return `${summaryBlock}\n\n${content}`;
};

const buildCopyableContent = ({ content = "" }) => {
  return String(content || "").trim();
};

const formatShortDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString();
};

const formatSavedTimestamp = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
};

const formatWeekInterval = (weekStart, weekEnd) => {
  const start = formatShortDate(weekStart);
  const end = formatShortDate(weekEnd);
  if (start && end) return `${start} - ${end}`;
  return start || end || "—";
};

const METRIC_DEFINITIONS = [
  { label: "N", keys: ["n", "sample_size", "samplesize", "participants", "patients", "enrolled"] },
  { label: "PFS", keys: ["pfs", "median_pfs", "pfs_median", "progression_free_survival"] },
  { label: "OS", keys: ["os", "median_os", "os_median", "overall_survival"] },
  { label: "ORR", keys: ["orr", "objective_response_rate"] },
  { label: "AEs", keys: ["aes", "adverse_events", "grade_3_4_ae", "grade34_ae", "toxicity"] }
];

const formatMetricValue = (value) => {
  if (value === undefined || value === null) return "";
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    if ("value" in value) {
      const unit = value.unit ? ` ${value.unit}` : "";
      return `${value.value}${unit}`;
    }
    if ("median" in value) {
      const unit = value.unit ? ` ${value.unit}` : "";
      return `${value.median}${unit}`;
    }
    if ("estimate" in value) {
      const unit = value.unit ? ` ${value.unit}` : "";
      return `${value.estimate}${unit}`;
    }
  }
  return String(value);
};

const findMetricValue = (metricsObject, keys) => {
  if (!metricsObject || typeof metricsObject !== "object") return null;
  const lowered = Object.keys(metricsObject).reduce((acc, key) => {
    acc[key.toLowerCase()] = metricsObject[key];
    return acc;
  }, {});
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(lowered, key)) {
      return lowered[key];
    }
  }
  return null;
};

const getMetrics = (ref) => {
  if (!ref || typeof ref !== "object") return [];
  const sources = [
    ref.metrics,
    ref.effectSizes,
    ref.outcomes,
    ref.evidenceMetrics,
    ref.clinicalOutcomes,
    ref.effect_metrics,
    ref
  ];

  const metricsObject = sources.find((source) => {
    if (!source || typeof source !== "object") return false;
    return METRIC_DEFINITIONS.some((definition) =>
      Object.keys(source).some((key) => definition.keys.includes(key.toLowerCase()))
    );
  });

  if (!metricsObject) return [];

  const result = [];
  METRIC_DEFINITIONS.forEach((definition) => {
    const rawValue = findMetricValue(metricsObject, definition.keys);
    const formatted = formatMetricValue(rawValue);
    if (formatted) {
      result.push({ label: definition.label, value: formatted });
    }
  });
  return result;
};

const getSynthesisLabels = (language = "en") => {
  const isPt = String(language).toLowerCase().startsWith("pt") || language === "bilingual";
  return isPt
    ? {
        mapTitle: "Mapa racional",
        mapSubtitle: "Resumo estruturado por tema",
        cardsTitle: "Cartões de evidência",
        cardsSubtitle: "Visão rápida por estudo",
        pico: "Pergunta clínica (PICO)",
        evidence: "Evidência encontrada",
        results: "Resultados clínicos",
        safety: "Segurança e tolerabilidade",
        quality: "Qualidade / risco de viés",
        consistency: "Consistência dos achados",
        applicability: "Aplicabilidade",
        certainty: "Certeza global (GRADE)",
        implication: "Implicação prática",
        gaps: "Lacunas",
        population: "População",
        intervention: "Intervenção",
        comparator: "Comparador",
        outcomes: "Desfechos",
        design: "Desenho",
        effect: "Direção",
        strength: "Força",
        limitations: "Limitações",
        keyFindings: "Achados"
      }
    : {
        mapTitle: "Visão geral da evidência",
        mapSubtitle: "Resumo estruturado por tema",
        cardsTitle: "Cartões de evidência",
        cardsSubtitle: "Visão rápida por estudo",
        pico: "Pergunta clínica (PICO)",
        evidence: "Evidência encontrada",
        results: "Resultados clínicos",
        safety: "Segurança e tolerabilidade",
        quality: "Qualidade / Risco de viés",
        consistency: "Consistência dos achados",
        applicability: "Aplicabilidade à prática",
        certainty: "Certeza global (GRADE)",
        implication: "Implicação prática",
        gaps: "Lacunas na evidência",
        population: "População",
        intervention: "Intervenção",
        comparator: "Comparador",
        outcomes: "Desfechos",
        design: "Desenho",
        effect: "Direção",
        strength: "Força",
        limitations: "Limitações",
        keyFindings: "Achados principais"
      };
};

const normalizeSynthesisLines = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return [value.trim()].filter(Boolean);
  }
  return [];
};

const buildSynthesisSections = (synthesis, language = "en") => {
  if (!synthesis || typeof synthesis !== "object") return [];
  const labels = getSynthesisLabels(language);
  const pico = synthesis.pico || {};
  const picoLines = [
    `${labels.population}: ${pico.population || "—"}`,
    `${labels.intervention}: ${pico.intervention || "—"}`,
    `${labels.comparator}: ${pico.comparator || "—"}`,
    `${labels.outcomes}: ${pico.outcomes || "—"}`
  ];

  const sections = [
    { id: "pico", title: labels.pico, items: picoLines },
    { id: "evidence", title: labels.evidence, items: normalizeSynthesisLines(synthesis.evidence_identified) },
    { id: "results", title: labels.results, items: normalizeSynthesisLines(synthesis.clinical_results) },
    { id: "safety", title: labels.safety, items: normalizeSynthesisLines(synthesis.safety) },
    { id: "quality", title: labels.quality, items: normalizeSynthesisLines(synthesis.quality) },
    { id: "consistency", title: labels.consistency, items: normalizeSynthesisLines(synthesis.consistency) },
    { id: "applicability", title: labels.applicability, items: normalizeSynthesisLines(synthesis.applicability) },
    { id: "certainty", title: labels.certainty, items: normalizeSynthesisLines(synthesis.certainty) },
    { id: "implication", title: labels.implication, items: normalizeSynthesisLines(synthesis.implication) },
    { id: "gaps", title: labels.gaps, items: normalizeSynthesisLines(synthesis.gaps) }
  ];

  return sections.filter((section) => section.items && section.items.length > 0);
};

const STRUCTURED_MISSING_PATTERN = /not reported in metadata|not reported in included studies|nao reportado nos metadados|n[aã]o reportado nos metadados|nao reportado nos estudos incluidos|n[aã]o reportado nos estudos inclu[ií]dos/i;

const normalizeStructuredLine = (value = "") =>
  String(value || "")
    .toLowerCase()
    .replace(/\[[0-9,\s]+\]/g, " ")
    .replace(/[^a-z0-9%\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const sanitizeStructuredLines = (lines = []) => {
  const asArray = Array.isArray(lines)
    ? lines
    : typeof lines === "string"
      ? [lines]
      : [];

  const normalized = asArray
    .map((line) => String(line || "").replace(/^\s*-\s*/, "").trim())
    .filter(Boolean);

  const informative = normalized.filter((line) => !STRUCTURED_MISSING_PATTERN.test(line));
  const source = informative.length > 0 ? informative : normalized;

  const seen = new Set();
  return source.filter((line) => {
    const key = normalizeStructuredLine(line);
    if (!key) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

// ── GRADE certainty presentation ───────────────────────────────────────────
// The backend returns a single overall GRADE certainty rating plus the five
// domain judgements that produced it (see GradeAssessmentAgent). The rating is
// computed before synthesis and is also woven into the answer text; this panel
// exposes the reasoning behind it, mirroring a GRADE evidence profile.
const GRADE_LABELS = {
  pt: {
    heading: "Certeza da evidência (GRADE)",
    why: "Porquê esta certeza",
    caveat: "Classificação GRADE-informada, gerada automaticamente. Não substitui a avaliação de um metodologista.",
    certainty: { high: "Alta", moderate: "Moderada", low: "Baixa", very_low: "Muito baixa" },
    domains: {
      risk_of_bias: "Risco de viés",
      inconsistency: "Inconsistência",
      indirectness: "Evidência indirecta",
      imprecision: "Imprecisão",
      publication_bias: "Viés de publicação"
    },
    ratings: {
      no_serious: "sem problemas graves",
      serious: "grave",
      very_serious: "muito grave",
      undetected: "não detectado",
      strongly_suspected: "fortemente suspeito"
    }
  },
  en: {
    heading: "Certainty of evidence (GRADE)",
    why: "Why this certainty",
    caveat: "GRADE-informed rating, generated automatically. Not a substitute for assessment by a trained methodologist.",
    certainty: { high: "High", moderate: "Moderate", low: "Low", very_low: "Very low" },
    domains: {
      risk_of_bias: "Risk of bias",
      inconsistency: "Inconsistency",
      indirectness: "Indirectness",
      imprecision: "Imprecision",
      publication_bias: "Publication bias"
    },
    ratings: {
      no_serious: "no serious concerns",
      serious: "serious",
      very_serious: "very serious",
      undetected: "undetected",
      strongly_suspected: "strongly suspected"
    }
  }
};

const gradeLocale = (language) => GRADE_LABELS[language === "pt" ? "pt" : "en"];

const formatGradeCertainty = (certainty, language) => {
  const locale = gradeLocale(language);
  return locale.certainty[certainty] || String(certainty || "").replace(/_/g, " ");
};

const getGradeCertaintyClass = (certainty) => {
  switch (certainty) {
    case "high": return "bg-teal-100 text-teal-800";
    case "moderate": return "bg-sky-100 text-sky-800";
    case "low": return "bg-amber-100 text-amber-800";
    case "very_low": return "bg-rose-100 text-rose-800";
    default: return "bg-slate-200 text-slate-700";
  }
};

const buildGradeDomainRows = (assessment, language) => {
  const domains = assessment?.domains;
  if (!domains || typeof domains !== "object") return [];
  const locale = gradeLocale(language);
  return Object.keys(locale.domains)
    .map((key) => {
      const domain = domains[key];
      if (!domain) return null;
      const rating = String(domain.rating || "");
      return {
        key,
        label: locale.domains[key],
        ratingLabel: locale.ratings[rating] || rating,
        serious: rating === "serious" || rating === "very_serious" || rating === "strongly_suspected",
        rationale: String(domain.rationale || "").trim()
      };
    })
    .filter(Boolean);
};

const sanitizeStructuredPayload = (structured) => {
  if (!structured || typeof structured !== "object") return null;

  const clone = { ...structured };
  const synthesis = clone.synthesis && typeof clone.synthesis === "object"
    ? { ...clone.synthesis }
    : null;

  if (synthesis) {
    const lineKeys = [
      "evidence_identified",
      "clinical_results",
      "safety",
      "quality",
      "consistency",
      "applicability",
      "certainty",
      "implication",
      "gaps",
      "discussion_conclusion",
      "trial_evidence_snapshot",
      "evidence_coherence_review"
    ];

    lineKeys.forEach((key) => {
      const cleaned = sanitizeStructuredLines(synthesis[key]);
      synthesis[key] = cleaned.length > 0 ? cleaned : [];
    });
  }

  const cards = Array.isArray(clone.evidenceCards) ? clone.evidenceCards : [];
  const informativeCards = cards.filter((card) => {
    if (!card || typeof card !== "object") return false;
    const keyFindings = String(card.key_findings || "").trim();
    return keyFindings.length > 0 && !STRUCTURED_MISSING_PATTERN.test(keyFindings);
  });

  const informativeLineCount = synthesis
    ? [
      "evidence_identified",
      "clinical_results",
      "safety",
      "quality",
      "consistency",
      "applicability",
      "certainty",
      "implication",
      "gaps"
    ].reduce((total, key) => total + (Array.isArray(synthesis[key]) ? synthesis[key].length : 0), 0)
    : 0;

  const hasTrialRegistry = Boolean(clone.trialRegistry);
  const hasUsableStructuredContent = informativeLineCount >= 3 || informativeCards.length > 0;

  if (!hasUsableStructuredContent && !hasTrialRegistry) {
    return null;
  }

  clone.synthesis = hasUsableStructuredContent ? synthesis : null;
  clone.evidenceCards = informativeCards;
  return clone;
};

const getStrengthClass = (value = "") => {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("high")) return "sc-strength-high";
  if (normalized.includes("moderate")) return "sc-strength-moderate";
  if (normalized.includes("low")) return "sc-strength-low";
  return "sc-strength-unclear";
};

const getEffectClass = (value = "") => {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("benefit")) return "sc-effect-benefit";
  if (normalized.includes("harm")) return "sc-effect-harm";
  if (normalized.includes("neutral")) return "sc-effect-neutral";
  return "sc-effect-unclear";
};

const CodeBlock = ({ children }) => {
  const codeRef = React.useRef(null);
  const [copied, setCopied] = React.useState(false);
  const handleCopy = () => {
    const text = codeRef.current?.innerText || "";
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="sc-code-block">
      <button className="sc-code-copy" onClick={handleCopy}>
        {copied ? <CheckCircle className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        {copied ? "Copiado" : "Copiar"}
      </button>
      <pre ref={codeRef}>{children}</pre>
    </div>
  );
};

// ─── Typewriter hook ──────────────────────────────────────────────────
const useTypewriter = (fullText) => {
  return fullText || "";
};

const MessageComponent = ({ message, onCopy, onRegenerate, isLast }) => {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);
  const [showReferences, setShowReferences] = useState(false);
  const [exporting, setExporting] = useState(null);

  const references = dedupeReferences(message.references || []);
  const hasReferences = references.length > 0;
  const rawContent = message.content;
  const displayContent = cleanAnswerText(rawContent);
  const warnings = Array.isArray(message.warnings) ? message.warnings : [];
  const structured = sanitizeStructuredPayload(message.structured);
  const readiness = structured?.readiness || null;
  const profile = structured?.evidenceProfile || null;
  const readinessStatus = getAdequacyStatus(readiness);
  const readinessTone = getAdequacyTone(readinessStatus);
  const readinessLabel = getAdequacyLabel(readiness);
  const readinessScore =
    readinessStatus === "insufficient"
      ? null
      : (typeof readiness?.score === "number" ? readiness.score : null);
  const readinessMessage = String(readiness?.message || "").trim();
  const readinessReasons = Array.isArray(readiness?.reasons) ? readiness.reasons.slice(0, 2) : [];
  const gradeOverall = profile?.grade?.overall;
  const yearRange = profile?.years?.range;
  const recentCount = profile?.years?.recentCount;
  const sampleMedian = profile?.sampleSize?.median;
  const summaryLanguage = structured?.language || message.settings?.language || "en";
  // GRADE certainty produced before synthesis (see simpleChatService.runGradeAssessment)
  const gradeAssessment = structured?.gradeAssessment || message.gradeAssessment || null;
  const gradeCertainty = gradeAssessment?.certainty_of_evidence || null;
  const gradeSummaryText = String(gradeAssessment?.summary || "").trim();
  const gradeDomainRows = buildGradeDomainRows(gradeAssessment, summaryLanguage);
  const synthesis = structured?.synthesis || null;
  const evidenceCards = Array.isArray(structured?.evidenceCards) ? structured.evidenceCards : [];
  const engine = String(message.engine || "").trim();
  const synthesisSections = buildSynthesisSections(synthesis, summaryLanguage);
  const synthesisLabels = getSynthesisLabels(summaryLanguage);
  const messageFlaggedTrials = useMemo(() => {
    const trials = structured?.trialRegistry?.trials || [];
    return trials.filter((t) => t.questionMatch).map((t, i) => mapTrialRow(t, i));
  }, [structured]);
  const composedContent = displayContent;
  const showWarningPanel = warnings.length > 0 && !(
    readinessStatus === "insufficient" &&
    warnings.every((warning) => String(warning?.code || "").trim() === "insufficient_evidence")
  );
  const readinessPanelClass = readinessTone === "negative"
    ? "border-rose-200 bg-rose-50"
    : readinessTone === "caution"
      ? "border-amber-200 bg-amber-50"
      : "border-teal-200 bg-teal-50";
  const readinessChipClass = readinessTone === "negative"
    ? "bg-rose-100 text-rose-800"
    : readinessTone === "caution"
      ? "bg-amber-100 text-amber-800"
      : "bg-teal-100 text-teal-800";
  const readinessTextClass = readinessTone === "negative"
    ? "text-rose-700"
    : readinessTone === "caution"
      ? "text-amber-800"
      : "text-teal-800";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(
        buildCopyableContent({
          content: composedContent,
          references,
          language: summaryLanguage
        })
      );
      setCopied(true);
      onCopy();
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const handleExport = async (format, template = "full") => {
    const exportKey = `${format}-${template}`;
    if (exporting) return;
    const exportQuestion =
      message.question ||
      structured?.question ||
      message.rawQuestion ||
      message.prompt ||
      message.query ||
      "Questão clínica";
    const exportMetadata = {
      ...(message.settings || {}),
      language: message.settings?.language || structured?.language || "auto",
      detailLevel: message.settings?.detailLevel || "detailed",
      evidenceMode: message.settings?.evidenceMode || "balanced",
      recency: message.settings?.recency || "any",
      evidenceAdequacy: message.evidenceAdequacy || structured?.readiness || null
    };
    try {
      setExporting(exportKey);
      const response = await fetch(`${API_BASE_URL}/api/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await buildAuthHeaders()) },
        body: JSON.stringify({
          format,
          template,
          question: exportQuestion,
          response: composedContent,
          structured,
          warnings,
          references: format === "pdf" ? [] : references,
          metadata: exportMetadata
        })
      });

      if (!response.ok) {
        throw new Error(`Export failed: ${response.status}`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const extension = format === "pdf" ? "pdf" : "json";
      const templateSuffix = format === "pdf" ? `_${template}` : "";
      link.href = url;
      link.download = `silvercancer_${format}${templateSuffix}_${message.id || "response"}.${extension}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to export:", err);
    } finally {
      setExporting(null);
    }
  };

  const handleDownloadSnapshot = () => {
    const defaultTemplate =
      message.settings?.detailLevel === "executive" ? "executive" : "full";
    handleExport("json", defaultTemplate);
  };

  if (isUser) {
    return (
      <div className="sc-msg-user sc-reveal">
        <p>{message.content}</p>
      </div>
    );
  }

  return (
    <div className="sc-message sc-message-assistant sc-reveal">
      <div className="sc-msg-header">
        <div className="sc-msg-avatar"><img src={appLogo} alt="SilverCancer" className="w-full h-full rounded-lg object-cover" /></div>
        <span className="sc-msg-name">SilverCancer</span>
        <div className="sc-msg-actions">
          <button onClick={handleCopy} className="sc-msg-action">{copied ? <><CheckCircle className="w-3.5 h-3.5" /> Copiado</> : <><Copy className="w-3.5 h-3.5" /> Copiar</>}</button>
          {structured && <button onClick={handleDownloadSnapshot} className="sc-msg-action">{exporting === "json-full" || exporting === "json-executive" ? "A exportar..." : "JSON"}</button>}
          {structured && <button onClick={() => handleExport("pdf", "full")} className="sc-msg-action" disabled={exporting === "pdf-full"}>{exporting === "pdf-full" ? "A exportar..." : "PDF"}</button>}
          {isLast && !message.streaming && onRegenerate && <button onClick={onRegenerate} className="sc-msg-action"><RefreshCw className="w-3.5 h-3.5" /> Regenerar</button>}
        </div>
      </div>

      {readinessLabel && (
        <div className={`mb-4 rounded-xl border p-4 ${readinessPanelClass}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${readinessChipClass}`}>
              {readinessLabel}
            </span>
            {typeof readinessScore === "number" && (
              <span className="text-xs font-medium text-slate-600">Pontuação {readinessScore}</span>
            )}
          </div>
          {readinessMessage && (
            <p className={`mt-2 text-sm font-medium ${readinessTextClass}`}>{readinessMessage}</p>
          )}
          {readinessReasons.length > 0 && (
            <p className="mt-2 text-xs text-slate-600">{readinessReasons.join(" • ")}</p>
          )}
        </div>
      )}

      {gradeCertainty && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {GRADE_LABELS[summaryLanguage === "pt" ? "pt" : "en"].heading}
            </span>
            <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${getGradeCertaintyClass(gradeCertainty)}`}>
              {formatGradeCertainty(gradeCertainty, summaryLanguage)}
            </span>
          </div>
          {gradeSummaryText && (
            <p className="mt-2 text-sm text-slate-700">{gradeSummaryText}</p>
          )}
          {gradeDomainRows.length > 0 && (
            <details className="mt-2 group">
              <summary className="cursor-pointer list-none text-xs font-semibold text-teal-700 hover:text-teal-800">
                {GRADE_LABELS[summaryLanguage === "pt" ? "pt" : "en"].why}
                <span className="ml-1 inline-block transition-transform group-open:rotate-90">›</span>
              </summary>
              <ul className="mt-2 space-y-1">
                {gradeDomainRows.map((domain) => (
                  <li key={domain.key} className="flex flex-wrap items-baseline gap-2 text-xs">
                    <span className="min-w-[9rem] font-medium text-slate-700">{domain.label}</span>
                    <span className={`rounded px-1.5 py-0.5 font-semibold ${domain.serious ? "bg-amber-100 text-amber-800" : "bg-slate-200 text-slate-700"}`}>
                      {domain.ratingLabel}
                    </span>
                    {domain.rationale && <span className="text-slate-600">{domain.rationale}</span>}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] italic text-slate-500">
                {GRADE_LABELS[summaryLanguage === "pt" ? "pt" : "en"].caveat}
              </p>
            </details>
          )}
        </div>
      )}


      {(synthesisSections.length > 0 || evidenceCards.length > 0) && (
        <div className="mb-6 space-y-4">
          {synthesisSections.length > 0 && (
            <div className="sc-panel p-5 sc-reveal">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="sc-kicker">{synthesisLabels.mapTitle}</p>
                  <h4 className="text-lg font-semibold text-slate-900">{synthesisLabels.mapSubtitle}</h4>
                </div>
                <span className="sc-badge">{synthesisSections.length}</span>
              </div>
              <div className="sc-rational-grid">
                {synthesisSections.map((section) => (
                  <div key={section.id} className="sc-rational-card">
                    <div className="sc-rational-title">{section.title}</div>
                    <div className="sc-rational-body">
                      {section.items.map((item, idx) => (
                        <p key={`${section.id}-${idx}`} className="sc-rational-line">
                          {item}
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {messageFlaggedTrials.length > 0 && (
            <div className="sc-panel p-5 sc-reveal">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="sc-kicker">Ensaios em recrutamento</p>
                  <h4 className="text-lg font-semibold text-slate-900">Ensaios relacionados com a sua questão</h4>
                </div>
                <span className="sc-badge">{messageFlaggedTrials.length}</span>
              </div>
              <div className="sc-trial-cards">
                {messageFlaggedTrials.map((trial, index) => (
                  <div key={`flag-${index}`} className="sc-trial-card">
                    <div className="sc-trial-card-header">
                      <span className="sc-trial-flag" title="Corresponde à sua questão">&#9873;</span>
                      {trial.llmRelevance && <span className="sc-relevance-chip" data-relevance={trial.llmRelevance}>{trial.llmRelevance}</span>}
                      <div className="sc-trial-card-title">{trial.title}</div>
                    </div>
                    <div className="sc-trial-card-meta">
                      <span className="sc-trial-card-chip sc-trial-card-phase">{trial.phase}</span>
                      <span className="sc-trial-card-chip sc-stage-chip" data-stage={trial.diseaseStage}>{trial.diseaseStageLabel}</span>
                      <span className={`sc-trial-card-chip sc-status sc-status-${getStatusClass(trial.status)}`}>{trial.status}</span>
                    </div>
                    {(trial.interventionSummary || trial.armsSummary) && (
                      <div className="sc-trial-card-row">
                        <span className="sc-trial-card-label">Intervenção</span>
                        <span className="sc-trial-card-value"><TrialExpandableText text={[trial.interventionSummary, trial.armsSummary].filter(Boolean).join(' — ')} /></span>
                      </div>
                    )}
                    {trial.llmReason && (
                      <div className="sc-trial-card-row">
                        <span className="sc-trial-card-label">Correspondência</span>
                        <span className="sc-trial-card-value sc-trial-card-match-reason"><TrialExpandableText text={trial.llmReason} /></span>
                      </div>
                    )}
                    {trial.briefSummary && (
                      <div className="sc-trial-card-row">
                        <span className="sc-trial-card-label">Resumo</span>
                        <span className="sc-trial-card-value sc-trial-card-brief"><TrialExpandableText text={trial.briefSummary} previewLen={200} /></span>
                      </div>
                    )}
                    {(trial.siteSummary || trial.portugueseRecruitingSites.length > 0) && (
                      <div className="sc-trial-card-row">
                        <span className="sc-trial-card-label">Centros</span>
                        <span className="sc-trial-card-value">
                          {trial.portugueseRecruitingSites.length > 0 ? (
                            <span className="sc-trial-sites-list">
                              {trial.portugueseRecruitingSites.map((site, si) => (
                                <span key={si} className="sc-trial-site-name">{site.facility}{site.city ? `, ${site.city}` : ""}</span>
                              ))}
                            </span>
                          ) : trial.siteSummary}
                        </span>
                      </div>
                    )}
                    <div className="sc-trial-card-footer">
                      {trial.sourceUrl ? (
                        <a href={trial.sourceUrl} target="_blank" rel="noopener noreferrer" className="sc-trial-card-nct">{trial.id}</a>
                      ) : (
                        <span className="sc-trial-card-nct">{trial.id}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {evidenceCards.length > 0 && (
            <div className="sc-panel p-5 sc-reveal">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="sc-kicker">{synthesisLabels.cardsTitle}</p>
                  <h4 className="text-lg font-semibold text-slate-900">{synthesisLabels.cardsSubtitle}</h4>
                </div>
                <span className="sc-badge">{evidenceCards.length}</span>
              </div>
              <div className="sc-evidence-cards">
                {evidenceCards.map((card, index) => {
                  const strengthClass = getStrengthClass(card?.evidence_strength);
                  const effectClass = getEffectClass(card?.effect_direction);
                  const cardTitle = card?.title || `Study ${index + 1}`;
                  const journalLine = [card?.journal, card?.year, card?.pmid ? `PMID ${card.pmid}` : ""]
                    .filter(Boolean)
                    .join(" • ");
                  const fields = [
                    { label: synthesisLabels.design, value: card?.study_design },
                    { label: synthesisLabels.population, value: card?.population },
                    { label: synthesisLabels.intervention, value: card?.intervention },
                    { label: synthesisLabels.comparator, value: card?.comparator },
                    { label: synthesisLabels.outcomes, value: card?.outcomes },
                    { label: synthesisLabels.keyFindings, value: card?.key_findings },
                    { label: synthesisLabels.limitations, value: card?.limitations }
                  ];
                  return (
                    <div key={`card-${index}`} className="sc-evidence-card">
                      <div className="sc-evidence-meta">
                        <div>
                          <div className="sc-evidence-title-line">
                            <span className="sc-evidence-index">[{index + 1}]</span>
                            <span className="sc-evidence-title">{cardTitle}</span>
                          </div>
                          {journalLine && <div className="sc-evidence-sub">{journalLine}</div>}
                        </div>
                        <div className="sc-evidence-tags">
                          <span className={`sc-evidence-tag ${strengthClass}`}>
                            {synthesisLabels.strength}: {toTitleCase(card?.evidence_strength || "—")}
                          </span>
                          <span className={`sc-evidence-tag ${effectClass}`}>
                            {synthesisLabels.effect}: {toTitleCase(card?.effect_direction || "—")}
                          </span>
                        </div>
                      </div>
                      <div className="sc-evidence-fields">
                        {fields.map((field, idx) => {
                          const value = String(field.value || "").trim();
                          if (!value) return null;
                          return (
                            <div key={`${index}-${idx}`} className="sc-evidence-field">
                              <div className="sc-field-label">{field.label}</div>
                              <div className="sc-field-value">{value}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {!message.streaming && (
        <div className="prose prose-sm max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => <h1 className="sc-serif text-xl font-bold text-slate-900 mb-4">{children}</h1>,
              h2: ({ children }) => (
                <h2 className="sc-serif text-lg font-bold text-slate-800 mb-3 border-l-4 border-teal-500 pl-3">
                  {children}
                </h2>
              ),
              h3: ({ children }) => <h3 className="sc-serif text-base font-semibold text-slate-700 mb-3">{children}</h3>,
              p: ({ children }) => <p className="text-slate-700 leading-relaxed mb-4 text-base">{children}</p>,
              ul: ({ children }) => <ul className="list-disc ml-5 space-y-2 mb-4">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal list-inside space-y-2 mb-4">{children}</ol>,
              li: ({ children }) => <li className="text-slate-700 text-base">{children}</li>,
              strong: ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
              em: ({ children }) => <em className="italic text-teal-700">{children}</em>,
              pre: CodeBlock,
              code: ({ children }) => (
                <code className="bg-slate-100 px-2 py-1 rounded text-sm font-mono text-slate-800">
                  {children}
                </code>
              ),
              table: ({ children }) => (
                <div className="my-5 overflow-x-auto rounded-2xl border border-slate-200 shadow-sm">
                  <table className="min-w-full border-collapse bg-white text-sm">{children}</table>
                </div>
              ),
              thead: ({ children }) => <thead className="bg-slate-50 text-slate-800">{children}</thead>,
              tbody: ({ children }) => <tbody className="divide-y divide-slate-100">{children}</tbody>,
              tr: ({ children }) => <tr className="align-top">{children}</tr>,
              th: ({ children }) => (
                <th className="px-4 py-3 text-left text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  {children}
                </th>
              ),
              td: ({ children }) => <td className="px-4 py-3 text-sm leading-relaxed text-slate-700">{children}</td>,
              blockquote: ({ children }) => (
                <blockquote className="border-l-4 border-teal-500 pl-4 italic text-slate-600 bg-teal-50 py-3 rounded-r">
                  {children}
                </blockquote>
              )
            }}
          >
            {composedContent}
          </ReactMarkdown>
        </div>
      )}

      {hasReferences && (
        <div className="sc-ref-section">
          <div className="flex items-center justify-between mb-4">
            <h4 className="sc-ref-title">
              <BookOpen className="w-4 h-4" />
              Referências
              <span className="sc-ref-count">{references.length}</span>
            </h4>
            <button onClick={() => setShowReferences(!showReferences)} className="sc-msg-action">
              {showReferences ? "Ocultar" : "Mostrar"}
              {showReferences ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>

          {showReferences && (
            <div className="space-y-3">
              {references.map((ref, index) => {
                const overallGrade = getOverallGrade(ref);
                const gradeDomains = getGradeDomains(ref);
                const metrics = getMetrics(ref);

                return (
                  <div key={index} className="sc-evidence-item">
                    <div className="flex items-start gap-3">
                      <div className="sc-ref-index">
                        <span className="text-xs font-bold text-white">{ref.index || index + 1}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        {ref.url ? (
                          <a
                            href={ref.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-left group"
                          >
                            <h5 className="sc-ref-link">
                              {ref.title || `Referência ${index + 1}`}
                            </h5>
                          </a>
                        ) : (
                          <h5 className="sc-ref-link-static">
                            {ref.title || `Referência ${index + 1}`}
                          </h5>
                        )}

                        {ref.authors && (
                          <p className="text-slate-600 text-sm mt-1">
                            <strong>Autores:</strong> {ref.authors}
                          </p>
                        )}

                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          {ref.journal && (
                            <span className="sc-badge">{ref.journal}</span>
                          )}
                          {ref.year && (
                            <span className="sc-badge">{ref.year}</span>
                          )}
                          {ref.pmid && (
                            <span className="sc-badge">PMID {ref.pmid}</span>
                          )}
                          {ref.publicationType && (
                            <span className="sc-badge">{ref.publicationType}</span>
                          )}
                        </div>

                        {overallGrade && (
                          <div className="sc-grade-overall">
                            <span className="sc-grade-label">GRADE global</span>
                            <span className={`sc-grade-chip sc-grade-${getGradeTone(overallGrade, "overall")}`}>
                              {overallGrade}
                            </span>
                          </div>
                        )}

                        {gradeDomains.length > 0 && (
                          <div className="sc-grade-grid">
                            {gradeDomains.map((domain) => (
                              <div
                                key={domain.label}
                                className={`sc-grade-chip sc-grade-${getGradeTone(domain.rating, "domain")}`}
                              >
                                <span className="sc-grade-domain">{domain.label}</span>
                                <span className="sc-grade-value">{domain.rating}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {metrics.length > 0 && (
                          <div className="sc-metric-row">
                            {metrics.map((metric) => (
                              <div key={metric.label} className="sc-metric-pill">
                                <span className="sc-metric-label">{metric.label}</span>
                                <span className="sc-metric-value">{metric.value}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {ref.url && (
                          <a
                            href={ref.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="sc-msg-action mt-2"
                          >
                            Ver fonte
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="sc-msg-bottom-actions">
        <button onClick={handleCopy} className="sc-msg-action">
          {copied ? <><CheckCircle className="w-3.5 h-3.5" /> Copiado</> : <><Copy className="w-3.5 h-3.5" /> Copiar</>}
        </button>
      </div>
    </div>
  );
};
const IntroPanel = ({ onQuestionSelect }) => {
  return (
    <div className="sc-panel sc-panel-strong sc-intro-panel p-5 sm:p-8 sc-reveal">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 mb-8">
        <div>
          <p className="sc-kicker">Comece aqui</p>
          <h2 className="sc-title text-3xl text-slate-900 mt-2">
            Faça uma pergunta prática de oncologia.
          </h2>
          <p className="sc-muted mt-3 text-base max-w-2xl">
            Use linguagem simples primeiro. Adicione filtros apenas quando precisar de restringir por biomarcador, linha de terapia, comparador ou fase do ensaio.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="sc-badge">Perguntas em linguagem simples</span>
          <span className="sc-badge">Rastreio de ensaios</span>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {QUICK_QUESTION_EXAMPLES.map((question, index) => (
          <button
            key={index}
            onClick={() => onQuestionSelect(question)}
            className="sc-quick-card text-left"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-2xl bg-slate-900 text-white flex items-center justify-center font-semibold">
                {index + 1}
              </div>
              <p className="text-slate-700 text-sm leading-relaxed">{question}</p>
            </div>
          </button>
        ))}
      </div>

      <div className="mt-8 text-sm text-slate-600 flex flex-wrap gap-4">
        <span className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-teal-600" />Resumo clínico</span>
        <span className="flex items-center gap-2"><SlidersHorizontal className="w-4 h-4 text-teal-600" />Filtros opcionais</span>
        <span className="flex items-center gap-2"><BookOpen className="w-4 h-4 text-teal-600" />Ligações às fontes</span>
      </div>
    </div>
  );
};
const SimpleChat = () => {
  const { user, logout } = useAuth();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [liveStreamText, setLiveStreamText] = useState("");
  const [progressStage, setProgressStage] = useState(null);
  const [followUpQuestions, setFollowUpQuestions] = useState([]);
  const [error, setError] = useState(null);
  const [structuredMode, setStructuredMode] = useState(false);
  const [population, setPopulation] = useState("");
  const [intervention, setIntervention] = useState("");
  const [comparator, setComparator] = useState("");
  const [outcomes, setOutcomes] = useState("");
  const [biomarker, setBiomarker] = useState("");
  const [lineOfTherapy, setLineOfTherapy] = useState("");
  const [studyTypes, setStudyTypes] = useState([]);
  const [endpoints, setEndpoints] = useState([]);
  const [trialPhases, setTrialPhases] = useState([]);
  const [recruitmentStatus, setRecruitmentStatus] = useState(["Recruiting"]);
  const [regions, setRegions] = useState([]);
  const [recruitingInPortugalOnly, setRecruitingInPortugalOnly] = useState(true);
  const [recency, setRecency] = useState("any");
  const [detailLevel, setDetailLevel] = useState("detailed");
  const [languagePreference, setLanguagePreference] = useState("pt");
  const [evidenceMode, setEvidenceMode] = useState("balanced");
  const [watchlist, setWatchlist] = useState(() => loadWatchlist());
  const [conversations, setConversations] = useState(() => loadConversations());
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [splitView, setSplitView] = useState(false);
  const [splitRightTab, setSplitRightTab] = useState("evidence");
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [cmdkQuery, setCmdkQuery] = useState("");
  const { settings: globalSettings, updateSetting } = useSettings();
  const [activeView, setActiveView] = useState("synthesis");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [trialRegistryMatches, setTrialRegistryMatches] = useState([]);
  const [trialRegistryGroups, setTrialRegistryGroups] = useState([]);
  const [trialRegistryWeeklyTable, setTrialRegistryWeeklyTable] = useState([]);
  const [trialRegistryLoading, setTrialRegistryLoading] = useState(false);
  const [trialRegistryError, setTrialRegistryError] = useState(null);
  const [selectedTrialCenter, setSelectedTrialCenter] = useState("");
  const [trialRegistryMeta, setTrialRegistryMeta] = useState(null);
  const [expandedTrials, setExpandedTrials] = useState(new Set());
  const [regulatorySegments, setRegulatorySegments] = useState({ reimbursement: null, ema: null, esmo: null });

  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const abortControllerRef = useRef(null);
  const streamingDivRef = useRef(null);
  const chatBodyRef = useRef(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [sidebarSearch, setSidebarSearch] = useState("");


  const conversationStarted = messages.length > 0 || loading;

  const latestAssistant = useMemo(() => {
    return [...messages].reverse().find((message) => message.role === "assistant");
  }, [messages]);
  const latestUserQuestion = useMemo(() => {
    const latestUser = [...messages].reverse().find((message) => message.role === "user");
    return String(latestUser?.content || "").trim();
  }, [messages]);

  const latestReferences = useMemo(() => {
    return dedupeReferences(latestAssistant?.references || []);
  }, [latestAssistant]);
  const latestTrialRegistry = latestAssistant?.structured?.trialRegistry || null;

  const latestEvidenceAdequacy = latestAssistant?.evidenceAdequacy || null;
  const adequacyStatus = getAdequacyStatus(latestEvidenceAdequacy);
  const adequacyTone = getAdequacyTone(adequacyStatus);
  const adequacyLabel = getAdequacyLabel(latestEvidenceAdequacy);
  const adequacyScore = typeof latestEvidenceAdequacy?.score === "number" ? latestEvidenceAdequacy.score : null;
  const adequacyReasons = Array.isArray(latestEvidenceAdequacy?.reasons)
    ? latestEvidenceAdequacy.reasons
    : [];
  const ascoSepCounts = latestEvidenceAdequacy?.metrics?.ascoSep?.counts || null;
  const ascoSepSummary = ascoSepCounts
    ? [
        ascoSepCounts.synthesis ? `Synthesis ${ascoSepCounts.synthesis}` : null,
        ascoSepCounts.rct ? `RCT ${ascoSepCounts.rct}` : null,
        ascoSepCounts.cohort ? `Cohort ${ascoSepCounts.cohort}` : null,
        ascoSepCounts.case_control ? `Case-control ${ascoSepCounts.case_control}` : null,
        ascoSepCounts.cross_sectional ? `Cross-sectional ${ascoSepCounts.cross_sectional}` : null,
        ascoSepCounts.ecologic ? `Ecologic ${ascoSepCounts.ecologic}` : null,
        ascoSepCounts.case_series ? `Case series ${ascoSepCounts.case_series}` : null
      ]
        .filter(Boolean)
        .join(" • ")
    : "";

  const trialMatches = useMemo(() => {
    if (!trialRegistryMatches.length) return [];

    const relevanceOrder = { high: 0, moderate: 1, low: 2, none: 3 };
    return trialRegistryMatches
      .map((trial, index) => mapTrialRow(trial, index))
      .sort((a, b) => {
        const aRel = relevanceOrder[a.llmRelevance] ?? 3;
        const bRel = relevanceOrder[b.llmRelevance] ?? 3;
        if (aRel !== bRel) return aRel - bRel;
        return (b.matchScore || 0) - (a.matchScore || 0);
      });
  }, [trialRegistryMatches]);

  const trialGroupRows = useMemo(() => {
    if (!trialRegistryGroups.length) return [];
    const relevanceOrder = { high: 0, moderate: 1, low: 2, none: 3 };
    return trialRegistryGroups.map((group) => ({
      condition: group.condition,
      stage: group.stage,
      stageLabel: STAGE_LABELS[group.stage] || "—",
      trials: (group.trials || [])
        .map((trial, index) => mapTrialRow(trial, index))
        .sort((a, b) => {
          const aRel = relevanceOrder[a.llmRelevance] ?? 3;
          const bRel = relevanceOrder[b.llmRelevance] ?? 3;
          if (aRel !== bRel) return aRel - bRel;
          return (b.matchScore || 0) - (a.matchScore || 0);
        })
    }));
  }, [trialRegistryGroups]);

  // Extract all unique recruiting centers from trial results
  const availableTrialCenters = useMemo(() => {
    const centerSet = new Map();
    for (const trial of trialMatches) {
      for (const site of trial.portugueseRecruitingSites) {
        const key = (site.facility || "").trim().toLowerCase();
        if (key && !centerSet.has(key)) {
          centerSet.set(key, { facility: site.facility.trim(), city: site.city || "" });
        }
      }
    }
    return [...centerSet.values()].sort((a, b) => a.facility.localeCompare(b.facility, "pt"));
  }, [trialMatches]);

  // Filter trials by selected center
  const filteredTrialMatches = useMemo(() => {
    if (!selectedTrialCenter) return trialMatches;
    const key = selectedTrialCenter.toLowerCase();
    return trialMatches.filter((trial) =>
      trial.portugueseRecruitingSites.some((site) =>
        (site.facility || "").trim().toLowerCase() === key
      )
    );
  }, [trialMatches, selectedTrialCenter]);

  const filteredTrialGroupRows = useMemo(() => {
    if (!selectedTrialCenter) return trialGroupRows;
    const key = selectedTrialCenter.toLowerCase();
    return trialGroupRows
      .map((group) => ({
        ...group,
        trials: group.trials.filter((trial) =>
          trial.portugueseRecruitingSites.some((site) =>
            (site.facility || "").trim().toLowerCase() === key
          )
        )
      }))
      .filter((group) => group.trials.length > 0);
  }, [trialGroupRows, selectedTrialCenter]);

  const flaggedTrials = useMemo(() =>
    trialMatches.filter((trial) => trial.questionMatch),
    [trialMatches]
  );

  const trialRegistryEvidenceRows = useMemo(() => {
    const trials = Array.isArray(latestTrialRegistry?.trials) ? latestTrialRegistry.trials : [];
    return trials.slice(0, 6).map((trial, index) => mapTrialRow(trial, index));
  }, [latestTrialRegistry]);

  const trialWeeklyRows = useMemo(() => {
    const liveRows = Array.isArray(trialRegistryWeeklyTable) ? trialRegistryWeeklyTable : [];
    if (liveRows.length > 0) return liveRows;
    const structuredRows = Array.isArray(latestTrialRegistry?.weeklyTable) ? latestTrialRegistry.weeklyTable : [];
    return structuredRows;
  }, [trialRegistryWeeklyTable, latestTrialRegistry]);

  const evidenceCount = latestReferences.length;
  const synthesisCount = messages.filter((message) => message.role === "assistant").length;
  const trialMatchCount = filteredTrialMatches.length;
  const trialMatchTotalCount = trialMatches.length;
  const trialWeeklyCount = trialWeeklyRows.length;
  const trialRegistryEvidenceCount = trialRegistryEvidenceRows.length;
  const trialRegistryUnavailable = latestTrialRegistry?.available === false;
  const trialRegistryUnavailableMessage =
    latestTrialRegistry?.error || "Registo de ensaios indisponível.";
  const watchlistCount = watchlist.length;
  const trialRegistryRecruitingOnly = Boolean(
    latestTrialRegistry?.meta?.recruitingInPortugalOnly ??
      trialRegistryMeta?.recruitingInPortugalOnly ??
      recruitingInPortugalOnly
  );
  const trialRegistryLocation =
    latestTrialRegistry?.meta?.location || trialRegistryMeta?.location || "Portugal";
  const trialRegistryLastSync = formatShortDate(
    latestTrialRegistry?.meta?.lastSyncedAt || trialRegistryMeta?.lastSyncedAt
  );
  const trialRegistryScopeText = trialRegistryRecruitingOnly
    ? "Apenas em recrutamento em Portugal."
    : "Panorama de Portugal sem restrição de recrutamento.";

  const medinovApprovals = useMemo(() => {
    const approvals = regulatorySegments.reimbursement?.medinovApprovals;
    return Array.isArray(approvals) ? approvals : [];
  }, [regulatorySegments.reimbursement]);
  const approvalCount = medinovApprovals.length;

  const viewTabs = [
    { id: "synthesis", label: "Resumo", count: synthesisCount },
    { id: "evidence", label: "Evidência", count: evidenceCount },
    { id: "trials", label: "Ensaios", count: trialMatchCount },
    ...(approvalCount > 0 ? [{ id: "approval", label: "Aprovação", count: approvalCount }] : []),
    { id: "watchlist", label: "Guardados", count: watchlistCount }
  ];
  const recencyLabel = RECENCY_OPTIONS.find((option) => option.value === recency)?.label || "Qualquer período";
  const detailLabel = DEPTH_OPTIONS.find((option) => option.value === detailLevel)?.label || "Síntese completa";
  const languageLabel = LANGUAGE_OPTIONS.find((option) => option.value === languagePreference)?.label || "Automático";
  const evidenceModeLabel = EVIDENCE_MODE_OPTIONS.find((option) => option.value === evidenceMode)?.label || "Equilibrado";
  const activeFilterCount = [
    population,
    biomarker,
    lineOfTherapy,
    intervention,
    comparator,
    outcomes
  ].filter((value) => String(value || "").trim().length > 0).length +
    studyTypes.length +
    endpoints.length +
    trialPhases.length +
    regions.length;
  const queryExamples = QUICK_QUESTION_EXAMPLES.slice(0, 4);
  const queryModeValue = structuredMode ? "Pesquisa clínica estruturada" : "Pesquisa por pergunta simples";
  const activeFilterPills = [
    population.trim() ? { label: "População", value: population.trim() } : null,
    biomarker.trim() ? { label: "Biomarcador", value: biomarker.trim() } : null,
    lineOfTherapy.trim() ? { label: "Linha", value: lineOfTherapy.trim() } : null,
    intervention.trim() ? { label: "Intervenção", value: intervention.trim() } : null,
    comparator.trim() ? { label: "Comparador", value: comparator.trim() } : null,
    outcomes.trim() ? { label: "Desfechos", value: outcomes.trim() } : null,
    studyTypes.length > 0 ? { label: "Tipos de estudo", value: `${studyTypes.length} selecionados` } : null,
    trialPhases.length > 0 ? { label: "Fases de ensaio", value: `${trialPhases.length} selecionadas` } : null,
    regions.length > 0 ? { label: "Regiões", value: `${regions.length} selecionadas` } : null,
    endpoints.length > 0 ? { label: "Endpoints", value: `${endpoints.length} selecionados` } : null
  ].filter(Boolean);
  const activeFilterPreview = activeFilterPills.length > 0
    ? activeFilterPills.slice(0, 3).map((item) => `${item.label}: ${item.value}`).join(" • ")
    : "Sem filtros clínicos aplicados";
  const latestCompletedQuestion = String(
    latestAssistant?.question ||
      latestAssistant?.rawQuestion ||
      latestUserQuestion ||
      ""
  ).trim();
  const searchSummaryItems = [
    queryModeValue,
    `${detailLabel} • ${recencyLabel}`,
    activeFilterCount > 0 ? `${activeFilterCount} filtros ativos` : "Sem filtros",
    trialRegistryLastSync ? `Registo atualizado ${trialRegistryLastSync}` : `Registo ${trialRegistryLocation}`
  ];
  const resultsSummary = `${synthesisCount} summaries • ${evidenceCount} evidence items • ${trialMatchCount} trials`;
  const currentSearchQuestion = String(
    input.trim() ||
      latestAssistant?.question ||
      latestAssistant?.rawQuestion ||
      latestUserQuestion ||
      ""
  ).trim();

  useEffect(() => {
    if (scrollRef.current && !showScrollButton) {
      scrollRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages, loading]);

  const handleChatBodyScroll = () => {
    const el = chatBodyRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    setShowScrollButton(!isNearBottom);
  };

  const scrollToBottom = () => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    setShowScrollButton(false);
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        WATCHLIST_STORAGE_KEY,
        JSON.stringify(watchlist.slice(0, MAX_WATCHLIST_ITEMS))
      );
    } catch (error) {
      console.error("Failed to persist watchlist:", error);
    }
  }, [watchlist]);

  // Load conversations from Firestore on login and merge with localStorage
  useEffect(() => {
    if (!user?.uid) return;
    let cancelled = false;
    console.log("[Conversations] Loading from Firestore for uid:", user.uid);
    loadConversationsFromFirestore(user.uid).then((remote) => {
      console.log("[Conversations] Firestore returned:", remote.length, "conversations");
      if (cancelled) return;
      if (remote.length > 0) {
        setConversations((prev) => {
          const merged = mergeConversations(prev, remote);
          console.log("[Conversations] Merged:", merged.length, "total");
          return merged;
        });
      }
    }).catch((err) => {
      console.error("[Conversations] Firestore load error:", err);
    });
    return () => { cancelled = true; };
  }, [user?.uid]);

  // Persist conversations list to localStorage whenever it changes
  const prevConversationsRef = useRef(conversations);
  useEffect(() => {
    if (conversations !== prevConversationsRef.current) {
      prevConversationsRef.current = conversations;
      saveConversations(conversations);
    }
  }, [conversations]);

  // Auto-save current conversation when messages change and loading is done
  // Only save evidence searches (with assistant responses), not trial-only searches
  useEffect(() => {
    if (!messages.length || loading) return;

    const hasAssistantResponse = messages.some((m) => m.role === "assistant" && m.content && m.content.length > 50);
    if (!hasAssistantResponse) return;

    const now = new Date().toISOString();
    const title = deriveConversationTitle(messages);

    let convId = activeConversationId;
    if (!convId) {
      convId = uuid();
      setActiveConversationId(convId);
    }

    const savedConvRef = { current: null };

    setConversations((prev) => {
      const exists = prev.find((c) => c.id === convId);
      let updated;
      if (exists) {
        updated = prev.map((c) =>
          c.id === convId
            ? { ...c, messages, title, updatedAt: now }
            : c
        );
        savedConvRef.current = updated.find((c) => c.id === convId);
      } else {
        const newConv = { id: convId, title, messages, createdAt: now, updatedAt: now };
        savedConvRef.current = newConv;
        updated = [newConv, ...prev];
      }
      return updated.slice(0, MAX_CONVERSATIONS);
    });

    // Sync to Firestore (non-blocking, outside state updater)
    if (user?.uid) {
      setTimeout(() => {
        if (savedConvRef.current) {
          saveConversationToFirestore(user.uid, savedConvRef.current);
        }
      }, 0);
    }
  }, [messages, loading, activeConversationId, user?.uid]);

  const loadConversation = (conv) => {
    setMessages(conv.messages || []);
    setActiveConversationId(conv.id);
    setError(null);
    setFollowUpQuestions([]);
    setProgressStage(null);
    setActiveView("synthesis");
  };

  const deleteConversation = (convId) => {
    setConversations((prev) => {
      const updated = prev.filter((c) => c.id !== convId);
      saveConversations(updated);
      return updated;
    });
    if (activeConversationId === convId) {
      setActiveConversationId(null);
      setMessages([]);
    }
    deleteConversationFromFirestore(convId);
  };

  useEffect(() => {
    if (structuredMode) {
      setFiltersOpen(true);
    }
  }, [structuredMode]);


  // Cmd+K command palette shortcut
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCmdkOpen(o => !o);
        setCmdkQuery("");
      }
      if (e.key === 'Escape') setCmdkOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const buildSearchSettingsSnapshot = (overrides = {}) =>
    normalizeWatchSettings({
      structuredMode,
      population,
      intervention,
      comparator,
      outcomes,
      biomarker,
      lineOfTherapy,
      studyTypes,
      endpoints,
      trialPhases,
      recruitmentStatus,
      regions,
      recruitingInPortugalOnly,
      recency,
      detailLevel,
      languagePreference,
      evidenceMode,
      ...overrides
    });

  const applySearchSettings = (settings = {}) => {
    const normalized = normalizeWatchSettings(settings);
    setStructuredMode(normalized.structuredMode);
    setPopulation(normalized.population);
    setIntervention(normalized.intervention);
    setComparator(normalized.comparator);
    setOutcomes(normalized.outcomes);
    setBiomarker(normalized.biomarker);
    setLineOfTherapy(normalized.lineOfTherapy);
    setStudyTypes([...normalized.studyTypes]);
    setEndpoints([...normalized.endpoints]);
    setTrialPhases([...normalized.trialPhases]);
    setRecruitmentStatus([...normalized.recruitmentStatus]);
    setRegions([...normalized.regions]);
    setRecruitingInPortugalOnly(normalized.recruitingInPortugalOnly);
    setRecency(normalized.recency);
    setDetailLevel(normalized.detailLevel);
    setLanguagePreference(normalized.languagePreference);
    setEvidenceMode(normalized.evidenceMode);
  };

  const buildTrialRegistryQuery = (question) => {
    return question;
  };

  const fetchTrialRegistryMatches = async (question, settings = null) => {
    const source = settings || buildSearchSettingsSnapshot();
    const query = buildTrialRegistryQuery(question, source);
    if (!query) return;

    setTrialRegistryLoading(true);
    setTrialRegistryError(null);
    setTrialRegistryWeeklyTable([]);
    try {
      const params = new URLSearchParams({
        q: query,
        maxTrials: "20",
        maxConditions: "10",
        recruitingInPortugalOnly: "true",
        statuses: "Recruiting"
      });
      if (source.population.trim()) params.set("population", source.population.trim());
      if (source.biomarker.trim()) params.set("biomarker", source.biomarker.trim());
      if (source.intervention.trim()) params.set("intervention", source.intervention.trim());
      if (source.comparator.trim()) params.set("comparator", source.comparator.trim());
      if (source.outcomes.trim()) params.set("outcomes", source.outcomes.trim());
      if (source.lineOfTherapy.trim()) params.set("lineOfTherapy", source.lineOfTherapy.trim());
      if (source.trialPhases.length > 0) params.set("phases", source.trialPhases.join(","));
      if (source.regions.length > 0) params.set("regions", source.regions.join(","));

      const response = await fetch(`${API_BASE_URL}/api/trial-registry/search?${params.toString()}`, {
        headers: await buildAuthHeaders()
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Falha na pesquisa do registo de ensaios");
      }
      if (data.available === false) {
        setTrialRegistryMatches([]);
        setTrialRegistryGroups([]);
        setTrialRegistryMeta(data.meta || null);
        setTrialRegistryWeeklyTable([]);
        setTrialRegistryError(data.error || "Registo de ensaios indisponível");
        return;
      }
      setTrialRegistryMatches(data.trials || []);
      setTrialRegistryGroups(Array.isArray(data.trialGroups) ? data.trialGroups : []);
      setTrialRegistryMeta(data.meta || null);
      setTrialRegistryWeeklyTable(Array.isArray(data.weeklyTable) ? data.weeklyTable : []);
    } catch (trialError) {
      setTrialRegistryMatches([]);
      setTrialRegistryGroups([]);
      setTrialRegistryError(trialError.message || "Registo de ensaios indisponível");
      setTrialRegistryMeta(null);
      setTrialRegistryWeeklyTable([]);
    } finally {
      setTrialRegistryLoading(false);
    }
  };

  const MAX_QUESTION_LENGTH = 2000;

  const executeSearch = async (questionText, settings = null) => {
    const trimmedQuestion = String(questionText || "").trim();
    if (!trimmedQuestion || loading) return;

    if (trimmedQuestion.length > MAX_QUESTION_LENGTH) {
      toast.error(`Questão demasiado longa (máx. ${MAX_QUESTION_LENGTH} caracteres).`, { duration: 3000 });
      return;
    }

    const sourceSettings = settings || buildSearchSettingsSnapshot();
    const hasTrialFilters = sourceSettings.trialPhases.length > 0 || sourceSettings.regions.length > 0;
    // Trial-only when: user is on Trials tab, or has explicit trial filters set
    const wantsTrialOnly =
      activeView === "trials" ||
      hasTrialFilters;

    setTrialRegistryMatches([]);
    setTrialRegistryGroups([]);
    setTrialRegistryMeta(null);
    setTrialRegistryWeeklyTable([]);
    setTrialRegistryError(null);
    setSelectedTrialCenter("");

    // Trial-only search: fetch trials and stop — no evidence API call
    if (wantsTrialOnly) {
      setActiveView("trials");
      fetchTrialRegistryMatches(trimmedQuestion, sourceSettings);
      const userMessage = {
        id: uuid(),
        role: "user",
        content: trimmedQuestion,
        timestamp: new Date()
      };
      setMessages((prev) => [...prev, userMessage]);
      setInput("");
      return;
    }

    // Evidence search: fetch evidence + trials in background
    if (activeView !== "evidence" && activeView !== "approval") {
      setActiveView("synthesis");
    }
    fetchTrialRegistryMatches(trimmedQuestion, sourceSettings);

    const structuredLines = buildStructuredLines(sourceSettings);
    const structuredContext = sourceSettings.structuredMode
      ? {
          population: sourceSettings.population.trim() || undefined,
          intervention: sourceSettings.intervention.trim() || undefined,
          comparator: sourceSettings.comparator.trim() || undefined,
          outcomes: sourceSettings.outcomes.trim() || undefined,
          biomarker: sourceSettings.biomarker.trim() || undefined,
          lineOfTherapy: sourceSettings.lineOfTherapy.trim() || undefined,
          studyTypes: sourceSettings.studyTypes.length > 0 ? sourceSettings.studyTypes : undefined,
          endpoints: sourceSettings.endpoints.length > 0 ? sourceSettings.endpoints : undefined,
          notes: structuredLines.length > 0 ? structuredLines : undefined
        }
      : {};
    const selectedEngine = sourceSettings.structuredMode ? "unified_clinical" : "simple_v2";
    const includeExpandedSources = sourceSettings.structuredMode;
    const conversationHistory = messages
      .filter((messageItem) => messageItem.role === "user" || messageItem.role === "assistant")
      .slice(-8)
      .map((messageItem) => ({
        role: messageItem.role,
        content: cleanAnswerText(String(messageItem.content || "")).slice(0, 1400)
      }))
      .filter((messageItem) => messageItem.content.length > 0);

    const userMessage = {
      id: uuid(),
      role: "user",
      content: trimmedQuestion,
      timestamp: new Date()
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);
    setError(null);
    setFollowUpQuestions([]);
    setProgressStage(null);
    setRegulatorySegments({ reimbursement: null, ema: null, esmo: null });

    const requestBody = JSON.stringify({
      question: trimmedQuestion,
      conversationHistory,
      options: {
        engine: selectedEngine,
        language: sourceSettings.languagePreference,
        recency: sourceSettings.recency,
        detailLevel: sourceSettings.detailLevel,
        evidenceMode: sourceSettings.evidenceMode,
        quickStudyOnly: sourceSettings.detailLevel === "executive",
        responseStyle: sourceSettings.structuredMode ? "structured" : "narrative",
        includeCuriaMaterials: includeExpandedSources,
        includeAscoSepMaterials: includeExpandedSources,
        includeTrialRegistry: true,
        population: structuredContext.population,
        intervention: structuredContext.intervention,
        comparator: structuredContext.comparator,
        outcomes: structuredContext.outcomes,
        biomarker: structuredContext.biomarker,
        lineOfTherapy: structuredContext.lineOfTherapy,
        studyTypes: structuredContext.studyTypes,
        endpoints: structuredContext.endpoints,
        clinicalContext: structuredContext,
        conversationHistory,
        trialPhases: sourceSettings.trialPhases,
        trialStatuses: ["Recruiting"],
        trialRegions: sourceSettings.regions,
        trialRecruitingInPortugalOnly: true
      }
    });

    // Use SSE streaming endpoint
    const streamingMsgId = uuid();
    let streamingContent = "";
    let sseBuffer = "";
    let chunkCount = 0;
    let streamDone = false;

    try {
      abortControllerRef.current = new AbortController();
      const response = await fetch(`${API_BASE_URL}/api/simple-chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await buildAuthHeaders()) },
        body: requestBody,
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Add streaming placeholder message
      setMessages((prev) => [
        ...prev,
        {
          id: streamingMsgId,
          role: "assistant",
          content: "",
          streaming: true,
          timestamp: new Date(),
          question: trimmedQuestion,
          rawQuestion: trimmedQuestion,
          settings: {
            language: sourceSettings.languagePreference,
            recency: sourceSettings.recency,
            detailLevel: sourceSettings.detailLevel,
            evidenceMode: sourceSettings.evidenceMode,
            trialPhases: sourceSettings.trialPhases,
            trialStatuses: ["Recruiting"],
            trialRegions: sourceSettings.regions,
            trialRecruitingInPortugalOnly: true
          }
        }
      ]);

      // Process SSE stream using pipeTo + WritableStream
      // This ensures each network chunk is processed as a separate macrotask,
      // giving the browser time to paint between updates.
      const decoder = new TextDecoder();
      await new Promise((resolveStream, rejectStream) => {
        const writable = new WritableStream({
          write(value) {
            sseBuffer += decoder.decode(value, { stream: true });
            const lines = sseBuffer.split("\n");
            sseBuffer = lines.pop();

            let hasNewChunks = false;
            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              try {
                const event = JSON.parse(line.slice(6));

                if (event.type === "progress") {
                  flushSync(() => setProgressStage(event));

                } else if (event.type === "chunk") {
                  streamingContent += event.text;
                  chunkCount++;
                  hasNewChunks = true;

                } else if (event.type === "done") {
                  const finalContent = cleanAnswerText(streamingContent || "Lamentamos, não foi possível processar a sua questão.");
                  streamDone = true;
                  flushSync(() => {
                    setLiveStreamText("");
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === streamingMsgId
                          ? {
                              ...m,
                              content: finalContent,
                              streaming: false,
                              engine: selectedEngine,
                              references: dedupeReferences(event.references || []),
                              evidenceAdequacy: event.evidenceAdequacy || null,
                              gradeAssessment: event.gradeAssessment || null,
                              structured: event.gradeAssessment
                                ? { readiness: event.evidenceAdequacy || null, gradeAssessment: event.gradeAssessment }
                                : null,
                              warnings: Array.isArray(event.warnings) ? event.warnings : []
                            }
                          : m
                      )
                    );
                  });
                  setFollowUpQuestions(Array.isArray(event.followUpQuestions) ? event.followUpQuestions : []);
                  setProgressStage(null);
                  setLoading(false);

                } else if (event.type === "trialRegistry") {
                  const tr = event.trialRegistry || {};
                  if (tr.available === false) {
                    setTrialRegistryMatches([]);
                    setTrialRegistryGroups([]);
                    setTrialRegistryWeeklyTable([]);
                    setTrialRegistryError(tr.error || "Registo de ensaios indisponível");
                  } else {
                    if (Array.isArray(tr.trials)) setTrialRegistryMatches(tr.trials);
                    if (Array.isArray(tr.trialGroups)) setTrialRegistryGroups(tr.trialGroups);
                    if (tr.meta) setTrialRegistryMeta(tr.meta);
                    if (Array.isArray(tr.weeklyTable)) setTrialRegistryWeeklyTable(tr.weeklyTable);
                    setTrialRegistryError(null);
                  }

                } else if (event.type === "reimbursement") {
                  setRegulatorySegments((prev) => ({ ...prev, reimbursement: event.reimbursement || null }));

                } else if (event.type === "ema") {
                  setRegulatorySegments((prev) => ({ ...prev, ema: event.ema || null }));

                } else if (event.type === "esmoGuidelines") {
                  setRegulatorySegments((prev) => ({ ...prev, esmo: event.esmoGuidelines || null }));

                } else if (event.type === "revision") {
                  const revisedContent = cleanAnswerText(event.answer || streamingContent);
                  streamingContent = revisedContent;
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === streamingMsgId
                        ? { ...m, content: revisedContent }
                        : m
                    )
                  );

                } else if (event.type === "pubmedLateReferences") {
                  // Phase 2: PubMed arrived after Claude started — append to existing references
                  const lateRefs = dedupeReferences(event.references || []);
                  if (lateRefs.length > 0) {
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === streamingMsgId
                          ? { ...m, references: dedupeReferences([...(m.references || []), ...lateRefs]) }
                          : m
                      )
                    );
                  }

                } else if (event.type === "error") {
                  setError(event.message || "Falha no processamento.");
                  setProgressStage(null);
                  setLoading(false);
                }
              } catch {}
            }

            // Update streaming text — rAF paces renders to 60fps without
            // forcing a synchronous React flush on every network chunk.
            if (hasNewChunks && !streamDone) {
              setLiveStreamText(streamingContent);
              return new Promise(r => requestAnimationFrame(r));
            }
          },
          close() { resolveStream(); },
          abort(err) { rejectStream(err); }
        });

        response.body.pipeTo(writable, { signal: abortControllerRef.current?.signal }).catch(rejectStream);
      });
    } catch (err) {
      if (err.name === "AbortError") {
        // User stopped generation — finalize partial content
        setMessages((prev) =>
          prev.map((m) =>
            m.id === streamingMsgId ? { ...m, content: cleanAnswerText(streamingContent || ""), streaming: false } : m
          )
        );
        setProgressStage(null);
        setLoading(false);
        return;
      }
      console.error("Error sending message:", err);
      setError("Falha ao processar a sua questão. Verifique a ligação e tente novamente.");
      setProgressStage(null);
      setLoading(false);
    }
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
  };

  const handleRegenerate = () => {
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant) return;
    const question = lastAssistant.question || lastAssistant.rawQuestion || "";
    const settings = lastAssistant.settings || buildSearchSettingsSnapshot();
    setMessages((prev) => prev.filter((m) => m.id !== lastAssistant.id));
    executeSearch(question, settings);
  };

  const handleSend = async (e) => {
    e.preventDefault();
    await executeSearch(input.trim(), buildSearchSettingsSnapshot());
  };

  const handleNewChat = () => {
    setMessages([]);
    setActiveConversationId(null);
    setError(null);
    resetBuilder();
    setActiveView("synthesis");
    setFiltersOpen(false);
    setFollowUpQuestions([]);
    setProgressStage(null);
    setTrialRegistryMatches([]);
    setTrialRegistryGroups([]);
    setTrialRegistryWeeklyTable([]);
    setTrialRegistryError(null);
    setTrialRegistryMeta(null);
  };

  const handleMessageCopy = () => {
    toast.success("Mensagem copiada.", {
      duration: 2000,
      position: "top-right"
    });
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(e);
    }
  };

  const toggleSelection = (value, list, setter) => {
    if (list.includes(value)) {
      setter(list.filter((item) => item !== value));
    } else {
      setter([...list, value]);
    }
  };

  const saveCurrentSearchToWatchlist = () => {
    if (!currentSearchQuestion) {
      toast.error("Introduza ou execute uma pesquisa antes de guardar.");
      return;
    }

    const matchesLatestRun =
      currentSearchQuestion.toLowerCase() === latestCompletedQuestion.toLowerCase();
    const settings = buildSearchSettingsSnapshot();
    const fingerprint = buildWatchFingerprint(currentSearchQuestion, settings);
    const nextItem = {
      id: uuid(),
      fingerprint,
      question: currentSearchQuestion,
      createdAt: new Date().toISOString(),
      settings,
      snapshot: {
        evidenceCount: matchesLatestRun ? evidenceCount : 0,
        trialMatchCount: matchesLatestRun ? trialMatchCount : 0,
        readinessLabel: matchesLatestRun ? adequacyLabel : "",
        detailLabel,
        recencyLabel,
        languageLabel
      }
    };

    setWatchlist((prev) => {
      const existing = prev.find((item) => item.fingerprint === fingerprint);
      const remaining = prev.filter((item) => item.fingerprint !== fingerprint);
      const merged = existing
        ? [{ ...existing, ...nextItem, id: existing.id }]
        : [nextItem];
      return [...merged, ...remaining].slice(0, MAX_WATCHLIST_ITEMS);
    });

    toast.success("Pesquisa guardada na lista de vigilância.");
  };

  const removeWatchItem = (watchId) => {
    setWatchlist((prev) => prev.filter((item) => item.id !== watchId));
  };

  const loadWatchItem = (item) => {
    if (!item) return;
    applySearchSettings(item.settings);
    setInput(item.question || "");
    setActiveView("synthesis");
    setTimeout(() => inputRef.current?.focus(), 0);
    toast.success("Pesquisa carregada na caixa de perguntas.");
  };

  const runWatchItem = async (item) => {
    if (!item) return;
    applySearchSettings(item.settings);
    await executeSearch(item.question, item.settings);
  };

  const resetBuilder = () => {
    setStructuredMode(false);
    setFiltersOpen(false);
    setPopulation("");
    setIntervention("");
    setComparator("");
    setOutcomes("");
    setBiomarker("");
    setLineOfTherapy("");
    setStudyTypes([]);
    setEndpoints([]);
    setTrialPhases([]);
    setRecruitmentStatus(["Recruiting"]);
    setRegions([]);
    setRecruitingInPortugalOnly(true);
    setRecency("any");
    setDetailLevel("detailed");
    setLanguagePreference("pt");
    setEvidenceMode("balanced");
  };

  const buildStructuredLines = (settings = null) => {
    const source = settings || buildSearchSettingsSnapshot();
    if (!source.structuredMode) return [];
    const lines = [];

    if (source.population.trim()) lines.push(`População: ${source.population.trim()}`);
    if (source.biomarker.trim()) lines.push(`Biomarcador: ${source.biomarker.trim()}`);
    if (source.lineOfTherapy.trim()) lines.push(`Linha de terapia: ${source.lineOfTherapy.trim()}`);
    if (source.intervention.trim()) lines.push(`Intervenção: ${source.intervention.trim()}`);
    if (source.comparator.trim()) lines.push(`Comparador: ${source.comparator.trim()}`);
    if (source.outcomes.trim()) lines.push(`Desfechos: ${source.outcomes.trim()}`);

    if (source.studyTypes.length > 0) {
      lines.push(`Tipos de estudo: ${source.studyTypes.join(", ")}`);
    }
    if (source.trialPhases.length > 0) {
      lines.push(`Fase do ensaio: ${source.trialPhases.join(", ")}`);
    }
    if (source.regions.length > 0) {
      lines.push(`Geografia: ${source.regions.join(", ")}`);
    }
    if (source.endpoints.length > 0) {
      lines.push(`Endpoints principais: ${source.endpoints.join(", ")}`);
    }

    const selectedRecencyLabel = RECENCY_OPTIONS.find((option) => option.value === source.recency)?.label;
    if (selectedRecencyLabel) lines.push(`Preferência de recência: ${selectedRecencyLabel}`);

    const selectedDetailLabel = DEPTH_OPTIONS.find((option) => option.value === source.detailLevel)?.label;
    if (selectedDetailLabel) lines.push(`Profundidade: ${selectedDetailLabel}`);

    const selectedLanguageLabel = LANGUAGE_OPTIONS.find((option) => option.value === source.languagePreference)?.label;
    if (selectedLanguageLabel) lines.push(`Preferência de idioma: ${selectedLanguageLabel}`);

    const selectedEvidenceModeLabel = EVIDENCE_MODE_OPTIONS.find((option) => option.value === source.evidenceMode)?.label;
    if (selectedEvidenceModeLabel) lines.push(`Modo de evidência: ${selectedEvidenceModeLabel}`);

    lines.push("Por favor, forneça sinais de ensaios e força comparativa da evidência.");
    return lines;
  };

  return (
    <div className="sc-app-layout">
      <Toaster />

      {/* Mobile sidebar overlay */}
      {sidebarOpen && <div className="sc-sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

      {/* Light sidebar */}
      <aside className={`sc-sidebar ${sidebarOpen ? "open" : ""} ${sidebarCollapsed ? "collapsed" : ""}`}>
        <div className="sc-sidebar-header">
          <div className="sc-sidebar-logo"><img src={appLogo} alt="SilverCancer" className="w-full h-full rounded-lg object-cover" /></div>
          <span className="sc-sidebar-brand">SilverCancer</span>
          <button className="sc-sidebar-close" onClick={() => setSidebarOpen(false)}><X className="w-4 h-4" /></button>
        </div>

        <button className="sc-sidebar-new-chat" onClick={() => { handleNewChat(); setSidebarOpen(false); }}>
          <Plus className="w-4 h-4" /> <span className="sc-sidebar-item-text-label">Nova pesquisa</span>
        </button>

        <div className="sc-sidebar-divider" />

        <div className="sc-sidebar-search">
          <Search className="w-3.5 h-3.5" />
          <input
            placeholder="Pesquisar conversas..."
            value={sidebarSearch}
            onChange={(e) => setSidebarSearch(e.target.value)}
            className="sc-sidebar-search-input"
          />
        </div>

        <nav className="sc-sidebar-nav">
          <h4 className="sc-sidebar-section-title">Conversas</h4>
          {conversations.length === 0 ? (
            <p className="sc-sidebar-empty">As suas conversas aparecerão aqui</p>
          ) : (
            conversations.filter((c) => !sidebarSearch || (c.title || "").toLowerCase().includes(sidebarSearch.toLowerCase())).map((conv) => (
              <div key={conv.id} className={`sc-sidebar-item ${activeConversationId === conv.id ? "sc-sidebar-item-active" : ""}`}>
                <Clock3 className="w-3.5 h-3.5 sc-sidebar-item-icon flex-shrink-0" style={{color: 'var(--sc-text-tertiary)'}} />
                <div className="sc-sidebar-item-text" onClick={() => { loadConversation(conv); setSidebarOpen(false); }}>{conv.title || "Sem título"}</div>
                <div className="sc-sidebar-item-actions">
                  <button onClick={() => deleteConversation(conv.id)} title="Eliminar"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            ))
          )}

          {watchlist.length > 0 && (
            <>
              <div className="sc-sidebar-divider" style={{ margin: "8px 4px" }} />
              <h4 className="sc-sidebar-section-title">Pesquisas guardadas</h4>
              {watchlist.map((item) => (
                <div key={item.id} className="sc-sidebar-item">
                  <BookmarkPlus className="w-3.5 h-3.5 sc-sidebar-item-icon flex-shrink-0" style={{color: 'var(--sc-text-tertiary)'}} />
                  <div className="sc-sidebar-item-text" onClick={() => { loadWatchItem(item); setSidebarOpen(false); }}>{item.question}</div>
                  <div className="sc-sidebar-item-actions">
                    <button onClick={() => { runWatchItem(item); setSidebarOpen(false); }} title="Executar"><Play className="w-3.5 h-3.5" /></button>
                    <button onClick={() => removeWatchItem(item.id)} title="Eliminar"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              ))}
            </>
          )}
        </nav>

        <div className="sc-sidebar-disclaimer">
          <div className="sc-sidebar-disclaimer-icon">&#9888;</div>
          <p>Apenas para fins de investigação e educação. Não substitui o julgamento clínico. Verifique todos os dados antes de decisões clínicas.</p>
        </div>

        <button className="sc-sidebar-logout" onClick={logout}>
          <LogOut className="w-4 h-4" /> <span className="sc-sidebar-item-text-label">Terminar sessão</span>
        </button>

        <button className="sc-sidebar-collapse-toggle" onClick={() => setSidebarCollapsed(c => !c)}>
          {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </aside>

      {/* Chat main area */}
      <div className="sc-chat-main">
        {/* Header */}
        <header className="sc-chat-header">
          <button className="sc-mobile-menu-toggle" onClick={() => setSidebarOpen(true)}><Menu className="w-5 h-5" /></button>
          <div className="sc-chat-header-brand">
            <div className="sc-header-logo"><img src={appLogo} alt="SilverCancer" className="w-full h-full rounded-lg object-cover" /></div>
            <span className="sc-chat-header-title">SilverCancer</span>
          </div>
          <div className="sc-chat-header-tabs">
            {viewTabs.filter(t => t.id !== "watchlist").map((tab) => (
              <button key={tab.id} type="button" onClick={() => setActiveView(tab.id)} className={`sc-header-tab ${activeView === tab.id ? "active" : ""}`}>
                {tab.label}
                {tab.count > 0 && <span className="sc-header-tab-count">{tab.count}</span>}
              </button>
            ))}
          </div>
          <div className="sc-chat-header-actions">
            {conversationStarted && (evidenceCount > 0 || trialMatchCount > 0) && (
              <button onClick={() => setSplitView(v => !v)} className={`sc-header-action sc-split-toggle-btn ${splitView ? "active" : ""}`} title="Vista dividida">
                <Columns2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button onClick={() => { setCmdkOpen(true); setCmdkQuery(""); }} className="sc-header-action sc-cmdk-trigger">
              <Search className="w-3.5 h-3.5" />
              <kbd className="sc-cmdk-kbd">Ctrl+K</kbd>
            </button>
            {conversationStarted && (
              <button onClick={handleNewChat} className="sc-header-action">
                <Plus className="w-3.5 h-3.5" /> Novo
              </button>
            )}
            <button onClick={saveCurrentSearchToWatchlist} disabled={!currentSearchQuestion} className="sc-header-action" title="Guardar pesquisa">
              <BookmarkPlus className="w-3.5 h-3.5" />
            </button>
          </div>
        </header>

        {/* Chat body */}
        <div ref={chatBodyRef} onScroll={handleChatBodyScroll} className={`sc-chat-body ${splitView && conversationStarted && (evidenceCount > 0 || trialMatchCount > 0) ? "sc-split-active" : ""}`}>
          <div className={`sc-chat-messages ${splitView && conversationStarted && (evidenceCount > 0 || trialMatchCount > 0) ? "sc-split-left" : ""}`}>

            {/* Empty state */}
            {!conversationStarted && activeView === "synthesis" && (
              <div className="sc-welcome">
                <div className="sc-welcome-icon"><img src={appLogo} alt="SilverCancer" className="w-full h-full rounded-2xl object-cover" /></div>
                <h1 className="sc-welcome-title">
                  Oncologia baseada em evidência,<br />ao seu alcance.
                </h1>
                <p className="sc-welcome-subtitle">
                  Pesquise evidência clínica, explore ensaios em recrutamento e obtenha sínteses analisadas por GRADE — tudo num só lugar.
                </p>
                <div className="sc-welcome-features">
                  <span className="sc-welcome-feature"><Search className="w-3.5 h-3.5" /> Síntese de evidência</span>
                  <span className="sc-welcome-feature"><FlaskConical className="w-3.5 h-3.5" /> Pesquisa de ensaios</span>
                  <span className="sc-welcome-feature"><BookOpen className="w-3.5 h-3.5" /> Análise GRADE</span>
                </div>
                <div className="sc-welcome-grid">
                  {QUICK_QUESTION_EXAMPLES.map((question, index) => (
                    <button key={index} className="sc-welcome-card" onClick={() => { setInput(question); inputRef.current?.focus(); }}>
                      <span className="sc-welcome-card-icon">{index < 3 ? <Search className="w-3.5 h-3.5" /> : <FlaskConical className="w-3.5 h-3.5" />}</span>
                      <span>{question}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Empty states for Evidence/Trials tabs */}
            {!conversationStarted && activeView === "evidence" && (
              <div className="sc-welcome">
                <div className="sc-welcome-icon" style={{background: 'linear-gradient(135deg, #007aff, #0055cc)'}}><FileSearch className="w-7 h-7 text-white" /></div>
                <h1 className="sc-welcome-title">Biblioteca de evidência</h1>
                <p className="sc-welcome-subtitle">Execute uma pesquisa para obter evidência do PubMed, MEDLINE e bases de dados clínicas.</p>
              </div>
            )}

            {!conversationStarted && activeView === "trials" && (
              <div className="sc-welcome">
                <div className="sc-welcome-icon" style={{background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)'}}><FlaskConical className="w-7 h-7 text-white" /></div>
                <h1 className="sc-welcome-title">Ensaios clínicos</h1>
                <p className="sc-welcome-subtitle">Pesquise diretamente ensaios em recrutamento. Experimente "EGFR NSCLC ensaios" ou "imunoterapia melanoma em recrutamento".</p>
                <div className="sc-welcome-grid" style={{maxWidth: '500px'}}>
                  {["Ensaios EGFR NSCLC em recrutamento em Portugal", "Ensaios Fase III cancro da mama HER2+", "Estudos imunoterapia melanoma em recrutamento"].map((q, i) => (
                    <button key={i} className="sc-welcome-card" onClick={() => { setInput(q); inputRef.current?.focus(); }}>
                      <span className="sc-welcome-card-icon"><FlaskConical className="w-3.5 h-3.5" /></span>
                      <span>{q}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Synthesis / Chat view */}
            {activeView === "synthesis" && conversationStarted && (
              <>
                {messages.map((message, idx) => {
                  const isLastAssistant = message.role === "assistant" && idx === messages.length - 1;
                  // Hide the streaming placeholder — typing dots + liveStreamText div handle display
                  if (isLastAssistant && message.streaming) return null;
                  return (
                    <MessageComponent
                      key={message.id}
                      message={message}
                      onCopy={() => handleMessageCopy(cleanAnswerText(message.content))}
                      onRegenerate={isLastAssistant ? handleRegenerate : undefined}
                      isLast={isLastAssistant}
                    />
                  );
                })}
                {/* Streaming response with markdown — same style as final message */}
                {liveStreamText && (
                  <div className="sc-message sc-message-assistant sc-reveal">
                    <div className="sc-msg-header">
                      <div className="sc-msg-avatar"><img src={appLogo} alt="SilverCancer" className="w-full h-full rounded-lg object-cover" /></div>
                      <span className="sc-msg-name">SilverCancer</span>
                    </div>
                    <div className="prose prose-sm max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {liveStreamText}
                      </ReactMarkdown>
                      <span className="sc-stream-cursor" aria-hidden="true">▌</span>
                    </div>
                  </div>
                )}
                {loading && !liveStreamText && (
                  <div className="sc-typing-indicator">
                    <div className="sc-typing-avatar"><img src={appLogo} alt="SilverCancer" className="w-full h-full rounded-lg object-cover" /></div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-slate-700">
                        {progressStage?.stage === "searching" ? "A pesquisar literatura no PubMed..." :
                         progressStage?.stage === "analyzing" ? progressStage.message :
                         progressStage?.stage === "generating" ? "A gerar síntese clínica..." :
                         "A analisar a sua questão..."}
                      </p>
                      <div className="sc-typing-dots">
                        <span /><span /><span />
                      </div>
                    </div>
                  </div>
                )}
                {!loading && followUpQuestions.length > 0 && (
                  <div className="sc-followups">
                    <p className="text-xs text-slate-400 mb-2">Sugestões de acompanhamento:</p>
                    <div className="flex flex-wrap gap-2">
                      {followUpQuestions.map((q, i) => (
                        <button
                          key={i}
                          className="sc-followup-chip"
                          onClick={() => { setInput(q); inputRef.current?.focus(); }}
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div ref={scrollRef} />
              </>
            )}
            {showScrollButton && conversationStarted && (
              <button className="sc-scroll-to-bottom" onClick={scrollToBottom}>
                <ChevronDown className="w-5 h-5" />
              </button>
            )}

            {/* Evidence view */}
            {activeView === "evidence" && (
              <div className="sc-result-panel sc-reveal">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="sc-kicker">Evidência</p>
                    <h3 className="text-lg font-semibold text-slate-900">Tabela de fontes</h3>
                  </div>
                  <span className="sc-badge">{evidenceCount}</span>
                </div>
                {latestEvidenceAdequacy && (
                  <div className="flex flex-wrap items-center gap-3 mb-5">
                    <div className={`sc-grade-chip sc-grade-${adequacyTone}`}>
                      <span className="sc-grade-domain">Prontidão</span>
                      <span className="sc-grade-value">{adequacyLabel}{typeof adequacyScore === "number" ? ` • Pontuação ${adequacyScore}` : ""}</span>
                    </div>
                    {adequacyReasons.length > 0 && <div className="text-xs text-slate-500">{adequacyReasons.slice(0, 2).join(" • ")}</div>}
                  </div>
                )}
                {evidenceCount === 0 ? (
                  <div className="text-sm text-slate-500">{trialRegistryEvidenceCount > 0 ? "Sem evidência PubMed/MEDLINE capturada ainda. Os resultados do registo de ensaios são mostrados no separador Ensaios." : "Sem evidência capturada ainda. Execute uma pesquisa para obter resultados."}</div>
                ) : (
                  <div className="sc-table">
                    <div className="sc-table-row sc-table-header"><span>Estudo</span><span>Fonte</span><span>Ano</span><span>ID</span></div>
                    {latestReferences.slice(0, 6).map((ref, index) => {
                      const overallGrade = getOverallGrade(ref);
                      const metrics = getMetrics(ref);
                      const sampleSize = metrics.find((m) => m.label === "N")?.value;
                      const gradeLine = [overallGrade ? `GRADE ${overallGrade}` : "", sampleSize ? `N=${sampleSize}` : ""].filter(Boolean).join(" • ");
                      return (
                        <div key={index} className="sc-table-row">
                          <div className="sc-table-cell sc-table-cell-title">
                            <a href={ref.url} target="_blank" rel="noopener noreferrer" className="group"><span className="group-hover:text-teal-700">{ref.title || `Referência ${index + 1}`}</span></a>
                            {gradeLine && <div className="text-xs sc-muted mt-1">{gradeLine}</div>}
                          </div>
                          <div className="sc-table-cell">{ref.journal || ref.publicationType || "—"}</div>
                          <div className="sc-table-cell">{ref.year || "—"}</div>
                          <div className="sc-table-cell">{getReferenceId(ref)}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Trials view */}
            {activeView === "trials" && (
              <div className="sc-result-panel sc-reveal">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="sc-kicker">Registo de ensaios</p>
                    <h3 className="text-lg font-semibold text-slate-900">Ensaios correspondentes</h3>
                    <p className="text-xs text-slate-500">
                      {trialRegistryLoading ? "A pesquisar ClinicalTrials.gov + EU CTIS..." : trialRegistryError ? `Indisponível: ${trialRegistryError}` : `ClinicalTrials.gov + EU CTIS para ${trialRegistryLocation}. ${trialRegistryScopeText}`}
                    </p>
                  </div>
                  <span className="sc-badge">{trialMatchCount}{selectedTrialCenter ? ` / ${trialMatchTotalCount}` : ""}</span>
                </div>

                {/* Center filter table */}
                {availableTrialCenters.length > 0 && !trialRegistryLoading && !trialRegistryError && (
                  <div className="sc-center-filter mb-4">
                    <div className="sc-center-filter-header flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-slate-600">Filtrar por centro</span>
                      {selectedTrialCenter && (
                        <button
                          type="button"
                          onClick={() => setSelectedTrialCenter("")}
                          className="text-xs text-teal-600 hover:text-teal-800"
                        >
                          Mostrar todos
                        </button>
                      )}
                    </div>
                    <div className="sc-center-filter-table">
                      <div className="sc-center-filter-scroll">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-slate-500 border-b border-slate-200">
                              <th className="py-1.5 px-2 font-medium">Centro</th>
                              <th className="py-1.5 px-2 font-medium">Cidade</th>
                              <th className="py-1.5 px-2 font-medium text-right">Ensaios</th>
                            </tr>
                          </thead>
                          <tbody>
                            {availableTrialCenters.map((center) => {
                              const centerKey = center.facility.trim().toLowerCase();
                              const isSelected = selectedTrialCenter.toLowerCase() === centerKey;
                              const trialCount = trialMatches.filter((t) =>
                                t.portugueseRecruitingSites.some((s) => (s.facility || "").trim().toLowerCase() === centerKey)
                              ).length;
                              return (
                                <tr
                                  key={centerKey}
                                  onClick={() => setSelectedTrialCenter(isSelected ? "" : center.facility.trim())}
                                  className={`cursor-pointer border-b border-slate-100 transition-colors ${isSelected ? "bg-teal-50 text-teal-900" : "hover:bg-slate-50"}`}
                                >
                                  <td className="py-1.5 px-2 font-medium">{center.facility}</td>
                                  <td className="py-1.5 px-2 text-slate-500">{center.city || "—"}</td>
                                  <td className="py-1.5 px-2 text-right">
                                    <span className={`inline-block min-w-[1.25rem] text-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${isSelected ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-600"}`}>
                                      {trialCount}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}

                {trialRegistryLoading ? (
                  <div className="text-sm text-slate-500">A obter ensaios correspondentes...</div>
                ) : trialRegistryError ? (
                  <div className="text-sm text-rose-600">{trialRegistryError}</div>
                ) : trialMatchCount === 0 && !selectedTrialCenter ? (
                  <div className="text-sm text-slate-500">Não foram encontrados ensaios em recrutamento. Alargue a pesquisa ou experimente um biomarcador diferente.</div>
                ) : trialMatchCount === 0 && selectedTrialCenter ? (
                  <div className="text-sm text-slate-500">Nenhum ensaio encontrado neste centro. <button type="button" onClick={() => setSelectedTrialCenter("")} className="text-teal-600 hover:underline">Mostrar todos</button></div>
                ) : filteredTrialGroupRows.length > 0 ? (
                  <div className="space-y-5">
                    {filteredTrialGroupRows.map((group, gi) => (
                      <div key={`grp-${gi}`}>
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-sm font-semibold text-slate-800">{group.condition}</span>
                          <span className="sc-stage-chip" data-stage={group.stage}>{group.stageLabel}</span>
                          <span className="text-xs text-slate-400">({group.trials.length})</span>
                        </div>
                        <div className="sc-trial-cards">
                          {group.trials.map((trial, index) => (
                            <div key={`${gi}-${index}`} className={`sc-trial-card${trial.questionMatch ? " sc-trial-card-flagged" : ""}`}>
                              <div className="sc-trial-card-header">
                                {trial.questionMatch && <span className="sc-trial-flag" title="Corresponde à sua questão">&#9873;</span>}
                                {trial.llmRelevance && <span className="sc-relevance-chip" data-relevance={trial.llmRelevance}>{trial.llmRelevance}</span>}
                                <div className="sc-trial-card-title">{trial.title}</div>
                              </div>
                              <div className="sc-trial-card-meta">
                                <span className="sc-trial-card-chip sc-trial-card-phase">{trial.phase}</span>
                                <span className="sc-trial-card-chip sc-stage-chip" data-stage={trial.diseaseStage}>{trial.diseaseStageLabel}</span>
                                <span className={`sc-trial-card-chip sc-status sc-status-${getStatusClass(trial.status)}`}>{trial.status}</span>
                              </div>
                              {(trial.interventionSummary || trial.armsSummary) && <div className="sc-trial-card-row"><span className="sc-trial-card-label">Intervenção</span><span className="sc-trial-card-value"><TrialExpandableText text={[trial.interventionSummary, trial.armsSummary].filter(Boolean).join(' — ')} /></span></div>}
                              {trial.llmReason && <div className="sc-trial-card-row"><span className="sc-trial-card-label">Correspondência</span><span className="sc-trial-card-value sc-trial-card-match-reason"><TrialExpandableText text={trial.llmReason} /></span></div>}
                              {trial.briefSummary && <div className="sc-trial-card-row"><span className="sc-trial-card-label">Resumo</span><span className="sc-trial-card-value sc-trial-card-brief"><TrialExpandableText text={trial.briefSummary} previewLen={200} /></span></div>}
                              {(trial.siteSummary || trial.portugueseRecruitingSites.length > 0) && <div className="sc-trial-card-row"><span className="sc-trial-card-label">Centros</span><span className="sc-trial-card-value">{trial.portugueseRecruitingSites.length > 0 ? <span className="sc-trial-sites-list">{trial.portugueseRecruitingSites.map((site, si) => <span key={si} className="sc-trial-site-name">{site.facility}{site.city ? `, ${site.city}` : ""}</span>)}</span> : trial.siteSummary}</span></div>}
                              <div className="sc-trial-card-footer">
                                {trial.sourceUrl ? <a href={trial.sourceUrl} target="_blank" rel="noopener noreferrer" className="sc-trial-card-nct">{trial.id}</a> : <span className="sc-trial-card-nct">{trial.id}</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="sc-trial-cards">
                    {filteredTrialMatches.map((trial, index) => (
                      <div key={index} className={`sc-trial-card${trial.questionMatch ? " sc-trial-card-flagged" : ""}`}>
                        <div className="sc-trial-card-header">
                          {trial.questionMatch && <span className="sc-trial-flag" title="Corresponde à sua questão">&#9873;</span>}
                          {trial.llmRelevance && <span className="sc-relevance-chip" data-relevance={trial.llmRelevance}>{trial.llmRelevance}</span>}
                          <div className="sc-trial-card-title">{trial.title}</div>
                        </div>
                        <div className="sc-trial-card-meta">
                          <span className="sc-trial-card-chip sc-trial-card-phase">{trial.phase}</span>
                          <span className="sc-trial-card-chip sc-stage-chip" data-stage={trial.diseaseStage}>{trial.diseaseStageLabel}</span>
                          <span className={`sc-trial-card-chip sc-status sc-status-${getStatusClass(trial.status)}`}>{trial.status}</span>
                        </div>
                        {(trial.interventionSummary || trial.armsSummary) && <div className="sc-trial-card-row"><span className="sc-trial-card-label">Intervenção</span><span className="sc-trial-card-value"><TrialExpandableText text={[trial.interventionSummary, trial.armsSummary].filter(Boolean).join(' — ')} /></span></div>}
                        {trial.llmReason && <div className="sc-trial-card-row"><span className="sc-trial-card-label">Correspondência</span><span className="sc-trial-card-value sc-trial-card-match-reason"><TrialExpandableText text={trial.llmReason} /></span></div>}
                        {trial.briefSummary && <div className="sc-trial-card-row"><span className="sc-trial-card-label">Resumo</span><span className="sc-trial-card-value sc-trial-card-brief"><TrialExpandableText text={trial.briefSummary} previewLen={200} /></span></div>}
                        {(trial.siteSummary || trial.portugueseRecruitingSites.length > 0) && <div className="sc-trial-card-row"><span className="sc-trial-card-label">Centros</span><span className="sc-trial-card-value">{trial.portugueseRecruitingSites.length > 0 ? <span className="sc-trial-sites-list">{trial.portugueseRecruitingSites.map((site, si) => <span key={si} className="sc-trial-site-name">{site.facility}{site.city ? `, ${site.city}` : ""}</span>)}</span> : trial.siteSummary}</span></div>}
                        <div className="sc-trial-card-footer">
                          {trial.sourceUrl ? <a href={trial.sourceUrl} target="_blank" rel="noopener noreferrer" className="sc-trial-card-nct">{trial.id}</a> : <span className="sc-trial-card-nct">{trial.id}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Approval view */}
            {activeView === "approval" && approvalCount > 0 && (
              <div className="sc-result-panel sc-reveal">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="sc-kicker">Dados de aprovação (MedInov)</p>
                    <h3 className="text-lg font-semibold text-slate-900">Aprovação INFARMED</h3>
                    <p className="text-xs text-slate-500">Dados de RAFP, PAP e ensaios pivotais para medicamentos relevantes</p>
                  </div>
                  <span className="sc-badge">{approvalCount}</span>
                </div>
                <div className="space-y-4">
                  {medinovApprovals.map((entry, idx) => (
                    <div key={idx} className="sc-approval-card">
                      <div className="sc-approval-card-header">
                        <div className="sc-approval-card-title">
                          {entry.substance}
                          <span className="sc-approval-trade-name"> ({entry.tradeName})</span>
                        </div>
                        <div className="sc-approval-card-chips">
                          <span className={`sc-approval-chip ${entry.rafpStatus === 'Deferido' ? 'sc-approval-chip-ok' : entry.rafpStatus === 'Indeferido' ? 'sc-approval-chip-no' : 'sc-approval-chip-nd'}`}>
                            RAFP: {entry.rafpStatus || 'ND'}
                          </span>
                          {entry.papStatus && entry.papStatus !== 'Não' && (
                            <span className={`sc-approval-chip ${entry.papStatus.includes('ativo') ? 'sc-approval-chip-pap' : 'sc-approval-chip-nd'}`}>
                              {entry.papStatus}
                            </span>
                          )}
                          {entry.isOral && <span className="sc-approval-chip sc-approval-chip-route">Oral</span>}
                          {entry.isEV && <span className="sc-approval-chip sc-approval-chip-route">EV</span>}
                        </div>
                      </div>
                      <div className="sc-approval-card-body">
                        <div className="sc-approval-row">
                          <span className="sc-approval-label">Indicação</span>
                          <span className="sc-approval-value">{entry.indication}{entry.indicationComplement ? ` — ${entry.indicationComplement}` : ''}</span>
                        </div>
                        <div className="sc-approval-row">
                          <span className="sc-approval-label">Patologia</span>
                          <span className="sc-approval-value">{entry.pathology} ({entry.clinicGroup})</span>
                        </div>
                        {entry.linesOfTherapy.length > 0 && (
                          <div className="sc-approval-row">
                            <span className="sc-approval-label">Linhas</span>
                            <span className="sc-approval-value">
                              {entry.linesOfTherapy.map((line) => (
                                <span key={line} className="sc-approval-line-chip">{line}</span>
                              ))}
                            </span>
                          </div>
                        )}
                        {entry.therapyIntent.length > 0 && (
                          <div className="sc-approval-row">
                            <span className="sc-approval-label">Intuito</span>
                            <span className="sc-approval-value">{entry.therapyIntent.join(', ')}</span>
                          </div>
                        )}
                        {entry.biomarkers.length > 0 && (
                          <div className="sc-approval-row">
                            <span className="sc-approval-label">Biomarcadores</span>
                            <span className="sc-approval-value">{entry.biomarkers.join(', ')}</span>
                          </div>
                        )}
                        {(entry.dataEPAR || entry.dataRCM) && (
                          <div className="sc-approval-row">
                            <span className="sc-approval-label">Datas</span>
                            <span className="sc-approval-value">
                              {entry.dataEPAR ? `EPAR: ${entry.dataEPAR}` : ''}
                              {entry.dataEPAR && entry.dataRCM ? ' | ' : ''}
                              {entry.dataRCM ? `RCM: ${entry.dataRCM}` : ''}
                            </span>
                          </div>
                        )}
                        {entry.lab && (
                          <div className="sc-approval-row">
                            <span className="sc-approval-label">Laboratório</span>
                            <span className="sc-approval-value">{entry.lab}</span>
                          </div>
                        )}

                        {entry.trialEvidence && (
                          <div className="sc-approval-trial">
                            <div className="sc-approval-trial-header">
                              <span className="sc-approval-label">Ensaio pivotal</span>
                              <span className="sc-approval-trial-name">{entry.trialEvidence.name} (Fase {entry.trialEvidence.phase})</span>
                            </div>
                            {entry.trialEvidence.patientDescription && (
                              <div className="sc-approval-trial-patients">{entry.trialEvidence.patientDescription}</div>
                            )}
                            {entry.trialEvidence.arms.length > 0 && (
                              <div className="sc-approval-arms-table">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="text-left text-slate-500 border-b border-slate-200">
                                      <th className="py-1 px-2 font-medium">Braço</th>
                                      <th className="py-1 px-2 font-medium">Descrição</th>
                                      <th className="py-1 px-2 font-medium text-right">OS (meses)</th>
                                      <th className="py-1 px-2 font-medium text-right">PFS (meses)</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {entry.trialEvidence.arms.map((arm) => (
                                      <tr key={arm.label} className="border-b border-slate-100">
                                        <td className="py-1 px-2 font-semibold">{arm.label}</td>
                                        <td className="py-1 px-2">{arm.description}</td>
                                        <td className="py-1 px-2 text-right font-mono">{arm.osMonths || '—'}</td>
                                        <td className="py-1 px-2 text-right font-mono">{arm.pfsMonths || '—'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                            <div className="sc-approval-trial-meta">
                              {entry.trialEvidence.nct && (
                                <a href={`https://clinicaltrials.gov/study/${entry.trialEvidence.nct}`} target="_blank" rel="noopener noreferrer" className="text-teal-600 hover:text-teal-800">{entry.trialEvidence.nct}</a>
                              )}
                              {entry.trialEvidence.nPatients && <span>N={entry.trialEvidence.nPatients}</span>}
                              {entry.trialEvidence.status && <span>{entry.trialEvidence.status}</span>}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>

          {/* Split right pane */}
          {splitView && conversationStarted && (evidenceCount > 0 || trialMatchCount > 0) && (
            <div className="sc-split-right">
              <div className="sc-split-right-tabs">
                <button className={`sc-split-tab ${splitRightTab === "evidence" ? "active" : ""}`} onClick={() => setSplitRightTab("evidence")}>Evidência ({evidenceCount})</button>
                <button className={`sc-split-tab ${splitRightTab === "trials" ? "active" : ""}`} onClick={() => setSplitRightTab("trials")}>Ensaios ({trialMatchCount})</button>
              </div>

              {splitRightTab === "evidence" && (
                <div className="sc-split-panel-content">
                  {latestEvidenceAdequacy && (
                    <div className="flex flex-wrap items-center gap-3 mb-4">
                      <div className={`sc-grade-chip sc-grade-${adequacyTone}`}>
                        <span className="sc-grade-domain">Prontidão</span>
                        <span className="sc-grade-value">{adequacyLabel}{typeof adequacyScore === "number" ? ` • Pontuação ${adequacyScore}` : ""}</span>
                      </div>
                    </div>
                  )}
                  {evidenceCount === 0 ? (
                    <div className="text-sm text-slate-500">Sem evidência capturada ainda.</div>
                  ) : (
                    <div className="sc-table">
                      <div className="sc-table-row sc-table-header"><span>Estudo</span><span>Fonte</span><span>Ano</span><span>ID</span></div>
                      {latestReferences.slice(0, 6).map((ref, index) => {
                        const overallGrade = getOverallGrade(ref);
                        const metrics = getMetrics(ref);
                        const sampleSize = metrics.find((m) => m.label === "N")?.value;
                        const gradeLine = [overallGrade ? `GRADE ${overallGrade}` : "", sampleSize ? `N=${sampleSize}` : ""].filter(Boolean).join(" • ");
                        return (
                          <div key={index} className="sc-table-row">
                            <div className="sc-table-cell sc-table-cell-title">
                              <a href={ref.url} target="_blank" rel="noopener noreferrer" className="group"><span className="group-hover:text-teal-700">{ref.title || `Referência ${index + 1}`}</span></a>
                              {gradeLine && <div className="text-xs sc-muted mt-1">{gradeLine}</div>}
                            </div>
                            <div className="sc-table-cell">{ref.journal || ref.publicationType || "—"}</div>
                            <div className="sc-table-cell">{ref.year || "—"}</div>
                            <div className="sc-table-cell">{getReferenceId(ref)}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {splitRightTab === "trials" && (
                <div className="sc-split-panel-content">
                  {trialRegistryLoading ? (
                    <div className="text-sm text-slate-500">A obter ensaios correspondentes...</div>
                  ) : trialMatchCount === 0 ? (
                    <div className="text-sm text-slate-500">Não foram encontrados ensaios em recrutamento.</div>
                  ) : (
                    <div className="sc-trial-cards sc-trial-cards-compact">
                      {filteredTrialMatches.slice(0, 8).map((trial, index) => (
                        <div key={index} className={`sc-trial-card${trial.questionMatch ? " sc-trial-card-flagged" : ""}`}>
                          <div className="sc-trial-card-header">
                            {trial.llmRelevance && <span className="sc-relevance-chip" data-relevance={trial.llmRelevance}>{trial.llmRelevance}</span>}
                            <div className="sc-trial-card-title">{trial.title}</div>
                          </div>
                          <div className="sc-trial-card-meta">
                            <span className="sc-trial-card-chip sc-trial-card-phase">{trial.phase}</span>
                            <span className="sc-trial-card-chip sc-stage-chip" data-stage={trial.diseaseStage}>{trial.diseaseStageLabel}</span>
                          </div>
                          {trial.interventionSummary && <div className="sc-trial-card-row"><span className="sc-trial-card-label">Intervenção</span><span className="sc-trial-card-value">{trial.interventionSummary}</span></div>}
                          <div className="sc-trial-card-footer">
                            {trial.sourceUrl ? <a href={trial.sourceUrl} target="_blank" rel="noopener noreferrer" className="sc-trial-card-nct">{trial.id}</a> : <span className="sc-trial-card-nct">{trial.id}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bottom input area */}
        <div className="sc-chat-input-area">
          <div className="sc-chat-input-container">

            {/* Filter drawer */}
            {filtersOpen && (
              <div className="sc-filter-drawer sc-reveal">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-sm font-semibold text-slate-900">Filtros clínicos</h4>
                  <div className="flex items-center gap-2">
                    {activeFilterCount > 0 && <button type="button" onClick={resetBuilder} className="text-xs text-slate-500 hover:text-slate-700">Limpar</button>}
                    <button type="button" onClick={() => setFiltersOpen(false)} className="text-xs text-slate-500 hover:text-slate-700"><X className="w-4 h-4" /></button>
                  </div>
                </div>
                <div className="sc-filter-form">
                  <div><label className="text-xs font-semibold text-slate-600">População</label><input type="text" value={population} onChange={(e) => setPopulation(e.target.value)} placeholder="ex., TNBC metastático" className="sc-input mt-1" /></div>
                  <div><label className="text-xs font-semibold text-slate-600">Biomarcador</label><input type="text" value={biomarker} onChange={(e) => setBiomarker(e.target.value)} placeholder="ex., EGFR, HER2-low" className="sc-input mt-1" /></div>
                  <div><label className="text-xs font-semibold text-slate-600">Intervenção</label><input type="text" value={intervention} onChange={(e) => setIntervention(e.target.value)} placeholder="ex., pembrolizumab + quimio" className="sc-input mt-1" /></div>
                  <div><label className="text-xs font-semibold text-slate-600">Comparador</label><input type="text" value={comparator} onChange={(e) => setComparator(e.target.value)} placeholder="ex., dupleto de platina" className="sc-input mt-1" /></div>
                  <div className="sc-filter-full">
                    <p className="text-xs font-semibold text-slate-600 mb-2">Tipos de estudo</p>
                    <div className="flex flex-wrap gap-2">
                      {STUDY_TYPE_OPTIONS.map((o) => (<button key={o.value} type="button" onClick={() => toggleSelection(o.value, studyTypes, setStudyTypes)} className={`sc-chip ${studyTypes.includes(o.value) ? "active" : ""}`}>{o.label}</button>))}
                    </div>
                  </div>
                  <div className="sc-filter-full">
                    <p className="text-xs font-semibold text-slate-600 mb-2">Endpoints</p>
                    <div className="flex flex-wrap gap-2">
                      {ENDPOINT_OPTIONS.map((o) => (<button key={o.value} type="button" onClick={() => toggleSelection(o.value, endpoints, setEndpoints)} className={`sc-chip ${endpoints.includes(o.value) ? "active" : ""}`}>{o.label}</button>))}
                    </div>
                  </div>
                  <div className="sc-filter-selects sc-filter-full">
                    <div><label className="text-xs font-semibold text-slate-600">Recência</label><select value={recency} onChange={(e) => setRecency(e.target.value)} className="sc-input mt-1">{RECENCY_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}</select></div>
                    <div><label className="text-xs font-semibold text-slate-600">Idioma</label><select value={languagePreference} onChange={(e) => setLanguagePreference(e.target.value)} className="sc-input mt-1">{LANGUAGE_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}</select></div>
                    <div><label className="text-xs font-semibold text-slate-600">Profundidade</label><select value={detailLevel} onChange={(e) => setDetailLevel(e.target.value)} className="sc-input mt-1">{DEPTH_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}</select></div>
                  </div>
                </div>
              </div>
            )}

            {/* Active filter pills (when drawer is closed) */}
            {!filtersOpen && activeFilterCount > 0 && (
              <div className="sc-filter-pill-bar">
                {activeFilterPills.slice(0, 5).map((item) => (
                  <span key={`${item.label}-${item.value}`} className="sc-filter-pill"><span className="sc-filter-pill-key">{item.label}</span><span className="sc-filter-pill-value">{item.value}</span></span>
                ))}
              </div>
            )}

            {/* Search mode hint */}
            <div className="sc-input-mode-bar">
              <span className="sc-input-mode-hint">
                {detectTrialIntent(input) ? (
                  <><FlaskConical className="w-3 h-3" /> Pesquisa de ensaios detetada</>
                ) : input.trim() ? (
                  <><Search className="w-3 h-3" /> Pesquisa de evidência</>
                ) : null}
              </span>
              <div className="sc-input-mode-actions">
                <button type="button" className={`sc-mode-pill ${filtersOpen ? "active" : ""}`} onClick={() => { if (!structuredMode) setStructuredMode(true); setFiltersOpen((o) => !o); }}>
                  <SlidersHorizontal className="w-3 h-3" />
                  Filtros
                  {activeFilterCount > 0 && <span className="sc-filter-count">{activeFilterCount}</span>}
                </button>
                <button type="button" className="sc-mode-pill" onClick={saveCurrentSearchToWatchlist} disabled={!currentSearchQuestion}>
                  <BookmarkPlus className="w-3 h-3" />
                  Guardar
                </button>
              </div>
            </div>

            {/* Input form */}
            <form onSubmit={handleSend} className="sc-chat-form">
              <div className="sc-chat-input-wrap">
                <textarea
                  ref={inputRef}
                  placeholder={activeView === "trials" ? "Pesquisar ensaios clínicos... ex. EGFR NSCLC em recrutamento" : "Faça uma pergunta de oncologia..."}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  onInput={(e) => { e.target.style.height = "44px"; e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px"; }}
                  autoComplete="off"
                  disabled={loading}
                />
                <div className="sc-input-toolbar">
                  <button
                    type="button"
                    className={`sc-detail-toggle${detailLevel === "detailed" ? " sc-detail-toggle--on" : ""}`}
                    onClick={() => setDetailLevel(d => d === "detailed" ? "executive" : "detailed")}
                    title={detailLevel === "detailed" ? "Resposta detalhada activa — clique para resposta rápida" : "Resposta rápida activa — clique para resposta detalhada"}
                  >
                    <Sparkles className="w-3 h-3" />
                    {detailLevel === "detailed" ? "Detalhado" : "Rápido"}
                  </button>
                </div>
              </div>
              {loading ? (
                <button type="button" className="sc-stop-button" onClick={handleStop} title="Parar geração">
                  <Square className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button type="submit" className="sc-send-button" disabled={!input.trim()}>
                  <ArrowUp className="w-4 h-4" />
                </button>
              )}
              <span className="sc-input-hint">Enter para enviar · Shift+Enter para nova linha</span>
            </form>
          </div>
        </div>
      </div>

      {/* Command palette */}
      {cmdkOpen && (
        <div className="sc-cmdk-overlay" onClick={() => setCmdkOpen(false)}>
          <div className="sc-cmdk" onClick={e => e.stopPropagation()}>
            <div className="sc-cmdk-input-wrap">
              <Search className="w-4 h-4" />
              <input
                autoFocus
                placeholder="Pesquisar consultas guardadas ou escrever uma nova pergunta..."
                value={cmdkQuery}
                onChange={e => setCmdkQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && cmdkQuery.trim()) {
                    setInput(cmdkQuery.trim());
                    setCmdkOpen(false);
                    inputRef.current?.focus();
                  }
                }}
                className="sc-cmdk-input"
              />
              <kbd className="sc-cmdk-kbd">ESC</kbd>
            </div>
            <div className="sc-cmdk-list">
              <div className="sc-cmdk-group-title">Ações rápidas</div>
              <button className="sc-cmdk-item" onClick={() => { handleNewChat(); setCmdkOpen(false); }}>
                <Plus className="w-4 h-4" /> Nova pesquisa
              </button>
              <button className="sc-cmdk-item" onClick={() => { setActiveView("evidence"); setCmdkOpen(false); }}>
                <FileSearch className="w-4 h-4" /> Ver evidência
              </button>
              <button className="sc-cmdk-item" onClick={() => { setActiveView("trials"); setCmdkOpen(false); }}>
                <FlaskConical className="w-4 h-4" /> Ver ensaios
              </button>
              {watchlist.length > 0 && (
                <>
                  <div className="sc-cmdk-group-title">Pesquisas guardadas</div>
                  {watchlist
                    .filter(item => !cmdkQuery || item.question.toLowerCase().includes(cmdkQuery.toLowerCase()))
                    .slice(0, 5)
                    .map(item => (
                      <button key={item.id} className="sc-cmdk-item" onClick={() => { loadWatchItem(item); setCmdkOpen(false); }}>
                        <BookmarkPlus className="w-4 h-4" /> {item.question}
                      </button>
                    ))
                  }
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Error toast */}
      {error && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 sc-panel p-4 border border-red-200 flex items-center gap-4 shadow-xl z-50 max-w-lg">
          <div className="w-8 h-8 rounded-lg bg-red-500 text-white flex items-center justify-center font-bold text-sm">!</div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-red-800">Erro</p>
            <p className="text-xs text-red-700">{error}</p>
          </div>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700"><X className="w-4 h-4" /></button>
        </div>
      )}
    </div>
  );
};

export default SimpleChat;
