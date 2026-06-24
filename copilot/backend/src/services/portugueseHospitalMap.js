// ---------------------------------------------------------------------------
// Portuguese Hospital Normalization Map
//
// Maps the messy facility names from ClinicalTrials.gov / EU CTIS to
// canonical hospital names. Only real hospitals/clinical centers are included.
// Research-only sites, universities, pharma offices, anonymous sites, and
// non-hospital facilities are filtered out.
// ---------------------------------------------------------------------------

/**
 * Canonical hospital entries.
 * Each key is a unique hospital ID used internally.
 */
export const PORTUGUESE_HOSPITALS = {
  // ── IPOs (Institutos Portugueses de Oncologia) ────────────────────────
  'ipo-lisboa': {
    canonical: 'IPO Lisboa',
    fullName: 'Instituto Português de Oncologia de Lisboa Francisco Gentil',
    city: 'Lisboa',
    type: 'oncology'
  },
  'ipo-porto': {
    canonical: 'IPO Porto',
    fullName: 'Instituto Português de Oncologia do Porto Francisco Gentil',
    city: 'Porto',
    type: 'oncology'
  },
  'ipo-coimbra': {
    canonical: 'IPO Coimbra',
    fullName: 'Instituto Português de Oncologia de Coimbra Francisco Gentil',
    city: 'Coimbra',
    type: 'oncology'
  },

  // ── Lisbon hospitals ──────────────────────────────────────────────────
  'h-santa-maria': {
    canonical: 'Hospital de Santa Maria (ULS Santa Maria)',
    fullName: 'Hospital de Santa Maria - ULS de Santa Maria',
    city: 'Lisboa',
    type: 'public'
  },
  'h-pulido-valente': {
    canonical: 'Hospital Pulido Valente (ULS Santa Maria)',
    fullName: 'Hospital Pulido Valente - ULS de Santa Maria',
    city: 'Lisboa',
    type: 'public'
  },
  'h-sao-jose': {
    canonical: 'Hospital de São José (ULS São José)',
    fullName: 'Hospital de São José - ULS São José',
    city: 'Lisboa',
    type: 'public'
  },
  'h-capuchos': {
    canonical: 'Hospital Santo António dos Capuchos (ULS São José)',
    fullName: 'Hospital de Santo António dos Capuchos - ULS São José',
    city: 'Lisboa',
    type: 'public'
  },
  'h-egas-moniz': {
    canonical: 'Hospital Egas Moniz (ULS Lisboa Ocidental)',
    fullName: 'Hospital Egas Moniz - ULS Lisboa Ocidental',
    city: 'Lisboa',
    type: 'public'
  },
  'h-sfx': {
    canonical: 'Hospital de São Francisco Xavier (ULS Lisboa Ocidental)',
    fullName: 'Hospital de São Francisco Xavier - ULS Lisboa Ocidental',
    city: 'Lisboa',
    type: 'public'
  },
  'h-santa-marta': {
    canonical: 'Hospital de Santa Marta (ULS São José)',
    fullName: 'Hospital de Santa Marta - ULS São José',
    city: 'Lisboa',
    type: 'public'
  },
  'h-fernando-fonseca': {
    canonical: 'Hospital Prof. Dr. Fernando Fonseca (ULS Amadora/Sintra)',
    fullName: 'Hospital Prof. Dr. Fernando Fonseca - ULS Amadora/Sintra',
    city: 'Amadora',
    type: 'public'
  },
  'h-garcia-orta': {
    canonical: 'Hospital Garcia de Orta (ULS Almada-Seixal)',
    fullName: 'Hospital Garcia de Orta - ULS Almada-Seixal',
    city: 'Almada',
    type: 'public'
  },
  'h-beatriz-angelo': {
    canonical: 'Hospital Beatriz Ângelo (ULS Loures-Odivelas)',
    fullName: 'Hospital Beatriz Ângelo - ULS Loures-Odivelas',
    city: 'Loures',
    type: 'public'
  },
  'h-vila-franca': {
    canonical: 'Hospital de Vila Franca de Xira',
    fullName: 'Hospital de Vila Franca de Xira',
    city: 'Vila Franca de Xira',
    type: 'public'
  },
  'h-cascais': {
    canonical: 'Hospital de Cascais',
    fullName: 'Hospital de Cascais Dr. José de Almeida',
    city: 'Cascais',
    type: 'public'
  },
  'champalimaud': {
    canonical: 'Fundação Champalimaud',
    fullName: 'Fundação Champalimaud - Centro Clínico',
    city: 'Lisboa',
    type: 'private'
  },
  'h-cuf-descobertas': {
    canonical: 'Hospital CUF Descobertas',
    fullName: 'Hospital CUF Descobertas',
    city: 'Lisboa',
    type: 'private'
  },
  'h-cuf-tejo': {
    canonical: 'Hospital CUF Tejo',
    fullName: 'Hospital CUF Tejo',
    city: 'Lisboa',
    type: 'private'
  },
  'h-luz-lisboa': {
    canonical: 'Hospital da Luz Lisboa',
    fullName: 'Hospital da Luz Lisboa',
    city: 'Lisboa',
    type: 'private'
  },
  'h-lusiadas-lisboa': {
    canonical: 'Hospital Lusíadas Lisboa',
    fullName: 'Hospital Lusíadas Lisboa',
    city: 'Lisboa',
    type: 'private'
  },
  'h-cruz-vermelha': {
    canonical: 'Hospital da Cruz Vermelha',
    fullName: 'Hospital da Cruz Vermelha Portuguesa',
    city: 'Lisboa',
    type: 'private'
  },
  'start-lisboa': {
    canonical: 'START Lisboa (Hospital de Santa Maria)',
    fullName: 'START Lisboa - Centro de Ensaios Clínicos',
    city: 'Lisboa',
    type: 'research'
  },

  // ── Porto hospitals ───────────────────────────────────────────────────
  'h-sao-joao': {
    canonical: 'Hospital de São João (ULS São João)',
    fullName: 'Hospital de São João - ULS São João',
    city: 'Porto',
    type: 'public'
  },
  'h-santo-antonio': {
    canonical: 'Hospital de Santo António (ULS Santo António)',
    fullName: 'Hospital Geral de Santo António - ULS Santo António',
    city: 'Porto',
    type: 'public'
  },
  'h-cuf-porto': {
    canonical: 'Hospital CUF Porto',
    fullName: 'Hospital CUF Porto',
    city: 'Porto',
    type: 'private'
  },
  'h-lusiadas-porto': {
    canonical: 'Hospital Lusíadas Porto',
    fullName: 'Hospital Lusíadas Porto',
    city: 'Porto',
    type: 'private'
  },

  // ── Coimbra hospitals ─────────────────────────────────────────────────
  'chuc': {
    canonical: 'CHUC - Hospital Universitário de Coimbra',
    fullName: 'Centro Hospitalar e Universitário de Coimbra',
    city: 'Coimbra',
    type: 'public'
  },

  // ── Braga hospitals ───────────────────────────────────────────────────
  'h-braga': {
    canonical: 'Hospital de Braga (ULS Braga)',
    fullName: 'Hospital de Braga - ULS Braga',
    city: 'Braga',
    type: 'public'
  },

  // ── Vila Nova de Gaia ─────────────────────────────────────────────────
  'h-gaia': {
    canonical: 'Hospital de Gaia/Espinho (ULS Gaia/Espinho)',
    fullName: 'Hospital Eduardo Santos Silva - ULS Gaia/Espinho',
    city: 'Vila Nova de Gaia',
    type: 'public'
  },

  // ── Matosinhos ────────────────────────────────────────────────────────
  'h-pedro-hispano': {
    canonical: 'Hospital Pedro Hispano (ULS Matosinhos)',
    fullName: 'Hospital Pedro Hispano - ULS Matosinhos',
    city: 'Matosinhos',
    type: 'public'
  },

  // ── Guimarães ─────────────────────────────────────────────────────────
  'h-guimaraes': {
    canonical: 'Hospital da Sra. da Oliveira Guimarães (ULS Alto Ave)',
    fullName: 'Hospital da Senhora da Oliveira Guimarães - ULS Alto Ave',
    city: 'Guimarães',
    type: 'public'
  },

  // ── Vila Real / TMAD ──────────────────────────────────────────────────
  'h-tmad': {
    canonical: 'ULS Trás-os-Montes e Alto Douro',
    fullName: 'ULS Trás-os-Montes e Alto Douro',
    city: 'Vila Real',
    type: 'public'
  },

  // ── Algarve ───────────────────────────────────────────────────────────
  'h-faro': {
    canonical: 'ULS Algarve (Faro)',
    fullName: 'ULS do Algarve - Hospital de Faro',
    city: 'Faro',
    type: 'public'
  },
  'h-portimao': {
    canonical: 'ULS Algarve (Portimão)',
    fullName: 'ULS do Algarve - Hospital de Portimão',
    city: 'Portimão',
    type: 'public'
  },

  // ── Aveiro ────────────────────────────────────────────────────────────
  'h-aveiro': {
    canonical: 'Hospital Infante D. Pedro (ULS Baixo Vouga)',
    fullName: 'Hospital Infante D. Pedro - ULS Baixo Vouga',
    city: 'Aveiro',
    type: 'public'
  },

  // ── Setúbal ───────────────────────────────────────────────────────────
  'h-setubal': {
    canonical: 'ULS Arrábida (Setúbal)',
    fullName: 'ULS de Arrábida',
    city: 'Setúbal',
    type: 'public'
  },

  // ── Guarda ────────────────────────────────────────────────────────────
  'h-guarda': {
    canonical: 'Hospital Sousa Martins (ULS Guarda)',
    fullName: 'Hospital Sousa Martins - ULS da Guarda',
    city: 'Guarda',
    type: 'public'
  },

  // ── Funchal (Madeira) ─────────────────────────────────────────────────
  'h-funchal': {
    canonical: 'Hospital Dr. Nélio Mendonça (Funchal)',
    fullName: 'Hospital Dr. Nélio Mendonça',
    city: 'Funchal',
    type: 'public'
  },

  // ── Leiria / Torres Novas ─────────────────────────────────────────────
  'h-torres-novas': {
    canonical: 'Hospital Rainha Santa Isabel (ULS Médio Tejo)',
    fullName: 'Hospital Rainha Santa Isabel - ULS Médio Tejo',
    city: 'Torres Novas',
    type: 'public'
  },

  // ── Santa Maria da Feira ──────────────────────────────────────────────
  'h-feira': {
    canonical: 'Hospital de São Sebastião (ULS Entre Douro e Vouga)',
    fullName: 'Hospital de São Sebastião - ULS Entre Douro e Vouga',
    city: 'Santa Maria da Feira',
    type: 'public'
  },

  // ── Viana do Castelo ──────────────────────────────────────────────────
  'h-viana': {
    canonical: 'ULS Alto Minho',
    fullName: 'ULS Alto Minho - Hospital Conde de Bertiandos',
    city: 'Viana do Castelo',
    type: 'public'
  },

  // ── Amadora (Lusíadas) ────────────────────────────────────────────────
  'h-lusiadas-amadora': {
    canonical: 'Hospital Lusíadas Amadora',
    fullName: 'Hospital Lusíadas Amadora',
    city: 'Amadora',
    type: 'private'
  },

  // ── Luz Setúbal ───────────────────────────────────────────────────────
  'h-luz-setubal': {
    canonical: 'Hospital da Luz Setúbal',
    fullName: 'Hospital da Luz Setúbal',
    city: 'Setúbal',
    type: 'private'
  }
};

