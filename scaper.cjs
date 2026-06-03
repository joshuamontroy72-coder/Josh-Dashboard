const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('');
global.window = dom.window;
global.document = dom.window.document;
global.DOMParser = dom.window.DOMParser;

// --- UTILITIES & CONSTANTS ---
const formatYYYYMMDDLocal = (d) => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const getOffsetDate = (offsetDays = 0) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return formatYYYYMMDDLocal(d);
};

const GN_EN = (id, n, c, q, t = []) => ({ id, name: n, category: c, query: q, hl: 'en-US', gl: 'US', ceid: 'US:en', requiresTranslation: false, forceTags: [...t, 'English'] });
const GN_FR = (id, n, c, q, t = []) => ({ id, name: n, category: c, query: q, hl: 'fr', gl: 'FR', ceid: 'FR:fr', requiresTranslation: true, forceTags: [...t, 'French'] });
const GN_DE = (id, n, c, q, t = []) => ({ id, name: n, category: c, query: q, hl: 'de', gl: 'DE', ceid: 'DE:de', requiresTranslation: true, forceTags: [...t, 'German'] });

const INFECTIOUS_DISEASE_TERMS = [
  'hpv', 'human papillomavirus', 'measles', 'monkeypox', 'mpox', 'rabies', 'respiratory syncytial',
  'rsv', 'rubella', 'rubeola', 'lyme', 'borrelia', 'tick-borne', 'tick-transmitted', 'morbilli'
];

const VACCINE_TERMS = [
  'vaccine', 'vaccines', 'vaccination', 'immunization', 'immunisation', 'jab', 'vax', 'shot', 'booster', 'dose', 
  'immunogenicity', 'efficacy', 'effectiveness', 'safety', 'vaccine safety', 'adverse event', 'adverse events of special interest', 
  'aefi', 'aesi', 'caefiss', 'inoculate', 'inoculation'
];

const EXCLUSION_TERMS = [
  'veterinary', 'service canada', 'wall street', 'irrelevant disease name', 'career', 'chemotherapy'
];

const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const makeRegex = (terms, flags = 'i') => new RegExp(`\\b(?:${terms.map(escapeRegExp).join('|')})\\b`, flags);

const VACCINE_REGEX = makeRegex(VACCINE_TERMS);
const PATHOGEN_REGEX = makeRegex(INFECTIOUS_DISEASE_TERMS);
const EXCLUSION_REGEX = makeRegex(EXCLUSION_TERMS);

const DISEASE_RULES = [
  { rx: /\b(measles|rubeola)\b/gi, w: 2.0, tag: 'Measles' },
  { rx: /\b(rsv|respiratory syncytial)\b/gi, w: 2.0, tag: 'RSV' },
  { rx: /\b(hpv|human papillomavirus)\b/gi, w: 2.0, tag: 'HPV' },
  { rx: /\b(mpox|monkeypox)\b/gi, w: 2.0, tag: 'Mpox' },
  { rx: /\brabies\b/gi, w: 2.0, tag: 'Rabies' },
  { rx: /\b(lyme|borrelia|borreliosis|tick[- ]borne)\b/gi, w: 2.0, tag: 'Lyme Disease' },
 
];

