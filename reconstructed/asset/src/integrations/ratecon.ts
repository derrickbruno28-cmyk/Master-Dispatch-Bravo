/* RateConParser — turn a dropped rate-confirmation PDF into pre-filled Load
   fields behind an interface, exactly like the other integrations. Ship-state:
   PdfRateConParser extracts the PDF's text with pdf.js (a local library, NO
   external service / key) and reads the common fields with regexes. Whatever it
   finds is applied to the Create-Load form as a SUGGESTION — every value is
   highlighted and the dispatcher must verify before the load can be saved.

   The extracted raw text is returned on the result so a future OCR / AI parser
   can be dropped in behind this same interface (see TODO below) without
   touching any view code. */

import type { Load, LoadStop } from '../data/loadsStore';
import { blankStop } from '../data/loadsStore';

export interface RateConFields {
  routeName?: string;
  customerName?: string;
  rate?: number;
  weight?: string;
  referenceNo?: string;
  commodity?: string;
  equipment?: string;
  pickup?: Partial<LoadStop>;
  delivery?: Partial<LoadStop>;
}

export interface RateConResult {
  fields: RateConFields;
  filled: string[];          // human labels of what was auto-filled (for the banner)
  keys: string[];            // Load field keys that were auto-filled (for highlight)
  text: string;              // raw extracted text — hook for a future OCR/AI parser
  confidence: 'low' | 'medium' | 'high';
}

export interface RateConParser {
  readonly label: string;
  parse(file: File): Promise<RateConResult>;
}

/* ---- field regexes — tuned for USPS / broker rate cons, forgiving of layout ---- */
function firstMatch(text: string, res: RegExp[]): string {
  for (const re of res) { const m = text.match(re); if (m && m[1]) return m[1].trim(); }
  return '';
}
function money(s: string): number | undefined {
  const m = s.replace(/[, ]/g, '').match(/(\d+(?:\.\d{1,2})?)/);
  return m ? Number(m[1]) : undefined;
}