/**
 * Pattern-based matching rules.
 * Each entry: [regex, hospitalId]
 * Order matters — first match wins.
 */
const MATCH_RULES = [
  // ── IPO Lisboa ──────────────────────────────────────────────────────
  [/ipo\s*(?:de\s*)?lisb|ipo\s*lisb|ipolfg|instituto\s+portugu?[eê]s\s+(?:de\s+)?oncolog[iy]a?\s+(?:de\s+)?(?:lisb|losb)|oncologia.*lisb.*francisco|oncologia.*francisco.*lisb|ipofg.*crl|portuguese\s+institute.*(?:cancer|oncology).*lisbon|instituto.*oncolog.*(?:lisb|losb)|instituto.*oncolog.*francisco\s+gentil(?!.*porto)(?!.*coimbra)|instituto.*oncolog.*libosa/i, 'ipo-lisboa'],

  // ── IPO Porto ───────────────────────────────────────────────────────
  [/ipo\s*(?:de\s*|do\s*)?porto|ipo\s*:\s*instituto|ipop\s*porto|instituto\s+portugu?[eê]s\s+(?:de\s+)?oncolog[iy]a?\s+(?:de\s+|do\s+)?porto|oncologia\s+do\s+porto|inst\.?\s+portu.*onco.*porto|portuguese\s+institute.*(?:cancer|oncology).*porto|instituto.*oncolog.*porto/i, 'ipo-porto'],

  // ── IPO Coimbra ─────────────────────────────────────────────────────
  [/ipo\s*(?:de\s*)?coimbra|instituto\s+portugu?[eê]s\s+(?:de\s+)?oncolog[iy]a?\s+(?:de\s+)?coimbra|portuguese\s+institute.*(?:cancer|oncology).*coimbra|instituto.*oncolog.*coimbra/i, 'ipo-coimbra'],

  // ── Champalimaud ────────────────────────────────────────────────────
  [/champalimau[d]?|fundacao\s+champalimau|fundação\s+champalimau|cc\s*champalimau|ccab.*champalimau/i, 'champalimaud'],

  // ── START Lisboa (before Santa Maria, as it's at Santa Maria) ───────
  [/start\s+lisb/i, 'start-lisboa'],

  // ── Hospital de Santa Maria (ULS Santa Maria) ───────────────────────
  [/santa\s+maria(?!.*marta)(?!.*feira)|h\.?\s*(?:de\s+)?sta\.?\s*maria|uls\s+santa\s+maria|hospital\s+de\s+santa\s+maria|centro\s+hospitalar.*lisb.*norte(?!.*pulido)|chln(?:\s|$)|chuln(?!.*pulido)/i, 'h-santa-maria'],

  // ── Hospital Pulido Valente ─────────────────────────────────────────
  [/pulido\s*valente/i, 'h-pulido-valente'],

  // ── Hospital de São José / Curry Cabral ─────────────────────────────
  [/(?:hospital|h\.?)\s+(?:de\s+)?s[aã]o\s+jos[eé]|uls\s+s[aã]o\s+jos[eé]|chlc.*s[aã]o\s+jos[eé]|curry\s+cabral|hepato.?bili/i, 'h-sao-jose'],

  // ── Hospital Santo António dos Capuchos ─────────────────────────────
  [/capuchos|uls\s+s[aã]o\s+jos[eé].*capuchos/i, 'h-capuchos'],

  // ── Hospital Egas Moniz ─────────────────────────────────────────────
  [/egas\s*moniz/i, 'h-egas-moniz'],

  // ── Hospital de São Francisco Xavier (ULS Lisboa Ocidental) ─────────
  [/s[aã]o?\s*\.?\s+francisco\s+xavier|h\.?\s+de\s+s\.?\s+francisco\s+xavier|sfx|uls\s*l[oi]sb.*ocidental|centro\s+hospitalar.*lisb.*ocidental|ulslo|central\s+hospital.*western\s+lisbon|hospital\s+de\s+s\.\s+francisco/i, 'h-sfx'],

  // ── Hospital de Santa Marta ─────────────────────────────────────────
  [/santa\s+marta/i, 'h-santa-marta'],

  // ── Hospital Prof. Dr. Fernando Fonseca (Amadora/Sintra) ────────────
  [/fernando\s*(?:da?\s+)?fonseca|uls\s+amadora|amadora.?sintra/i, 'h-fernando-fonseca'],

  // ── Hospital Garcia de Orta (Almada) ────────────────────────────────
  [/garcia\s+de\s+orta|uls\s+almada|almada.?seixal/i, 'h-garcia-orta'],

  // ── Hospital Beatriz Ângelo (Loures) ────────────────────────────────
  [/beatriz\s+[aâ]ngelo|uls\s+loures|hospital.*loures|loures.?odivelas/i, 'h-beatriz-angelo'],

  // ── Hospital de Vila Franca de Xira ─────────────────────────────────
  [/vila\s+franca\s+de\s+xira/i, 'h-vila-franca'],

  // ── Hospital de Cascais ─────────────────────────────────────────────
  [/(?:hospital\s+(?:de\s+)?)?cascais|jos[eé]\s+(?:de\s+)?almeida/i, 'h-cascais'],

  // ── CUF Lisboa ──────────────────────────────────────────────────────
  [/cuf\s+descobertas|cuf\s+descorbertas/i, 'h-cuf-descobertas'],
  [/cuf\s*[-]?\s*tejo/i, 'h-cuf-tejo'],

  // ── Hospital da Luz Lisboa ──────────────────────────────────────────
  [/(?:hospital\s+)?(?:da\s+)?luz\s*(?:lisb|learning|sa\b|\/|$|\s*\()|hospital\s+da\s+luz(?!.*set[uú]bal)(?!.*porto)|^luz\s+hospital$/i, 'h-luz-lisboa'],

  // ── Hospital da Luz Setúbal ─────────────────────────────────────────
  [/luz.*set[uú]bal/i, 'h-luz-setubal'],

  // ── Lusíadas Lisboa ─────────────────────────────────────────────────
  [/lus[ií]adas\s+lisb|hpp.*lus[ií]adas/i, 'h-lusiadas-lisboa'],

  // ── Lusíadas Amadora ────────────────────────────────────────────────
  [/lus[ií]adas\s+amadora/i, 'h-lusiadas-amadora'],

  // ── Hospital da Cruz Vermelha ───────────────────────────────────────
  [/cruz\s+vermelha/i, 'h-cruz-vermelha'],

  // ── Hospital de São João (Porto) ────────────────────────────────────
  [/s[aã]o?\s+jo[aã]o|uls\s+s[aã]o\s+jo[aã]o|chsj|centro\s+hospitalar.*s[aã]o\s+jo[aã]o|hospital\s+s\.?\s+jo[aã]o/i, 'h-sao-joao'],

  // ── Hospital de Santo António (Porto) ───────────────────────────────
  [/santo\s+ant[oó]nio(?!.*capuchos)|uls\s+santo\s+ant[oó]nio|centro\s+hospitalar.*(?:do\s+)?porto(?!.*s[aã]o\s+jo[aã]o)|chu\s*porto/i, 'h-santo-antonio'],

  // ── CUF Porto ───────────────────────────────────────────────────────
  [/cuf\s+porto/i, 'h-cuf-porto'],

  // ── Lusíadas Porto ──────────────────────────────────────────────────
  [/lus[ií]adas\s+porto/i, 'h-lusiadas-porto'],

  // ── CHUC Coimbra ────────────────────────────────────────────────────
  [/chuc|centro\s+hospitalar.*universit[aá\u0103].*coimbra|uls\s+coimbra|unidade\s+local.*sa[uú]de.*coimbra|hospital.*universit[aá\u0103].*coimbra/i, 'chuc'],

  // ── Hospital de Braga ───────────────────────────────────────────────
  [/hospital\s+(?:de\s+)?braga|braga\s+hospital|ul[sl]?\s+braga|unidade\s+local.*sa[uú]de.*braga|2ca\s+braga|ccab.*braga|pt35103/i, 'h-braga'],

  // ── Vila Nova de Gaia/Espinho ───────────────────────────────────────
  [/gaia.*espinho|espinho.*gaia|uls\s+gaia|santos\s+silva|vila\s+nova\s+(?:de\s+)?gaia|chvng/i, 'h-gaia'],

  // ── Hospital Pedro Hispano (Matosinhos) ─────────────────────────────
  [/pedro\s+hispano|uls\s*m\b|uls\s+matosinhos|unidade.*sa[uú]de.*matosinhos/i, 'h-pedro-hispano'],

  // ── Hospital de Guimarães ───────────────────────────────────────────
  [/oliveira\s+guimar|uls\s+alto\s+ave|alto\s+ave|guimar[aã\u0103]es/i, 'h-guimaraes'],

  // ── ULS TMAD (Vila Real) ────────────────────────────────────────────
  [/tr[aá]s.?os.?montes|uls\s*tmad|ulstmad|vila\s+real/i, 'h-tmad'],

  // ── ULS Algarve ─────────────────────────────────────────────────────
  [/algarve|faro/i, 'h-faro'],
  [/portim[aã]o|barlavento\s+algarvio/i, 'h-portimao'],

  // ── Hospital Infante D. Pedro (Aveiro) ──────────────────────────────
  [/infante\s+(?:d\.?\s+)?pedro|baixo\s+vouga|aveiro/i, 'h-aveiro'],

  // ── Setúbal ─────────────────────────────────────────────────────────
  [/arr[aá]bida|set[uú]bal(?!.*luz)/i, 'h-setubal'],

  // ── Guarda ──────────────────────────────────────────────────────────
  [/sousa\s+martins|uls.*guarda|guarda/i, 'h-guarda'],

  // ── Funchal ─────────────────────────────────────────────────────────
  [/n[eé]lio\s+mendon[çc]a|funchal/i, 'h-funchal'],

  // ── Torres Novas ────────────────────────────────────────────────────
  [/rainha\s+santa\s+isabel|m[eé]dio\s+tejo|torres\s+novas/i, 'h-torres-novas'],

  // ── Santa Maria da Feira ────────────────────────────────────────────
  [/s[aã]o\s+sebasti[aã]o|entre\s+douro\s+e\s+vouga|santa\s+maria\s+da\s+feira/i, 'h-feira'],

  // ── Viana do Castelo ────────────────────────────────────────────────
  [/alto\s+minho|conde\s+de\s+bertiandos|viana\s+do\s+castelo/i, 'h-viana'],
];

/**
 * Patterns that indicate a facility is NOT a real hospital/clinical center.
 * These should be excluded from display.
 */
const EXCLUDE_PATTERNS = [
  /^(?:research|clinical\s+(?:study|trial)|investigat|novartis|gsk|merck|site\s*[#\d]|local\s+institution|pt\d{4,}|investigational)/i,
  /universid(?:ade|ty)|faculdade|faculty|escola\s+nacional|departamento?\b|department\b|university\s+of/i,
  /^(?:dra?\.?\s|jo[aã]na|v[ií]tor|t[aâ]nia|fernando\s+barata)/i,
  /liga\s+portuguesa/i,
  /unidade\s+de\s+sa[uú]de\s+familiar/i,
  /^ucsp\b/i,
  /pa[çc]o\s+de\s+arcos/i,
  /^(?:public\s+health|medcids)/i,
  /reumatologia/i,
  /gulbenkian\s+institute/i,
  /^centro\s+cl[ií]nico\s+acad[eé]mico$/i,
  /cl[ií]nica\s+dr\.?\s+passos/i
];

/**
 * Normalize a facility name to a canonical hospital entry.
 *
 * @param {string} facility - Raw facility name from trial registry
 * @param {string} [city] - City (used as fallback for disambiguation)
 * @returns {{ id: string, canonical: string, city: string } | null}
 *   null if the facility is not a recognized hospital
 */
export function normalizeHospital(facility, city = '') {
  if (!facility) return null;

  const text = facility.trim();

  // Strip site IDs and parenthetical suffixes for matching
  const cleaned = text
    .replace(/\s*\(?\s*site\s*[#:]?\s*\d+\s*\)?/gi, '')
    .replace(/\s*\/\s*id#?\s*\d+/gi, '')
    .replace(/\s*-\s*\d+$/g, '')
    .replace(/\s*\([^)]*\)\s*$/g, '')
    .trim();

  // Try pattern matching
  for (const [pattern, hospitalId] of MATCH_RULES) {
    if (pattern.test(cleaned) || pattern.test(text)) {
      const hospital = PORTUGUESE_HOSPITALS[hospitalId];
      if (hospital) {
        return {
          id: hospitalId,
          canonical: hospital.canonical,
          city: hospital.city
        };
      }
    }
  }

  // Exclude non-hospital facilities (only if no pattern matched above)
  for (const pattern of EXCLUDE_PATTERNS) {
    if (pattern.test(text)) return null;
  }

  // Fallback: generic IPO / "Instituto Português de Oncologia" without city in name
  if (/instituto\s+portugu[eê]s\s+(?:de\s+)?oncolog|^ipo\b|portuguese\s+institute.*(?:cancer|oncology)/i.test(text)) {
    const cityLower = (city || '').toLowerCase();
    if (/lisb|lisboa/i.test(cityLower)) {
      const h = PORTUGUESE_HOSPITALS['ipo-lisboa'];
      return { id: 'ipo-lisboa', canonical: h.canonical, city: h.city };
    }
    if (/porto/i.test(cityLower)) {
      const h = PORTUGUESE_HOSPITALS['ipo-porto'];
      return { id: 'ipo-porto', canonical: h.canonical, city: h.city };
    }
    if (/coimbra/i.test(cityLower)) {
      const h = PORTUGUESE_HOSPITALS['ipo-coimbra'];
      return { id: 'ipo-coimbra', canonical: h.canonical, city: h.city };
    }
  }

  return null;
}

/**
 * Normalize and deduplicate a list of Portuguese recruiting sites.
 *
 * @param {Array<{ facility: string, city: string, status?: string }>} sites
 * @returns {Array<{ facility: string, city: string, status: string }>}
 */
export function normalizeSites(sites) {
  if (!Array.isArray(sites) || sites.length === 0) return [];

  const seen = new Map();
  const results = [];

  for (const site of sites) {
    const match = normalizeHospital(site.facility, site.city);
    if (!match) continue; // Skip non-hospital facilities

    if (seen.has(match.id)) continue;
    seen.set(match.id, true);

    results.push({
      facility: match.canonical,
      city: match.city,
      status: site.status || 'Recruiting'
    });
  }

  return results;
}