const INTEL_TRIGGERS = [
  { rx: /\b(national advisory committee on immunization|naci|catmat|health canada|committee to advise on tropical medicine and travel|Comité sur l'immunisation du Québec)\b/i, w: 6.0, tag: 'Canada' },
  { rx: /\b(safety|adverse events?|aesis?|deaths?|gbs|hospitalizations?|congenital|saes?|aefis?|gbs|Guillain-Barré syndrome|recall|myocarditis|pericarditis|thrombosis|caefiss|pharmacovigilance|aems|vaers|vsd|causality assessments?)\b/i, w: 5.5, tag: 'Safety' },
  { rx: /\b(supply|deficit|recall|out[- ]of[- ]stock|shortage|stockout|unavailable|backorder|manufacturing delay|discontinuation|allocation)\b/i, w: 5.5, tag: 'Supply' },
  { rx: /\b(approv(al|ed)|licens(ed|ure)|authoriz(ation|ed)|pm|label|revisions?|amendments?|noc|revised|indications?|updates?|product monograph|smpc|icmra|product insert|label update|product update|health canada|summary of product characteristics|regulators?|package insert|fda|ema|pmda|cdsco|tga|vrbpac|sahpra|anvisa|cofepris|chmp|mhra)\b/i, w: 6.0, tag: 'Regulatory' },
  { rx: /\b(recommendations?|guidance|canadian immunization guide|guidelines?|policy|statement|position paper|schedule)\b/i, w: 6.0, tag: 'Guideline' },
];

const TOPIC_RULES = [
  { rx: /\b(nitags?|immunization technical advisory group|advisory committee|acip|cps|jcvi|inspq|sogc|stiko|pho|hcsp|naci|ukhsa|atagi|ctv|sage|gacvs|ntagi|etage|naic|catmat|niph|immunization committee|ncirs)\b/i, w: 1.5, tag: 'NITAG' },
  { rx: /\b(cdc|bccdc|ecdc|pmda|world health organization|haute autorité de santé|china cdc|phac|paho|mhlw|jihs|africa cdc|pavm)\b/i, tag: 'PH Agency' }, 
  { rx: /\b(epidemiolog(y|ic)|incidence|surveillance|seroprevalence|hospitali[sz]ation|mortality|case[- ]?fatality|attack rate|transmission)\b/i, w: 1.5, tag: 'Epidemiology' }, 
  { rx: /\b(public health emergency|pandemic|outbreak|surge|cluster|disease x)\b/i, w: 1.5, tag: 'PHEIC' }, 
  { rx: /\b(unicef|gavi|cepi|ivi|sabin|path|cvia|cve|global fund|gates foundation|bmgf|wellcome trust)\b/i, tag: 'International Organization' },
  { rx: /\b(systematic review|meta[- ]analysis)\b/i, w: 2.0, tag: 'Systematic Review' },
  { rx: /\b(systematic review|meta[- ]analysis)\b/i, w: 0, tag: 'Study' } // Ensures it also appears in the main Peer-Reviewed tab
];

const REGION_RULES = [
  { rx: /\b(canada|canadian|british columbia|alberta|manitoba|northwest territories|nunavut|yukon|ontario|quebec|pei|nova scotia|new brunswick|saskatchewan|newfoundland)\b/i, w: 1.0, tag: 'Canada' },
  { rx: /\b(usa|united states|nih|atlanta|bethesda|white house)\b/i, tag: 'US' },
  { rx: /\b(france|germany|ireland|sweden|norway|uk|eu|europe)\b/i, tag: 'Europe' },
  { rx: /\b(asia|japan|china|india|korea|singapore|australia|new zealand)\b/i, tag: 'Asia-Pac' },
  { rx: /\b(africa|south africa|brazil|argentina|chile|mexico|latin america)\b/i, tag: 'Global South' },
];

const ECON_RULES = [
  { rx: /\b(cost[- ]?effectiveness|economic evaluation|health economics|budget impact|modeling|qalys?|ICER|DALYs?|cost utility)\b/i, w: 5.0, tag: 'Economics' },
];

// --- 1. NEW VACCINE CONTROL CENTER (SPLIT FOR GOOGLE NEWS) ---
const EN_VIRAL_1 = '(mpox OR measles OR rsv)';
const EN_VIRAL_2 = '(hpv OR rabies)';

const EN_CLINICAL_1 = '(lyme)';

// 2. MASTER ACADEMIC QUERY (DATABASES)
//  FIXED: Added the missing closing backtick here
const ALL_PATHOGENS = `${EN_VIRAL_1} OR ${EN_VIRAL_2} OR ${EN_CLINICAL_1}`; 
const EN_VACCINE_DB = '(vaccin* OR immuni* OR inoculat*)';
const MASTER_DB_QUERY = `(${ALL_PATHOGENS}) AND ${EN_VACCINE_DB}`;

// --- THE GOOGLE NEWS GENERATOR ---
const PATHOGEN_CHUNKS = [
  { id: 'viral-1', q: EN_VIRAL_1 }, { id: 'viral-2', q: EN_VIRAL_2 },
  { id: 'clinical-1', q: EN_CLINICAL_1 },
];

// This function automatically builds the 9 split queries for any site you give it
const generateFeeds = (baseId, name, category, baseSite, tags, extra = 'vaccine') => {
  return PATHOGEN_CHUNKS.map(chunk => 
    GN_EN(`${baseId}-${chunk.id}`, name, category, `site:${baseSite} ${chunk.q} ${extra}`.trim(), tags)
  );
};

const FEED_SOURCES = [
  // 1. STATIC FEEDS (Committees, Safety, and specialized sites that don't need pathogen splitting)
  GN_EN('immunize-iz', 'Immunize.org', 'Immunize.org', 'site:immunize.org (vaccine OR vaccination OR immunization)', []),
  GN_EN('who-SAGE', 'SAGE', 'SAGE', 'site:who.int (SAGE OR "Strategic Advisory Group of Experts")', ['NITAG']),
  GN_EN('cdc-acip', 'ACIP', 'ACIP', 'site:cdc.gov (ACIP OR "Advisory Committee on Immunization Practices")', ['US', 'NITAG']),
  GN_EN('cdc-vaers-vsd', 'VAERS', 'VAERS', 'site:cdc.gov (VAERS OR "vaccine safety" OR VSD OR "Vaccine Safety Datalink" OR CISA)', ['US']),
  GN_EN('naci', 'NACI', 'NACI', 'site:canada.ca/en/public-health (NACI OR "National Advisory Committee on Immunization")', ['Canada', 'NITAG']),
  GN_EN('jcvi', 'JCVI', 'JCVI', 'site:gov.uk ("Joint Committee on Vaccination and Immunisation" OR JCVI)', ['Europe', 'NITAG']),
  GN_EN('atagi', 'ATAGI', 'ATAGI', 'site:health.gov.au ("Australian Technical Advisory Group on Immunisation" OR ATAGI)', ['Asia-Pac', 'NITAG']),
  GN_EN('oiac', 'OIAC', 'OIAC', 'site:publichealthontario.ca ("Ontario Immunization Advisory Committee" OR OIAC)', ['Canada', 'NITAG']), 
  GN_EN('fda-vrbpac', 'VRBPAC', 'VRBPAC', 'site:fda.gov (VRBPAC OR "Vaccines and Related Biological Products Advisory Committee")', ['US']),
  GN_EN('icmra', 'ICMRA', 'ICMRA', 'site:icmra.info (vaccine or immunization or immunisation or vaccines)', []),
  GN_EN('who-gacvs', 'WHO-GACVS', 'WHO', 'site:who.int (GACVS OR "Global Advisory Committee on Vaccine Safety")', []),
  GN_EN('brighton', 'Brighton', 'Brighton', 'site:brightoncollaboration.org', []),


  // 2. PH AGENCIES (Auto-Generated Splits)
  ...generateFeeds('who', 'WHO', 'WHO', 'who.int', ['PH Agency']),
  ...generateFeeds('cdc', 'CDC', 'CDC', 'cdc.gov', ['US', 'PH Agency']),
  ...generateFeeds('ecdc', 'ECDC', 'ECDC', 'ecdc.europa.eu', ['Europe', 'PH Agency']),
  ...generateFeeds('ukhsa', 'UKHSA', 'UKHSA', 'gov.uk', ['Europe', 'PH Agency']),
  ...generateFeeds('africa', 'Africa CDC', 'Africa CDC', 'africacdc.org', ['Global South', 'PH Agency']),

  // 3. REGULATORS (Auto-Generated Splits)
  ...generateFeeds('fda', 'FDA', 'FDA', 'fda.gov', ['US']),
  ...generateFeeds('ema', 'EMA', 'EMA', 'ema.europa.eu', ['Europe']),
  ...generateFeeds('mhra', 'MHRA', 'MHRA', 'mhra.gov.uk', ['Europe']),
  ...generateFeeds('hc', 'Health Canada', 'Health Canada', 'canada.ca', ['Canada']),
  ...generateFeeds('tga', 'TGA', 'TGA', 'tga.gov.au', ['Asia-Pac']),

  // 4. EPIDEMIOLOGY / MEDICAL JOURNALS (Auto-Generated Splits)
  ...generateFeeds('cidrap', 'CIDRAP', 'Epidemiology', 'cidrap.umn.edu', ['Epidemiology']),
  ...generateFeeds('reuters', 'Reuters', 'News', 'reuters.com', ['Epidemiology']),
  ...generateFeeds('bmj', 'BMJ', 'Epidemiology', 'bmj.com', ['Epidemiology']),
  ...generateFeeds('lancet', 'Lancet', 'Epidemiology', 'thelancet.com', ['Epidemiology']),
  ...generateFeeds('nejm', 'NEJM', 'Epidemiology', 'nejm.org', ['Epidemiology']),
  ...generateFeeds('jama', 'JAMA', 'Epidemiology', 'jamanetwork.com', ['Epidemiology']),
  ...generateFeeds('nature', 'Nature', 'Epidemiology', 'nature.com', ['Epidemiology']),
  ...generateFeeds('science', 'Science', 'Epidemiology', 'science.org', ['Epidemiology']),
  ...generateFeeds('cell', 'Cell', 'Epidemiology', 'cell.com', ['Epidemiology']),
  ...generateFeeds('idsa', 'IDSA', 'Epidemiology', 'idsociety.org', ['Epidemiology']),

  // 4. News 
  
  GN_DE('stiko', 'STIKO', 'NITAG', 'site:rki.de ("Ständige Impf­kom­mission" OR STIKO)', ['Europe', 'NITAG', 'Guideline']),
  GN_FR('has', 'HAS', 'NITAG', 'site:has-sante.fr ("Recommandations vaccinales" OR "Calendrier vaccinal" OR vaccin OR vaccination)', ['Europe', 'NITAG', 'Guideline']),
  GN_FR('hcsp', 'France PH', 'PH Agency', `site:hcsp.fr ("Recommandations vaccinales" OR "Calendrier vaccinal" OR vaccin OR vaccination)`, ['Europe', 'PH Agency', 'Epidemiology']),
  GN_EN('gavi', 'Gavi', 'Gavi', 'site:gavi.org (vaccine OR vaccination OR immunization)', ['News']),
  GN_EN('cepi', 'CEPI', 'CEPI', 'site:cepi.net (vaccine OR vaccination OR immunization)', ['News']),
  GN_EN('ivi', 'International Vaccine Institute', 'IVI', 'site:ivi.int (vaccine OR vaccination OR immunization)', ['News']),
  GN_EN('sabin', 'Sabin Vaccine Institute', 'Sabin Vaccine Institute', 'site:sabin.org (vaccine OR vaccination OR immunization)', ['News']),
  GN_EN('path', 'PATH', 'PATH', 'site:path.org (vaccine OR vaccination OR immunization)', ['News']),
  GN_EN('unicef', 'UNICEF', 'UNICEF', 'site:unicef.org (vaccine OR vaccines OR immunisation)', ['News']),
  GN_EN('bmgf', 'Gates Foundation', 'Gates Foundation', 'site:gatesfoundation.org (vaccine OR vaccination OR immunization)', ['News']),
  GN_EN('unmc', 'UNMC', 'UNMC', 'site:unmc.edu (vaccine OR vaccination OR immunization)', ['News']),
  GN_EN('your-local-epi', 'Your Local Epidemiologist', 'Your Local Epidemiologist', 'site:yourlocalepidemiologist.substack.com (vaccine OR vaccination OR immunization)', ['News']),
  GN_EN('sciencedaily', 'ScienceDaily', 'ScienceDaily', 'site:sciencedaily.com (vaccine OR vaccination OR immunization)', ['News']),
  GN_EN('medicalxpress', 'MedicalXpress', 'MedicalXpress', 'site:medicalxpress.com (vaccine OR vaccination OR immunization)', ['News']),
  GN_EN('eurekalert', 'EurekAlert', ' EurekAlert', 'site:eurekalert.org (vaccine OR vaccination OR immunization)', ['News']),
  GN_EN('alphagalileo', 'AlphaGalileo', 'AlphaGalileo', 'site:alphagalileo.org (vaccine OR vaccination OR immunization)', ['News']),
  GN_EN('statnews', 'STAT News', 'STAT News', 'site:statnews.com (vaccine OR vaccination OR immunization)', ['News']),
  GN_EN('outbreak-news', 'ONT', 'ONT', 'site:outbreaknewstoday.com (vaccine OR vaccination OR immunization)', ['News']),
  GN_EN('healthpolicywatch', 'Health Policy Watch', 'Health Policy Watch', 'site:healthpolicy-watch.org (vaccine OR vaccination OR immunization)', ['News']),
  GN_EN('biopharmadive', 'BioPharma Dive', 'BioPharma Dive', 'site:biopharmadive.com (vaccine OR vaccination OR immunization)', ['News']),
  GN_EN('endpoints-news', 'Endpoints News', 'Endpoints News', 'site:endpointsnews.com (vaccine OR vaccination OR immunization)', ['News']),
  GN_EN('fierce-vaccines', 'Fierce Pharma', 'Fierce Pharma', '(site:fiercepharma.com) (vaccine OR vaccination OR immunization)', ['News']),
  GN_EN('medscape-news', 'Medscape News', 'Medscape News', 'site:medscape.com (vaccine OR vaccination OR immunization)', ['News']),
  GN_EN('gsk', 'GSK', 'GSK', 'site:gsk.com vaccine', ['News']),
  GN_EN('sanofi', 'Sanofi', 'Sanofi', 'site:sanofi.com vaccine', ['News']),
  GN_EN('merck', 'Merck', 'Merck', 'site:merck.com vaccine', ['News']),
  GN_EN('pfizer', 'Pfizer', 'Pfizer', 'site:pfizer.com vaccine', ['News']),
  GN_EN('biontech', 'BioNTech', 'BioNTech', 'site:biontech.com vaccine', ['News']),
  GN_EN('moderna', 'Moderna', 'Moderna', 'site:modernatx.com vaccine', ['News']),
  GN_EN('astrazeneca', 'AstraZeneca', 'AstraZeneca', 'site:astrazeneca.com vaccine', ['News']),
  GN_EN('novavax', 'Novavax', 'Novavax', 'site:novavax.com vaccine', ['News']),
  GN_EN('serum', 'Serum Institute', 'Serum Institute', 'site:seruminstitute.com vaccine', ['News']),
];

const VACCINE_CONTEXT_RX = /(?:\b(vaccine|vaccination|immunization|immunisation|jab|vax|shot|booster|dose|vaccin|impfung|impfstoff)\b)/i;
const IMPORTANT_TAGS = new Set(['Supply', 'Safety', 'Regulatory', 'Authorization', 'Guideline', 'PHEIC']);

const normText = (s) => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[\u2010-\u2015\u2212]/g, '-').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

// 1. THIS IS THE FUNCTION THAT ACCIDENTALLY GOT DELETED:
const stripHtml = (html) => {
  if (!html) return '';
  const tmp = document.createElement('DIV');
  tmp.innerHTML = html;
  return (tmp.textContent || tmp.innerText || '').replace(/\s+/g, ' ').trim();
};

// 2. THIS IS YOUR UPDATED EXCERPT FUNCTION:
const safeExcerpt = (text) => {
  const clean = stripHtml(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'No summary.';
  return clean;
};
const parseDateToMs = (text) => {
  if (!text) return { ms: 0, confidence: 'none' };
  const s = String(text).trim();
  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) {
    const ms = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]), 12, 0, 0, 0).getTime();
    return Number.isFinite(ms) ? { ms, confidence: 'ymd' } : { ms: 0, confidence: 'none' };
  }
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const ms = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]), 12, 0, 0, 0).getTime();
    return Number.isFinite(ms) ? { ms, confidence: 'dmy' } : { ms: 0, confidence: 'none' };
  }
  const ymdSlash = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (ymdSlash) {
    const ms = new Date(Number(ymdSlash[1]), Number(ymdSlash[2]) - 1, Number(ymdSlash[3]), 12, 0, 0, 0).getTime();
    return Number.isFinite(ms) ? { ms, confidence: 'ymdSlash' } : { ms: 0, confidence: 'none' };
  }
  const ms1 = Date.parse(s);
  if (!Number.isNaN(ms1)) return { ms: ms1, confidence: 'native' };
  const pubmedM = s.match(/\b(\d{4})\s+([a-zA-Z]{3})\s+(\d{1,2})\b/);
  if (pubmedM) {
    const ms2 = new Date(`${pubmedM[2]} ${pubmedM[3]}, ${pubmedM[1]}`).getTime();
    return ms2 ? { ms: ms2, confidence: 'pubmed' } : { ms: 0, confidence: 'none' };
  }
  return { ms: 0, confidence: 'none' };
};

