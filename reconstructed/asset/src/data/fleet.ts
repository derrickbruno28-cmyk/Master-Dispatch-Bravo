import { ROUTE_SEED } from './routesSeed';
import { FLEETIO_UNITS } from './fleetUnits';
/* Asset fleet data — ported from the AJG/GH Operations Center (Route Optimizer).
   Trucks, home terminals, and USPS route reference. The truck roster is seeded
   from the Fleetio vehicle export (see fleetUnits.ts) — real GH / AJG units,
   imported UNRATED and unassigned so dispatch can assign drivers + rate manually. */

export interface Truck {
  tractor: string; rating: string; driver1: string; driver2: string;
  type: string; currentCity: string; homeCity: string; returnDate: string;
  hoursAvail: number; status: string; currentRoute: string;
  make?: string; odometer?: number; constraints?: string;
}

export interface AssetRoute {
  route: string; freq: string; rate: string; miles: string;
  planning: string; departure: string; delivery: string; puTime: string;
}

export const CITY_COORDS: Record<string,{lat:number;lng:number}> = {COPPELL:{lat:32.9546,lng:-96.9902},IRVING:{lat:32.814,lng:-96.9489},DALLAS:{lat:32.7767,lng:-96.797},"GRAND PRAIRIE":{lat:32.746,lng:-96.9978},"SAN ANTONIO":{lat:29.4241,lng:-98.4936},SATX:{lat:29.4241,lng:-98.4936},AUSTIN:{lat:30.2672,lng:-97.7431},ATX:{lat:30.2672,lng:-97.7431},HOUSTON:{lat:29.7604,lng:-95.3698},"MISSOURI CITY":{lat:29.6186,lng:-95.5377},ABILENE:{lat:32.4487,lng:-99.7331},LUBBOCK:{lat:33.5779,lng:-101.8552},MEMPHIS:{lat:35.1495,lng:-90.049},NASHVILLE:{lat:36.1627,lng:-86.7816},KNOXVILLE:{lat:35.9606,lng:-83.9207},WARRENDALE:{lat:40.6365,lng:-80.0844},PHILLIPSBURG:{lat:40.6934,lng:-75.191},READING:{lat:40.3357,lng:-75.9269},SANDSTON:{lat:37.5213,lng:-77.3202},MERRIFIELD:{lat:38.8726,lng:-77.2289},ROANOKE:{lat:37.271,lng:-79.9414},OLATHE:{lat:38.8814,lng:-94.8191},WICHITA:{lat:37.6872,lng:-97.3301},"KANSAS CITY":{lat:39.0997,lng:-94.5786},HAZELWOOD:{lat:38.7714,lng:-90.3709},INDIANAPOLIS:{lat:39.7684,lng:-86.1581},LOUISVILLE:{lat:38.2527,lng:-85.7585},DENVER:{lat:39.7392,lng:-104.9903},"AURORA CO":{lat:39.7294,lng:-104.8319},"AURORA IL":{lat:41.7606,lng:-88.3201},CHICAGO:{lat:41.8781,lng:-87.6298},JACKSONVILLE:{lat:30.3322,lng:-81.6557},TAMPA:{lat:27.9506,lng:-82.4572},ORLANDO:{lat:28.5383,lng:-81.3792},"OPA LOCKA":{lat:25.9023,lng:-80.2501},"WEST PALM BEACH":{lat:26.7153,lng:-80.0534},TALLAHASSEE:{lat:30.4383,lng:-84.2807},PENSACOLA:{lat:30.4213,lng:-87.2169},PALMETTO:{lat:33.5118,lng:-84.641},FAIRBURN:{lat:33.5668,lng:-84.581},"RICHMOND CA":{lat:37.9358,lng:-122.3478},"SAN FRANCISCO":{lat:37.7749,lng:-122.4194},AVONDALE:{lat:33.4356,lng:-112.3496},"BATON ROUGE":{lat:30.4515,lng:-91.1871},"NEW ORLEANS":{lat:29.9511,lng:-90.0715},"LITTLE ROCK":{lat:34.7465,lng:-92.2896},"OKLAHOMA CITY":{lat:35.4676,lng:-97.5164},"COLUMBIA SC":{lat:34.0007,lng:-81.0348},"N CHARLESTON":{lat:32.8546,lng:-79.9748},"GREENVILLE SC":{lat:34.8526,lng:-82.394},GASTONIA:{lat:35.2621,lng:-81.1873},GREENSBORO:{lat:36.0726,lng:-79.792},RALEIGH:{lat:35.7796,lng:-78.6382},BIRMINGHAM:{lat:33.5186,lng:-86.8104},MONTGOMERY:{lat:32.3792,lng:-86.3077},HUNTSVILLE:{lat:34.7304,lng:-86.5861},MOBILE:{lat:30.6954,lng:-88.0399},"JACKSON MS":{lat:32.2988,lng:-90.1848},GULFPORT:{lat:30.3674,lng:-89.0928},"JERSEY CITY":{lat:40.7178,lng:-74.0431},CLEVELAND:{lat:41.4993,lng:-81.6944},AKRON:{lat:41.0814,lng:-81.519},"SAINT LOUIS":{lat:38.627,lng:-90.1994},"CORPUS CHRISTI":{lat:27.8006,lng:-97.3964},MCALLEN:{lat:26.2034,lng:-98.23},"AMARILLO":{lat:35.222,lng:-101.8313},"ANAHEIM":{lat:33.8366,lng:-117.9143},"ATLANTA":{lat:33.749,lng:-84.388},"AUSTN":{lat:30.2672,lng:-97.7431},"BEDFORD PARK":{lat:41.7639,lng:-87.807},"BELL GARDENS":{lat:33.9652,lng:-118.1517},"CAPITOL HEIGHTS":{lat:38.8854,lng:-76.9147},"CHARLESTON":{lat:32.7765,lng:-79.9311},"CHATANOOGA":{lat:35.0456,lng:-85.3097},"CINCINNATI":{lat:39.1031,lng:-84.512},"EVANSVILLE":{lat:37.9716,lng:-87.5711},"FAYETTEVILLE":{lat:35.0527,lng:-78.8784},"LEXINGTON":{lat:38.0406,lng:-84.5037},"MEMPHI":{lat:35.1495,lng:-90.049},"MIAMI":{lat:25.7617,lng:-80.1918},"MORENO VALLEY":{lat:33.9425,lng:-117.2297},"OAKLAND":{lat:37.8044,lng:-122.2712},"ROCHESTER":{lat:43.1566,lng:-77.6088},"SHREVEPORT":{lat:32.5252,lng:-93.7502},"SPOKANE":{lat:47.6588,lng:-117.426},"SPRINGFIELD":{lat:42.1015,lng:-72.5898},"WESTPALM":{lat:26.7153,lng:-80.0534}};