/* address-ish blocks like "Dallas, TX 75201" → {city,state,zip} */
function parseCityStateZip(block: string): Partial<LoadStop> {
  const m = block.match(/([A-Za-z .'-]+?),?\s+([A-Z]{2})\s+(\d{5})(?:-\d{4})?/);
  if (!m) return {};
  return { city: m[1].trim().replace(/\s{2,}/g, ' '), state: m[2], zip: m[3] };
}

export function parseRateConText(text: string): RateConResult {
  const t = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ');
  const fields: RateConFields = {};
  const filled: string[] = [];
  const keys: string[] = [];
  const add = (key: keyof RateConFields, label: string) => { filled.push(label); keys.push(key); };

  const load = firstMatch(t, [
    /(?:Load|Order|Trip|Pro|Shipment)\s*(?:#|No\.?|Number)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{3,})/i,
    /Confirmation\s*(?:#|No\.?)?\s*[:#]?\s*([A-Z0-9-]{4,})/i,
  ]);
  if (load) { fields.referenceNo = load; add('referenceNo', `Reference # (${load})`); }

  const broker = firstMatch(t, [
    /(?:Broker|Customer|Bill To|Shipper Company|Company)\s*[:\-]?\s*([A-Z][A-Za-z0-9 &.,'-]{2,40})/,
  ]);
  if (broker) { fields.customerName = broker.replace(/\s+(Inc|LLC|Corp|Co)\b.*$/i, (m) => m).trim(); add('customerName', 'Customer'); }

  const rateStr = firstMatch(t, [
    /(?:Total|Line\s*Haul|Rate|Amount|Pay|Carrier\s*Pay)\s*(?:Rate|Pay|Amount)?\s*[:\-]?\s*\$?\s*([\d,]+(?:\.\d{2})?)/i,
    /\$\s*([\d,]+\.\d{2})/,
  ]);
  const rate = rateStr ? money(rateStr) : undefined;
  if (rate && rate > 0) { fields.rate = rate; add('rate', `Rate ($${rate.toLocaleString()})`); }

  const weight = firstMatch(t, [
    /Weight\s*[:\-]?\s*([\d,]+)\s*(?:lbs?|pounds?)?/i,
    /([\d,]{4,})\s*lbs?\b/i,
  ]);
  if (weight) { fields.weight = `${weight.replace(/,/g, '')} lbs`; add('weight', 'Weight'); }

  const commodity = firstMatch(t, [
    /Commodity\s*[:\-]?\s*([A-Za-z][A-Za-z0-9 /&.,'-]{2,40})/i,
    /Freight\s*(?:Description|Desc)?\s*[:\-]?\s*([A-Za-z][A-Za-z0-9 /&.,'-]{2,40})/i,
  ]);
  if (commodity) { fields.commodity = commodity.trim(); add('commodity', 'Commodity'); }

  const equipment = firstMatch(t, [
    /Equipment\s*(?:Type)?\s*[:\-]?\s*(53'?\s*(?:Dry\s*Van|Van|Reefer)|Dry\s*Van|Reefer|Flatbed|Van|Power\s*Only)/i,
    /\b(53'\s*Van|Dry\s*Van|Reefer|Flatbed|Power\s*Only)\b/i,
  ]);
  if (equipment) { fields.equipment = equipment.replace(/\s+/g, ' ').trim(); add('equipment', 'Equipment'); }

  /* pickup (shipper) + delivery (consignee) — grab the address line that follows the label */
  const puBlock = firstMatch(t, [/(?:Pick\s*up|Pickup|Shipper|Origin)\s*(?:Address|Location)?\s*[:\-]?\s*([A-Za-z0-9 .,'#-]+?,\s*[A-Z]{2}\s*\d{5})/i]);
  if (puBlock) { const csz = parseCityStateZip(puBlock); if (csz.city) { fields.pickup = { ...csz, address: puBlock.trim() }; add('pickup', `Pickup (${csz.city}, ${csz.state})`); } }
  const delBlock = firstMatch(t, [/(?:Delivery|Consignee|Receiver|Destination|Drop)\s*(?:Address|Location)?\s*[:\-]?\s*([A-Za-z0-9 .,'#-]+?,\s*[A-Z]{2}\s*\d{5})/i]);
  if (delBlock) { const csz = parseCityStateZip(delBlock); if (csz.city) { fields.delivery = { ...csz, address: delBlock.trim() }; add('delivery', `Delivery (${csz.city}, ${csz.state})`); } }

  /* derive a route name from the lane if we found both ends */
  if (fields.pickup?.city && fields.delivery?.city) {
    fields.routeName = `${fields.pickup.city}→${fields.delivery.city}`;
    add('routeName', 'Route name');
  }

  const confidence: RateConResult['confidence'] = keys.length >= 5 ? 'high' : keys.length >= 2 ? 'medium' : 'low';
  return { fields, filled, keys, text, confidence };
}

/* ---- pdf.js extractor (lazy-loaded so it never bloats the main bundle) ---- */
async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  let text = '';
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    text += content.items.map((it) => ('str' in it ? (it as { str: string }).str : '')).join(' ') + '\n';
  }
  return text;
}

class PdfRateConParser implements RateConParser {
  readonly label = 'Rate-con reader: pdf.js text + regex';
  async parse(file: File): Promise<RateConResult> {
    if (/\.txt$/i.test(file.name) || file.type === 'text/plain') {
      return parseRateConText(await file.text());       // dev/testing convenience
    }
    const text = await extractPdfText(file);
    return parseRateConText(text);
  }
}
/* TODO(go-live): swap in an OCR/AI parser for scanned (image-only) rate cons —
   implement RateConParser to POST result of extractPdfText (or the raw PDF) to a
   vision model and return the same RateConResult shape. Views need no change. */

const parser: RateConParser = new PdfRateConParser();
export function rateConParser(): RateConParser { return parser; }

/* merge parsed fields onto a Load; returns the Load keys that were changed so the
   form can highlight them for verification */
export function applyRateCon(l: Load, f: RateConFields): { load: Load; changed: string[] } {
  const changed: string[] = [];
  const out = { ...l };
  const set = <K extends keyof Load>(k: K, v: Load[K]) => { out[k] = v; changed.push(k as string); };
  if (f.routeName && !l.routeName.trim()) set('routeName', f.routeName);
  if (f.customerName) set('customerName', f.customerName);
  if (f.rate != null) set('rate', f.rate);
  if (f.weight) set('weight', f.weight);
  if (f.referenceNo) set('referenceNo', f.referenceNo);
  if (f.commodity) set('commodity', f.commodity);
  if (f.equipment) set('equipment', f.equipment);
  if (f.pickup || f.delivery) {
    const stops = l.stops.slice();
    const applyStop = (type: LoadStop['type'], patch?: Partial<LoadStop>) => {
      if (!patch) return;
      let idx = stops.findIndex((s) => s.type === type);
      if (idx < 0) { stops.push(blankStop(type, stops.length + 1)); idx = stops.length - 1; }
      stops[idx] = { ...stops[idx], ...patch };
    };
    applyStop('pickup', f.pickup);
    applyStop('delivery', f.delivery);
    out.stops = stops;
    changed.push('stops');
  }
  return { load: out, changed };
}