const parseMs = (text, fallback = 0) => {
  const { ms } = parseDateToMs(text);
  return ms || fallback;
};

const stableHash36 = (s) => {
  const str = String(s || '');
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
};

const normalizeDoi = (doi) => String(doi || '').trim().replace(/^doi:\s*/i, '').replace(/[\s\)\]\.,;]+$/g, '').toLowerCase();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chunkArray = (arr, size) => { const out = []; for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size)); return out; };
const rxTest = (rx, text) => { if (rx.global || rx.sticky) rx.lastIndex = 0; return rx.test(text); };
const buildQueryFragment = (terms) => terms.map(t => (t.includes(' ') ? `"${t}"` : t)).join(' OR ');
const mergeTags = (a = [], b = []) => Array.from(new Set([...(a || []), ...(b || [])]));

const getFirstText = (node, candidates) => {
  for (const sel of candidates) {
    const q = sel.includes(':') ? sel.replace(':', '\\:') : sel;
    try { const el = node.querySelector(q); if (el?.textContent) return el.textContent; } catch (e) {} 
    const els = node.getElementsByTagName(sel); if (els?.length) return els[0].textContent;
  }
  return '';
};

const parseXMLString = (xmlText) => {
  if (!xmlText) return [];
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
  const nodes = xmlDoc.querySelectorAll('item, entry');
  const items = [];
  nodes.forEach(node => {
    const title = stripHtml(getFirstText(node, ['title']));
    let link = getFirstText(node, ['link']);
    if (!link) { const linkEl = node.querySelector('link[href]'); if (linkEl) link = linkEl.getAttribute('href'); }
    const description = stripHtml(getFirstText(node, ['content:encoded', 'description', 'content', 'summary']));
    const pubDate = getFirstText(node, ['pubDate', 'published', 'updated', 'dc:date']);
    const sourceEl = node.querySelector('source');
    const publisher = sourceEl?.textContent?.trim() || '';
    const publisherUrl = sourceEl?.getAttribute('url') || '';
    if (title && link) {
      const parsedDateMs = parseMs(pubDate, 0);
      items.push({ title, link, description, pubDate, dateMs: parsedDateMs, dateUnknown: parsedDateMs === 0, publisher, publisherUrl });
    }
  });
  return items;
};

const extractIds = ({ url, title, summary }) => {
  const ids = {};
  const u = String(url || '');
  const pmid = u.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/i)?.[1] || u.match(/ncbi\.nlm\.nih\.gov\/pubmed\/(\d+)/i)?.[1];
  if (pmid) ids.pmid = pmid;
  const doiFromUrl = (() => { try { const U = new URL(u); if (U.hostname.toLowerCase().endsWith('doi.org')) return normalizeDoi(U.pathname.slice(1)); return ''; } catch { return ''; } })();
  const doiFromText = normalizeDoi(`${title || ''} ${summary || ''}`.match(/(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)\b/i)?.[1]);
  const doi = doiFromUrl || doiFromText;
  if (doi) ids.doi = doi;
  const blob = `${title || ''} ${summary || ''} ${u}`;
  const nct = blob.match(/\bNCT\d{8}\b/i)?.[0];
  if (nct) ids.nct = nct.toUpperCase();
  const ctisct = blob.match(/\b(\d{4}-\d{6}-\d{2})\b/)?.[1];
  if (ctisct) ids.ctisct = ctisct;
  const isrctn = blob.match(/\bISRCTN\d+\b/i)?.[0];
  if (isrctn) ids.isrctn = isrctn.toUpperCase();
  const actrn = blob.match(/\bACTRN\d+\b/i)?.[0];
  if (actrn) ids.actrn = actrn.toUpperCase();
  const irct = blob.match(/\bIRCT\d+\b/i)?.[0];
  if (irct) ids.irct = irct.toUpperCase();
  const chictr = blob.match(/\bChiCTR\d+\b/i)?.[0];
  if (chictr) ids.chictr = chictr;
  const jprn = blob.match(/\bJPRN[-_A-Z0-9]+\b/i)?.[0];
  if (jprn) ids.jprn = jprn.toUpperCase();
  return ids;
};

const canonicalizeUrl = (inputUrl) => {
  try {
    const u = new URL(String(inputUrl || '').trim());
    u.hash = ''; u.hostname = u.hostname.replace(/^www\./i, '').toLowerCase();
    const drop = ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','utm_id','gclid','fbclid','mc_cid','mc_eid','ref','cmpid'];
    drop.forEach(k => u.searchParams.delete(k));
    const params = [...u.searchParams.entries()].sort(([a],[b]) => a.localeCompare(b));
    u.search = params.length ? `?${new URLSearchParams(params).toString()}` : '';
    if (u.pathname !== '/') u.pathname = u.pathname.replace(/\/+$/, '');
    if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) u.port = '';
    return u.toString();
  } catch { return ''; }
};

