/* The 9 USPS trip-ID fixtures from the spec.

   Run it:  npm run test:tripids
   (that bundles src/data/tms/rateconParse.ts first, so this test always runs the
   SHIPPED regex and cannot drift from it.)

   These identifiers are the reason Phase 8 exists: the separator is '-' OR '_',
   both live in production data, one identifier can carry three trip numbers, and
   the route prefix is not always FA2D3. Anything that does not match this shape
   is surfaced in the review screen as unrecognized rather than guessed at. */
import { parseTripId, findTripIds } from '../.tmp/rateconParse.mjs';

const FIXTURES = [
  ['FA2D3-544',            'FA2D3', ['544']],
  ['FA2D3_579',            'FA2D3', ['579']],
  ['FA2D3-1040',           'FA2D3', ['1040']],
  ['FA2D3_1019_071426_1',  'FA2D3', ['1019', '071426', '1']],
  ['7523D-7504',           '7523D', ['7504']],
  ['002D3-26ED2',          '002D3', ['26ED2']],
  ['002D3_26E29',          '002D3', ['26E29']],
  ['FA26E-41',             'FA26E', ['41']],
  ['FA2D3-26EDB',          'FA2D3', ['26EDB']],
];

let fail = 0;
for (const [raw, route, trips] of FIXTURES) {
  const got = parseTripId(raw);
  const ok = got && got.routeNumber === route && JSON.stringify(got.tripNumbers) === JSON.stringify(trips);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${raw.padEnd(20)} → ${got ? got.routeNumber + ' ' + JSON.stringify(got.tripNumbers) : 'null'}`);
}

/* it must also find them inside a document, and NOT invent one out of a date */
const doc = 'RATE CONFIRMATION  Trip FA2D3_1019_071426_1  Ship date 07-14-2026  PO 88-2210  Return 7523D-7504';
const found = findTripIds(doc);
console.log('\nin-document scan:', JSON.stringify(found.map(f => f.raw)));
const expected = ['FA2D3_1019_071426_1', '7523D-7504'];
const scanOk = JSON.stringify(found.map(f => f.raw)) === JSON.stringify(expected);
console.log(scanOk ? 'PASS  scan finds both trips and skips the date/PO' : `FAIL  scan expected ${JSON.stringify(expected)}`);
if (!scanOk) fail++;

console.log(`\n${FIXTURES.length + 1 - fail}/${FIXTURES.length + 1} passed`);
process.exit(fail ? 1 : 0);