/* The roster IS the Fleetio export — one truck per unit, imported UNRATED
   (unitRating left blank; rate manually) and unassigned (no drivers) so dispatch
   can build teams and assign routes. Odometer + make come straight from Fleetio;
   the group (Gomez Haulers / AJG Transport) is kept in constraints so it's not
   lost. Out-of-service / in-shop units block assignment via the Fleetio service
   layer (see integrations/telematics), not the team-availability status. */
export const TRUCKS: Truck[] = FLEETIO_UNITS.map((u) => ({
  tractor: u.tractor,
  rating: '',
  driver1: '', driver2: '',
  type: 'OTR Team',
  currentCity: 'DALLAS', homeCity: 'DALLAS',
  returnDate: '',
  hoursAvail: 70,
  status: 'NTB',
  currentRoute: '',
  make: u.make,
  odometer: u.odometer,
  constraints: u.group,
}));

export const ROUTES: AssetRoute[] = ROUTE_SEED;

/* The three primary terminals the Asset Matrix schedules by (Houston kept as a 4th group). */
export const TERMINALS = ['SATX','DALLAS','MEMPHIS'] as const;
export const TERMINAL_LABELS: Record<string,string> = {
  SATX:'San Antonio, TX', DALLAS:'Dallas, TX', MEMPHIS:'Memphis, TN', HOUSTON:'Houston, TX' };