const makeArticleId = (a) => {
  const ids = a?.meta?.ids || extractIds(a);
  if (ids.doi) return `doi:${ids.doi}`;
  if (ids.pmid) return `pmid:${ids.pmid}`;  
  if (ids.nct) return `nct:${ids.nct}`;
  if (ids.ctisct) return `ctisct:${ids.ctisct}`;
  if (ids.isrctn) return `isrctn:${ids.isrctn}`;
  if (ids.actrn) return `actrn:${ids.actrn}`;
  if (ids.irct) return `irct:${ids.irct}`;
  if (ids.chictr) return `chictr:${ids.chictr}`;
  if (ids.jprn) return `jprn:${ids.jprn}`;
  const canUrl = canonicalizeUrl(a.url);
  if (canUrl) return `url:${stableHash36(canUrl)}`;
  const pub = normText(a.publisherName || a.sourceName || '');
  const t = normText(a.normalizedTitle || a.title || '');
  return `fp:${stableHash36(`${pub}|${t}`)}`;
};

// --- NEW SERVER-SIDE DIRECT FETCH (NO PROXIES!) ---
const fetchWithTimeout = async (url, options = {}, timeoutMs = 15000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
};

const isAbortError = (e) =>
  e?.name === 'AbortError' || /aborted/i.test(String(e?.message || ''));

const fetchJsonRetry = async (url, init = {}, tries = 3, timeoutMs = 15000) => {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetchWithTimeout(
        url,
        {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            ...init.headers
          },
          ...init
        },
        timeoutMs
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      const delay = isAbortError(e) ? 1500 * (i + 1) : 300 * (2 ** i) + Math.random() * 250;
      await sleep(delay);
    }
  }
};

const fetchTextRetry = async (url, init = {}, tries = 3, timeoutMs = 15000) => {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetchWithTimeout(
        url,
        {
          headers: {
            Accept: 'application/xml, text/xml, text/html, */*',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            ...init.headers
          },
          ...init
        },
        timeoutMs
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (i === tries - 1) throw e;
      const delay = isAbortError(e) ? 1500 * (i + 1) : 300 * (2 ** i) + Math.random() * 250;
      await sleep(delay);
    }
  }
};

const EPMC_SEARCH_URL = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';
const epmcSearch = async ({ query, cursorMark = '*', pageSize = 50, resultType = 'core' } = {}) => {
  const url = `${EPMC_SEARCH_URL}?query=${encodeURIComponent(query)}&format=json&resultType=${encodeURIComponent(resultType)}&pageSize=${pageSize}&cursorMark=${encodeURIComponent(cursorMark)}`;
  return await fetchJsonRetry(url);
};

const epmcFetchOneByPmid = async (pmid) => {
  const q = `ext_id:${pmid} src:med`;
  const data = await epmcSearch({ query: q, cursorMark: '*', pageSize: 1, resultType: 'core' });
  return data?.resultList?.result?.[0] || null;
};

const makeLimiter = (concurrency) => {
  const queue = []; let active = 0;
  const next = () => { if (queue.length > 0 && active < concurrency) { active++; const task = queue.shift(); task().finally(() => { active--; next(); }); } };
  return (fn) => new Promise((resolve, reject) => { queue.push(() => fn().then(resolve).catch(reject)); next(); });
};

const normalizeTitleForId = (title, publisherName) => {
  const raw = stripHtml(title || ''); const pub = (publisherName || '').trim();
  if (!pub) return raw.trim(); const pubEsc = String(pub).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return raw.replace(new RegExp(`\\s*[-–—|:]\\s*${pubEsc}\\s*$`, 'i'), '').replace(/\s+/g, ' ').trim();
};

const getDomain = (url) => { try { return new URL(url).hostname.replace(/^www\./,'').toLowerCase(); } catch { return ''; } };

const tagFromDomain = (domain) => {
  if (domain.endsWith('who.int')) return ['WHO','PH Agency'];
  if (domain.endsWith('cdc.gov')) return ['CDC','US','PH Agency'];
  if (domain.endsWith('canada.ca')) return ['Canada','PH Agency'];
  if (domain.endsWith('ecdc.europa.eu')) return ['ECDC','Europe','PH Agency'];
  return [];
};

const categoryBypassesContext = (category) => {
  const c = normText(category);
  return c.includes('guideline') || c.includes('regulatory');
};

const scoreItem = (title, content, category, sourceName, requiresTranslation = false) => {
  const hay = normText(`${title || ''} ${content || ''} ${category || ''} ${sourceName || ''}`);
  
  if (rxTest(EXCLUSION_REGEX, hay)) {
    return { score: 0, tags: [], reason: 'Blocked by Exclusion List' };
  }

  const hasContext = VACCINE_CONTEXT_RX.test(hay);

  // Give AI articles a free pass on the strict "vaccine" keyword check
  if (!hasContext && !categoryBypassesContext(category) && category !== 'AI Search') {
    return { score: 0, tags: requiresTranslation ? ['Translate'] : [], reason: 'No context' };
  }

  let score = 0; const tags = new Set();
  if (requiresTranslation) tags.add('Translate');

  let diseaseMatched = false;
  for (const { rx, w, tag } of DISEASE_RULES) { 
    if (rxTest(rx, hay)) { diseaseMatched = true; score += (w || 0); tags.add(tag); } 
  }

  // MOVED: Do ALL topic and region checks *before* deciding if it is Unclassified
  for (const ruleSet of [INTEL_TRIGGERS, TOPIC_RULES, ECON_RULES]) { 
    for (const { rx, w, tag } of ruleSet) { 
      if (rxTest(rx, hay)) { score += (w || 0); tags.add(tag); } 
    } 
  }
  for (const { rx, tag } of REGION_RULES) { 
    if (rxTest(rx, hay)) tags.add(tag); 
  }

  const policyHit = /\b(acip|naci|jcvi|stiko|sage|vrbpac|guideline|recommendation|schedule|policy)\b/i.test(hay);
  
  // Apply Unclassified if needed, but DO NOT erase the other tags we just found!
  if (!diseaseMatched && !policyHit) { 
    tags.add('Unclassified'); 
    if (score === 0) score = 0.1; // Ensure it passes the > 0 check in the main loop
  }

  return { score: Math.round(score * 100) / 100, tags: Array.from(tags), reason: 'Accepted' };
};

// --- PASTE THESE TWO MISSING FUNCTIONS BACK IN ---
const computeIsCanadian = (a) => {
  return a.tags?.includes('Canada') || false;
};

const computeIsPHEIC = (a) => {
  return a.tags?.includes('PHEIC') || false;
};
// -------------------------------------------------
  
const computeImportant = (a) => {  
  // 1. Force all ChatGPT findings to be marked as Important instantly!
  if (a.tags?.includes('🤖 AI Insight')) return true;

  // 2. Otherwise, fall back to the standard rules
  const isCanadian = a.meta?.isCanadian ?? computeIsCanadian(a);  
  const isPHEIC = a.meta?.isPHEIC ?? computeIsPHEIC(a);  
  if (!isCanadian && !isPHEIC) return false;  
  return (a.tags || []).some(t => IMPORTANT_TAGS.has(t));  
};  


const safeArticle = (a) => {
  try {
    if (!a?.title || !String(a.title).trim()) return null;
    if (!a?.url || !String(a.url).trim()) return null;
    const out = { ...a };
    if (!Number.isFinite(out.publishedAt)) out.publishedAt = 0;
    if (!Array.isArray(out.tags)) out.tags = [];
    if (!Array.isArray(out.sources)) out.sources = [];
    out.category = String(out.category || '').trim() || 'Uncategorized';
    return out;
  } catch { return null; }
};

const normalizeArticle = (input) => {
  const url = input.url;
  const canonicalUrl = input.canonicalUrl || canonicalizeUrl(url);
  const domain = getDomain(canonicalUrl || url);
  const domainTags = tagFromDomain(domain);
  const publishedAt = input.publishedAt || 0;
  const publisherName = input.publisherName || input.sourceName || domain || 'Unknown';
  const normalizedTitle = normalizeTitleForId(input.title || '', publisherName);
  
  // 1. Change to 'let' so we can modify it
  let mergedTags = Array.from(new Set([...(input.tags || []), ...domainTags]));
  const ids = extractIds({ url: canonicalUrl || url, title: input.title, summary: input.summary });

// 2. THE STRICT BAN LOGIC
  let finalCategory = input.category;
  
  // Check case-insensitively for variations of the translate tag
  const isTranslated = mergedTags.some(t => {
    const lower = String(t).toLowerCase();
    return lower === 'translate' || lower === 'translation';
  });

  if (isTranslated) {
    // Strip 'Regulatory' completely out of the tags
    mergedTags = mergedTags.filter(t => String(t).toLowerCase() !== 'regulatory');
    // If the category was Regulatory, demote it to News to remove it from the feed
    if (String(finalCategory).toLowerCase() === 'regulatory') {
      finalCategory = 'News';
    }
  }

  const base = safeArticle({
    ...input, url, canonicalUrl, publisherName, normalizedTitle, publishedAt, tags: mergedTags,
    category: finalCategory, // Force the updated category
    sources: input.sources || [{ name: input.sourceName, category: finalCategory, type: input.sourceType }],
    meta: { ...(input.meta || {}), ids }
  });

  if (!base) return null;
  base.id = makeArticleId(base);
  const isCanadian = computeIsCanadian(base);
  const isPHEIC = computeIsPHEIC(base);
  const isImportant = computeImportant({ ...base, meta: { isCanadian, isPHEIC } });
  base.meta = { ...(base.meta || {}), isCanadian, isImportant, isPHEIC };
  return base;
};

const articleQuality = (a) => ((a.score || 0) * 10 + (a.sourceType === 'api' ? 3 : a.sourceType === 'rss' ? 2 : 1) * 100 + Math.min(400, (a.summary || '').length));

const pickBetterUrl = (aUrl, bUrl) => {
  const a = canonicalizeUrl(aUrl); const b = canonicalizeUrl(bUrl);
  if (!a) return bUrl; if (!b) return aUrl;
  const aIsGoogle = /news\.google\.com/i.test(a); const bIsGoogle = /news\.google\.com/i.test(b);
  if (aIsGoogle && !bIsGoogle) return bUrl; if (bIsGoogle && !aIsGoogle) return aUrl;
  return (b.length < a.length) ? bUrl : aUrl;
};

const mergeUniqueSources = (a = [], b = []) => {
  const m = new Map();
  for (const s of [...a, ...b]) {
    const key = `${s?.name || ''}||${s?.category || ''}||${s?.type || ''}`;
    if (!m.has(key)) m.set(key, s);
  }
  return Array.from(m.values());
};

const getIdentityKeys = (a) => {
  const ids = a?.meta?.ids || extractIds({ url: a.url, title: a.title, summary: a.summary });
  const keys = [];
  if (ids.doi) keys.push(`doi:${normalizeDoi(ids.doi)}`);
  if (ids.pmid) keys.push(`pmid:${ids.pmid}`);
  if (ids.nct) keys.push(`nct:${String(ids.nct).toUpperCase()}`);
  if (ids.ctisct) keys.push(`ctisct:${ids.ctisct}`);
  if (ids.isrctn) keys.push(`isrctn:${String(ids.isrctn).toUpperCase()}`);
  if (ids.actrn) keys.push(`actrn:${String(ids.actrn).toUpperCase()}`);
  if (ids.irct) keys.push(`irct:${String(ids.irct).toUpperCase()}`);
  if (ids.chictr) keys.push(`chictr:${ids.chictr}`);
  if (ids.jprn) keys.push(`jprn:${String(ids.jprn).toUpperCase()}`);
  
  const canUrl = a.canonicalUrl || canonicalizeUrl(a.url);
  if (canUrl) keys.push(`url:${stableHash36(canUrl)}`);
  
  // NEW: Always create an aggressive 'Title + Publisher' fingerprint
  const pub = normText(a.publisherName || a.sourceName || '');
  const t = normText(a.normalizedTitle || a.title || '');
  if (pub && t) keys.push(`fp:${stableHash36(`${pub}|${t}`)}`);

  // 2. NEW: Title-Only Fingerprint (for syndicated press releases across different sites)
  if (t && t.length > 30) keys.push(`title_only:${stableHash36(t)}`);
  if (a.id) keys.push(a.id);
  
  return Array.from(new Set(keys.filter(Boolean)));
};

const primaryKeyFromKeys = (keys) => {
  const pref = ['doi:', 'pmid:', 'nct:', 'ctisct:', 'isrctn:', 'actrn:', 'irct:', 'chictr:', 'jprn:', 'url:'];
  for (const p of pref) { const k = keys.find(x => x.startsWith(p)); if (k) return k; }
  return keys[0] || `fp:${stableHash36(String(Math.random()))}`;
};

const dedupeAndMerge = (items) => {
  const sortedItems = [...items].sort((a, b) => getIdentityKeys(b).length - getIdentityKeys(a).length);
  const groups = new Map();
  const keyToGroup = new Map();

  for (const a of sortedItems) {
    const keys = getIdentityKeys(a);
    let groupKey = null;

    for (const k of keys) {
      const g = keyToGroup.get(k);
      if (g) { groupKey = g; break; }
    }

    if (!groupKey) {
      groupKey = primaryKeyFromKeys(keys);
      const cloned = {
        ...a,
        id: a.id || groupKey,
        tags: Array.from(new Set(a.tags || [])),
        sources: Array.isArray(a.sources) ? a.sources.map(s => ({ ...s })) : [],
        meta: a.meta ? { ...a.meta } : {}
      };
      groups.set(groupKey, cloned);
      for (const k of keys) keyToGroup.set(k, groupKey);
      continue;
    }

    const ex = groups.get(groupKey);
    if (!ex) {
      groups.set(groupKey, { ...a });
      for (const k of keys) keyToGroup.set(k, groupKey);
      continue;
    }

    const keepA = articleQuality(a) > articleQuality(ex);
    const winner = keepA ? a : ex;

    ex.title = winner.title || ex.title;
    ex.summary = (winner.summary && winner.summary.length >= (ex.summary || '').length) ? winner.summary : ex.summary;
    ex.url = pickBetterUrl(ex.url, a.url);
    ex.canonicalUrl = canonicalizeUrl(ex.url) || ex.canonicalUrl;
    ex.category = (ex.category === 'Guidelines' || a.category === 'Guidelines') ? 'Guidelines' : ex.category;
    ex.publisherName = winner.publisherName || ex.publisherName;
    ex.tags = Array.from(new Set([...(ex.tags || []), ...(a.tags || [])]));
    ex.sources = mergeUniqueSources(ex.sources, a.sources);
    ex.publishedAt = Math.max(ex.publishedAt || 0, a.publishedAt || 0);
    ex.score = Math.max(ex.score || 0, a.score || 0);

    ex.meta = ex.meta || {};
    ex.meta.isCanadian = Boolean(ex.meta.isCanadian || a.meta?.isCanadian);
    ex.meta.isPHEIC = Boolean(ex.meta.isPHEIC || a.meta?.isPHEIC);
    ex.meta.ids = extractIds({ url: ex.url, title: ex.title, summary: ex.summary });

    ex.meta.isImportant = computeImportant({
      ...ex,
      meta: { isCanadian: ex.meta.isCanadian, isPHEIC: ex.meta.isPHEIC }
    });

    const mergedKeys = Array.from(new Set([...getIdentityKeys(ex), ...keys]));
    for (const k of mergedKeys) keyToGroup.set(k, groupKey);
    ex.id = primaryKeyFromKeys(mergedKeys);
  }

// --- THE FINAL SWEEP ---
  const finalMergedArray = Array.from(groups.values());
  
  for (const ex of finalMergedArray) {
    const sourceNames = new Set((ex.sources || []).map(s => s.name));
    const hasAmedeo = sourceNames.has('Amedeo');
    const hasPubMed = sourceNames.has('PubMed');

    if (hasAmedeo && hasPubMed) {
      ex.meta.isAmedeoMatch = true;
      
      // Force the star tag in
      if (!ex.tags) ex.tags = [];
      ex.tags.push('⭐ PubMed');
      
      // Strip the normal "PubMed" tag so it doesn't duplicate at the bottom
      ex.tags = ex.tags.filter(t => String(t).toLowerCase() !== 'pubmed');
      
      // Keep the top tag as whatever was primary (e.g. Amedeo)
      ex.sourceName = ex.sources[0]?.name || 'Amedeo'; 
    } else {
      ex.sourceName = Array.from(sourceNames).join(', ');
    }
  }

  return finalMergedArray.sort((a, b) => {
    const aImp = a.meta?.isImportant ? 1 : 0;
    const bImp = b.meta?.isImportant ? 1 : 0;
    if (bImp !== aImp) return bImp - aImp;

    const aScore = Number(a.score || 0);
    const bScore = Number(b.score || 0);
    if (bScore !== aScore) return bScore - aScore;

    return (b.publishedAt || 0) - (a.publishedAt || 0);
  });
};

// --- MAIN RUNNER ---
const runScraper = async () => {
  console.log("Starting backend pipeline...");
  const allProcessed = [];
  const scanLog = [];
  
  const scanMetrics = { 
    total: 8 + FEED_SOURCES.length, completed: 0, successful: 0, failed: 0, 
    rawFetched: 0, rejectedOld: 0, rejectedScore0: 0, accepted: 0, dedupedUnique: 0 
  };

  const now = Date.now();
  const cutoff15DaysMs = now - (15 * 24 * 60 * 60 * 1000);
  const fifteenDaysAgoStr = getOffsetDate(-15);
  const todayStr = getOffsetDate(0);
  const tomorrowStr = getOffsetDate(1);

  const log = (msg, type = 'info', name = 'System') => {
    console.log(`[${type.toUpperCase()}] ${name}: ${msg}`);
    scanLog.push({ id: Date.now() + Math.random(), time: new Date().toLocaleTimeString(), msg, type, name });
  };

  const updateMetric = (status, counts = {}) => {
    scanMetrics.completed++;
    if (status === 'success') scanMetrics.successful++;
    if (status === 'error') scanMetrics.failed++;
    scanMetrics.rawFetched += (counts.raw || 0);
    scanMetrics.rejectedOld += (counts.old || 0);
    scanMetrics.rejectedScore0 += (counts.score0 || 0);
    scanMetrics.accepted += (counts.accepted || 0);
  };

  const fetchFeedSource = async (feed) => {
    const counts = { raw: 0, old: 0, score0: 0, accepted: 0 };
    const feedName = String(feed?.name || feed?.id || 'Feed');
    const feedCategory = String(feed?.category || 'Uncategorized');
    const feedQuery = String(feed?.query || '');
    const feedForceTags = Array.isArray(feed?.forceTags) ? feed.forceTags : [];
    const requiresTranslation = Boolean(feed?.requiresTranslation);

    if (!/\bsite:\S+/i.test(feedQuery)) {
      log(`Skipped non-site query: ${feedName}`, 'info', feedName);
      updateMetric('success', counts); return;
    }

    try {
      log(`Querying: ${feedName}`, 'info', feedName);
      const dateBoundedQuery = `${feedQuery} after:${fifteenDaysAgoStr} before:${tomorrowStr} when:15d`;
      const rssSearchUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(dateBoundedQuery)}&hl=${encodeURIComponent(feed?.hl || 'en-US')}&gl=${encodeURIComponent(feed?.gl || 'US')}&ceid=${encodeURIComponent(feed?.ceid || 'US:en')}`;
      
      // DELETED PROXY - Direct fetch is 100x faster for servers
      const content = await fetchTextRetry(rssSearchUrl);
      const items = parseXMLString(content);

      for (const item of items) {
        counts.raw++;
        if (item.dateMs && item.dateMs < cutoff15DaysMs) { counts.old++; continue; }

        const { score, tags } = scoreItem(item.title, item.description, feedCategory, feedName, requiresTranslation);
        if (score > 0) {
          counts.accepted++;
          const na = normalizeArticle({
            sourceName: feedName, publisherName: item.publisher || feedName, sourceType: 'rss',
            category: feedCategory, title: item.title, url: item.link, publishedAt: item.dateMs || 0,
            summary: safeExcerpt(item.description),
            tags: mergeTags(tags, feedForceTags), score: score + 1.0, 
            sources: [{ name: feedName, category: feedCategory, type: 'rss' }]
          });
          if (na) allProcessed.push(na);
        } else { counts.score0++; }
      }
      log(`Success (Raw: ${counts.raw}, Accepted: ${counts.accepted})`, 'success', feedName);
      updateMetric('success', counts);
    } catch (e) { log(`API Failure: ${e?.message || 'Unknown error'}`, 'error', feedName); updateMetric('error', counts); }
  };

  const fetchCTIS = async () => {
    const counts = { raw: 0, old: 0, score0: 0, accepted: 0 };
    try {
      log('Querying: CTIS', 'info', 'CTIS');
      let page = 1; let keepPaging = true;
      while (keepPaging && page <= 10) {
        const payload = { pagination: { page, size: 50 }, sort: { property: 'lastPublicationUpdate', direction: 'DESC' }, searchCriteria: { containAny: 'vaccine vaccination immunization immunisation vaccin vacuna vacina impfstoff', hasStudyResults: true } };
        // DELETED PROXY - Direct fetch
        const data = await fetchJsonRetry('https://euclinicaltrials.eu/ctis-public-api/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const rows = Array.isArray(data?.data) ? data.data : [];
        if (!rows.length) break;

        for (const row of rows) {
          const title = String(row.ctTitle || row.shortTitle || row.ctNumber || '').trim();
          const ctNumber = String(row.ctNumber || '').trim();
          const phase = String(row.trialPhase || '');
          if (!title || !ctNumber || !/\bphase\b.*\b(ii|iii|iv|2|3|4)\b/i.test(phase)) continue;

          const dateMs = parseMs(row.lastPublicationUpdate || row.decisionDateOverall, 0);
          if (dateMs > 0 && dateMs < cutoff15DaysMs) { counts.old++; keepPaging = false; break; }

          counts.raw++;
          const { tags, score } = scoreItem(title, `${row.medicalCondition || ''} ${phase}`, 'Clinical Trials', 'CTIS');
          if (score > 0) {
            counts.accepted++;
            const na = normalizeArticle({
              sourceName: 'CTIS', sourceType: 'api', category: 'Clinical Trials', title, url: `https://euclinicaltrials.eu/search-for-clinical-trials/?EUCT=${encodeURIComponent(ctNumber)}&lang=en`, publishedAt: dateMs,
              summary: `EU CT Number: ${ctNumber}. Phase: ${phase}.`, tags: mergeTags(tags, ['Clinical Trial', 'EU CTR']), score,
              sources: [{ name: 'CTIS', category: 'Clinical Trials', type: 'api' }]
            });
            if (na) allProcessed.push(na);
          } else { counts.score0++; }
        }
        page++;
      }
      log(`Success (Raw: ${counts.raw}, Accepted: ${counts.accepted})`, 'success', 'CTIS');
      updateMetric('success', counts);
    } catch (e) { log(`API Failure: ${e?.message || 'Unknown error'}`, 'error', 'CTIS'); updateMetric('error', counts); }
  };

  const fetchCT = async () => {
    const counts = { raw: 0, old: 0, score0: 0, accepted: 0 };
    try {
      log('Querying: ClinicalTrials.gov', 'info', 'ClinicalTrials.gov');
      
      // NO MORE CHUNKING: Send the master query!
      let pageToken = ''; let pageCount = 0; let reachedOldRecords = false; 

      do {
        if (pageCount >= 5 || reachedOldRecords) break;
        const url = `https://clinicaltrials.gov/api/v2/studies?query.term=${encodeURIComponent(MASTER_DB_QUERY)}&query.intr=vaccine&filter.advanced=${encodeURIComponent('AREA[HasResults]true')}&pageSize=100&sort=LastUpdatePostDate:desc${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
        const data = await fetchJsonRetry(url);
        
        if (data?.studies) {
          for (const study of data.studies) {
            const phases = study.protocolSection?.designModule?.phases || [];
            if (!(study.hasResults === true || study.protocolSection?.statusModule?.hasResults === true) || !phases.some(p => String(p).includes('PHASE2') || String(p).includes('PHASE3') || String(p).includes('PHASE4'))) continue;
            
            counts.raw++;
            const id = study.protocolSection?.identificationModule?.nctId || '';
            const title = study.protocolSection?.identificationModule?.briefTitle || '';
            const pubDateMs = parseMs(study.protocolSection?.statusModule?.lastUpdatePostDateStruct?.date, 0);

            if (pubDateMs > 0 && pubDateMs < cutoff15DaysMs) { counts.old++; reachedOldRecords = true; break; }
            const { tags, score } = scoreItem(title, `${id} ${study.protocolSection?.statusModule?.overallStatus || ''}`, 'Clinical Trials', 'ClinicalTrials.gov');
            if (score > 0) {
              counts.accepted++;
              const na = normalizeArticle({
                sourceName: 'ClinicalTrials.gov', sourceType: 'api', category: 'Clinical Trials', title, url: id ? `https://clinicaltrials.gov/study/${id}` : '', publishedAt: pubDateMs,
                summary: `NCT ID: ${id}. Trial Status: ${study.protocolSection?.statusModule?.overallStatus || 'Unknown'}.`, tags: mergeTags(tags, ['Clinical Trial', 'CT.gov']), score,
                sources: [{ name: 'ClinicalTrials.gov', category: 'Clinical Trials', type: 'api' }]
              });
              if (na) allProcessed.push(na);
            } else { counts.score0++; }
          }
        }
        pageToken = data?.nextPageToken || ''; pageCount++;
      } while (pageToken);
      
      log(`Success (Raw: ${counts.raw}, Accepted: ${counts.accepted})`, 'success', 'CT.gov');
      updateMetric('success', counts);
    } catch (e) { log(`API Failure: ${e?.message || 'Unknown error'}`, 'error', 'CT.gov'); updateMetric('error', counts); }
  };

  const fetchPubMed = async () => {
    const counts = { raw: 0, old: 0, score0: 0, accepted: 0 };
    try {
      log('Querying: PubMed', 'info', 'PubMed');
      
      // INSERTED MASTER_DB_QUERY DIRECTLY
      const pubmedBody = new URLSearchParams({ db: 'pubmed', term: MASTER_DB_QUERY, mindate: fifteenDaysAgoStr.replace(/-/g, '/'), maxdate: tomorrowStr.replace(/-/g, '/'), datetype: 'pdat', retmode: 'json', retmax: '100' });
      const data = await fetchJsonRetry(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi`, { method: 'POST', body: pubmedBody, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      
      const ids = data?.esearchresult?.idlist || [];
      if (!ids.length) { updateMetric('success', counts); return; }

      const summaryData = await fetchJsonRetry(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`);
      for (const id of ids) {
        const item = summaryData?.result?.[id];
        if (!item) continue;
        counts.raw++;
        const pubDateMs = parseMs(item.pubdate, 0);

        if (pubDateMs && pubDateMs < cutoff15DaysMs) { counts.old++; continue; }
        const { score, tags } = scoreItem(item.title, item.source, 'publication', `PubMed (${item.source})`);
        if (score > 0) {
          counts.accepted++;
          const na = normalizeArticle({
            sourceName: 'PubMed', publisherName: item.source, sourceType: 'api', category: 'publication', title: item.title, url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`, publishedAt: pubDateMs,
            summary: `Authors: ${item.authors?.[0]?.name || 'Unknown'}. Source: ${item.source}.`, tags: mergeTags(tags, ['Study', 'PubMed']), score,
            sources: [{ name: 'PubMed', category: 'publication', type: 'api' }]
          });
          if (na) allProcessed.push(na);
        } else { counts.score0++; }
      }
      log(`Success (Raw: ${counts.raw}, Accepted: ${counts.accepted})`, 'success', 'PubMed');
      updateMetric('success', counts);
    } catch (e) { log(`API Failure: ${e?.message || 'Unknown error'}`, 'error', 'PubMed'); updateMetric('error', counts); }
  };

const fetchPreprints = async (server) => {
  const counts = { raw: 0, old: 0, score0: 0, accepted: 0 };
  try {
    log(`Querying: ${server}`, 'info', server);
    
    // Official bioRxiv/medRxiv API format
    const url = `https://api.biorxiv.org/details/${server}/${fifteenDaysAgoStr}/${todayStr}`;
    const data = await fetchJsonRetry(url, {}, 3, 30000);
    const results = data?.collection || [];

    if (!results.length) {
      updateMetric('success', counts);
      return;
    }

    for (const item of results) {
      counts.raw++;
      const pubDateMs = parseMs(item.date, 0);

      if (pubDateMs > 0 && pubDateMs < cutoff15DaysMs) {
        counts.old++;
        continue;
      }

      const abstract = item.abstract || '';
      const { score, tags } = scoreItem(item.title, abstract, 'Preprints', server);

      if (score > 0) {
        counts.accepted++;
        const na = normalizeArticle({
          sourceName: server === 'medrxiv' ? 'medRxiv' : 'bioRxiv',
          sourceType: 'api',
          category: 'Preprints',
          title: item.title,
          url: `https://doi.org/${item.doi}`,
          publishedAt: pubDateMs,
          summary: safeExcerpt(abstract),
          tags: mergeTags(tags, ['Preprint', server]),
          score,
          sources: [{ name: server === 'medrxiv' ? 'medRxiv' : 'bioRxiv', category: 'Preprints', type: 'api' }]
        });
        if (na) allProcessed.push(na);
      } else {
        counts.score0++;
      }
    }

    log(`Success (Raw: ${counts.raw}, Accepted: ${counts.accepted})`, 'success', server);
    updateMetric('success', counts);
  } catch (e) {
    log(`API Failure: ${e?.message || 'Unknown error'}`, 'error', server);
    updateMetric('error', counts);
  }
};

const fetchAmedeo = async () => {
  const counts = { raw: 0, old: 0, score0: 0, accepted: 0 };
  try {
    log('Querying: Amedeo', 'info', 'Amedeo');
    const content = await fetchTextRetry('https://amedeo.com/medicine/vac/vaccine.htm');
    if (!content) { updateMetric('success', counts); return; }

    const pmids = Array.from(
      content.matchAll(/(?:pubmed\.ncbi\.nlm\.nih\.gov\/|ncbi\.nlm\.nih\.gov\/pubmed\/|PMID\s*:\s*)(\d{7,8})/gi)
    ).map(m => m[1]);

    const uniquePmids = Array.from(new Set(pmids)).slice(0, 100);
    if (!uniquePmids.length) { updateMetric('success', counts); return; }

    const lim = makeLimiter(4);
    const tasks = uniquePmids.map((pmid) => lim(async () => {
      const item = await epmcFetchOneByPmid(pmid);
      if (!item) return;

      counts.raw++;
      const title = stripHtml(item.title || '');
      const pubDateMs = parseMs(item.firstPublicationDate, 0);

      if (pubDateMs > 0 && pubDateMs < cutoff15DaysMs) {
        counts.old++;
        return;
      }

      const abstract = item.abstractText ? stripHtml(item.abstractText) : '';
      const { tags, score } = scoreItem(title, abstract, 'publication', 'Amedeo');

      if (score <= 0) {
        counts.score0++;
        return;
      }

      counts.accepted++;
     const na = normalizeArticle({
        sourceName: 'Amedeo',
        publisherName: item.journalTitle || item.publisher || 'PubMed',
        sourceType: 'api',
        category: 'publication',
        title: title || `PMID ${pmid}`,
        url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
        publishedAt: pubDateMs,
        summary: `PMID: ${pmid}. ${item.doi ? `DOI: ${item.doi}. ` : ''}${abstract}`,
        tags: mergeTags(tags, ['Study']),
        score: (score || 0) + 3.0,
        sources: [{ name: 'Amedeo', category: 'publication', type: 'html' }],
        meta: { isAmedeoSource: true }
      });

      if (na) allProcessed.push(na);
    }));

    await Promise.allSettled(tasks);
    log(`Success (Raw: ${counts.raw}, Accepted: ${counts.accepted})`, 'success', 'Amedeo');
    updateMetric('success', counts);
  } catch (e) {
    log(`API Failure: ${e?.message || 'Unknown error'}`, 'error', 'Amedeo');
    updateMetric('error', counts);
  }
};
  const fetchHealthCanadaDPD = async () => {
    const counts = { raw: 0, old: 0, score0: 0, accepted: 0 };
    const sourceName = 'HC DPD (Vaccines)';
    
    try {
      log(`Querying: ${sourceName}`, 'info', sourceName);
      
      // We only fetch the endpoints Health Canada actually exposes via JSON.
      const [productData, ingredientData] = await Promise.all([
        fetchJsonRetry('https://health-products.canada.ca/api/drug/drugproduct/?lang=en&type=json'),
        fetchJsonRetry('https://health-products.canada.ca/api/drug/activeingredient/?lang=en&type=json')
      ]);

      const productMap = new Map();
      (productData || []).forEach(p => productMap.set(p.drug_code, p));

      const ingredientMap = new Map();
      (ingredientData || []).forEach(ing => {
        if (!ingredientMap.has(ing.drug_code)) ingredientMap.set(ing.drug_code, []);
        ingredientMap.get(ing.drug_code).push(ing.ingredient_name);
      });

      // 1. MUST contain a targeted pathogen
      const pathogenRx = /(sars-cov-2|covid|pneumococcal|meningococcal|pertussis|diphtheria|tetanus|influenza|haemophilus|varicella|zoster|rotavirus|polio|measles|mumps|rubella|hepatitis|papillomavirus|hpv|rsv|respiratory syncytial|rabies|cholera|typhoid|bcg|tuberculosis|yellow fever|japanese encephalitis|mpox|ebola)/i;

      // 2. MUST contain a vaccine-specific formulation keyword
      const vaccineTypeRx = /(vaccine|vaccin)/i;

      // Identify all Drug Codes that are vaccines (Enforcing the strict AND logic)
      const vaccineDrugCodes = new Set();
      
      productMap.forEach((product, drugCode) => {
        const brandName = product.brand_name || '';
        const ingredients = (ingredientMap.get(drugCode) || []).join(' ');
        
        // Combine the brand name and ingredients into one string
        const combinedText = `${brandName} ${ingredients}`;
        
        // STRICT FILTER: It must match BOTH regexes
        if (pathogenRx.test(combinedText) && vaccineTypeRx.test(combinedText)) {
          vaccineDrugCodes.add(drugCode);
        }
      });

      for (const drugCode of vaccineDrugCodes) {
        const product = productMap.get(drugCode);
        if (!product) continue;

        // Use the last update date from the main product API
        const dateStr = product.last_update_date || '';
        const pubDateMs = parseMs(dateStr, 0);

        counts.raw++;

        if (pubDateMs > 0 && pubDateMs < cutoff15DaysMs) {
          counts.old++;
          continue;
        }

        const brandName = product.brand_name || 'Unknown Vaccine';
        const din = product.drug_identification_number || 'N/A';
        const ingredients = (ingredientMap.get(drugCode) || []).join(', ');
        
        // Build the official Health Canada URL manually since the Document API is blocked
        const docUrl = `https://health-products.canada.ca/dpd-bdpp/info.do?lang=en&code=${drugCode}`;

        const title = `Product Monograph Update: ${brandName}`;
        const summary = `Health Canada has updated the Drug Product Database for ${brandName} (Active ingredients: ${ingredients}, DIN: ${din}).`;

        const { score, tags } = scoreItem(title, summary, 'Guidance', sourceName);

        if (score > 0) {
          counts.accepted++;
          const normalized = normalizeArticle({
            sourceName: 'Health Canada DPD',
            publisherName: 'Health Canada',
            sourceType: 'api', 
            category: 'Guidance',
            title: title,
            url: docUrl,
            publishedAt: pubDateMs,
            summary: summary,
            // Force these tags so it hits your VIP INTEL_TRIGGERS & Regulatory Tab
            tags: mergeTags(tags, ['Canada', 'Regulatory']), 
            score: score + 1.5,
            sources: [{ name: sourceName, category: 'Guidance', type: 'api' }]
          });
          
          if (normalized) allProcessed.push(normalized);
        } else {
          counts.score0++;
        }
      }
      
      log(`Success (Raw: ${counts.raw}, Accepted: ${counts.accepted})`, 'success', sourceName);
      updateMetric('success', counts);
      
    } catch (e) {
      log(`API Failure: ${e?.message || 'Unknown error'}`, 'error', sourceName);
      updateMetric('error', counts);
    }
  };


try {
    const retryQueue = [];
    
    // Fixed wrapper: Catches actual thrown errors instead of relying on a global counter
    const runTask = async (name, fn) => {
      try {
        await fn();
      } catch (err) {
        retryQueue.push({ name, fn });
      }
    };

    const feedLimit = makeLimiter(2);
    const feedPromises = FEED_SOURCES.map(feed => feedLimit(() => runTask(feed.name, () => fetchFeedSource(feed))));
    
    // Group the heavy API calls together to run concurrently (much faster)
      const apiPromises = [
      runTask('ClinicalTrials.gov', fetchCT),
      runTask('PubMed', fetchPubMed),
      runTask('medRxiv', () => fetchPreprints('medrxiv')),
      runTask('bioRxiv', () => fetchPreprints('biorxiv')),
      runTask('CTIS', fetchCTIS),
      runTask('Amedeo', fetchAmedeo),
      runTask('HC DPD', fetchHealthCanadaDPD) // <-- ADDED LINE
    ];
    
    await Promise.allSettled([...feedPromises, ...apiPromises]);

    if (retryQueue.length > 0) {
      log(`Detected ${retryQueue.length} failed sources. Waiting 5 minutes to retry...`, 'info', 'Retry System');
      await sleep(5 * 60 * 1000); 
      log(`Commencing 2nd attempt for failed sources...`, 'info', 'Retry System');
      for (const task of retryQueue) {
        log(`Retrying ${task.name}...`, 'info', 'Retry System');
        await task.fn();
      }
    }

} catch (e) { log(`Pipeline Failure: ${e?.message || 'Unknown error'}`, 'error', 'System'); }

// --- INJECT CHATGPT SEARCH RESULTS ---
  try {
    // This forces Node to look in the same folder as the scraper script!
    const aiDirPath = path.join(__dirname, 'ai_inputs'); 
    
    log(`Checking for AI files in: ${aiDirPath}`, 'info', 'ChatGPT'); // Added a log so you can see the path
    
    if (fs.existsSync(aiDirPath)) {
      const aiFiles = fs.readdirSync(aiDirPath).filter(file => file.endsWith('.json'));
      
      if (aiFiles.length > 0) {
        log(`Found ${aiFiles.length} ChatGPT summary files, processing...`, 'info', 'ChatGPT');
        
        for (const file of aiFiles) {
          try {
            const aiData = JSON.parse(fs.readFileSync(path.join(aiDirPath, file), 'utf8'));
            
            if (Array.isArray(aiData.items)) {
              for (const item of aiData.items) {
                // 1. Robust Date Extraction
                let parsedAiDateMs = Date.now();
                const dateMatch = item.summary ? item.summary.match(/(?:Published|Date)[:\s]*(?:on\s+)?([A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})/i) : null;
                
                if (dateMatch && dateMatch[1]) {
                  const cleanDateStr = dateMatch[1].replace(/(st|nd|rd|th)/i, '').replace(',', '');
                  const extractedMs = Date.parse(cleanDateStr);
                  if (!Number.isNaN(extractedMs)) {
                    parsedAiDateMs = extractedMs;
                  }
                }

                // 2. Score & Normalize
                const { tags, score } = scoreItem(item.title, item.summary, 'AI Search', 'ChatGPT');
                const siteName = getDomain(item.url) || 'Web Source';
                
                const aiArticle = normalizeArticle({
                  sourceName: siteName, 
                  sourceType: 'api',
                  category: 'AI Search',
                  title: item.title,
                  url: item.url || 'https://chatgpt.com',
                  publishedAt: parsedAiDateMs, 
                  summary: item.summary,
                  tags: mergeTags(tags, ['🤖 AI Insight']), 
                  score: (score || 0) + 5.0, 
                  sources: [{ name: siteName, category: 'AI Search', type: 'api' }] 
                });
                
                if (aiArticle) allProcessed.push(aiArticle);
              }
              log(`Successfully merged ${aiData.items.length} ChatGPT results from ${file}.`, 'success', 'ChatGPT');
            } else {
              log(`ChatGPT file ${file} found, but "items" array was missing.`, 'error', 'ChatGPT');
            }
          } catch (parseErr) {
            log(`Failed to parse specific file ${file}: ${parseErr.message}`, 'error', 'ChatGPT');
          }
        } 
      } else {
        log(`Folder exists, but no .json files found inside.`, 'info', 'ChatGPT');
      }
    } else {
      log(`AI folder does not exist at ${aiDirPath}`, 'info', 'ChatGPT');
    }
  } catch (err) {
    log('Failed during AI directory scan: ' + err.message, 'error', 'ChatGPT');
  }
  // -------------------------------------


  const results = dedupeAndMerge(allProcessed);
  scanMetrics.dedupedUnique = results.length;
  log(`Pipeline Complete: Extracted ${results.length} unique signals.`, 'success', 'System');

  const outputData = {
    lastUpdated: Date.now(),
    articles: results,
    scanLog: scanLog,
    scanMetrics: scanMetrics
  };

  if (!fs.existsSync('public')) fs.mkdirSync('public');
  fs.writeFileSync('public/news_data.json', JSON.stringify(outputData, null, 2));
  console.log(`Saved ${results.length} articles to public/news_data.json`);
};

runScraper();
