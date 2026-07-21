/* Asset fleet data — ported from the AJG/GH Operations Center (Route Optimizer).
   Trucks, home terminals, and USPS route reference. Demo data; Firestore-backed later. */

export interface Truck {
  tractor: string; rating: string; driver1: string; driver2: string;
  type: string; currentCity: string; homeCity: string; returnDate: string;
  hoursAvail: number; status: string; currentRoute: string;
}

export interface AssetRoute {
  route: string; freq: string; rate: string; miles: string;
  planning: string; departure: string; delivery: string; puTime: string;
}

export const CITY_COORDS: Record<string,{lat:number;lng:number}> = {COPPELL:{lat:32.9546,lng:-96.9902},IRVING:{lat:32.814,lng:-96.9489},DALLAS:{lat:32.7767,lng:-96.797},"GRAND PRAIRIE":{lat:32.746,lng:-96.9978},"SAN ANTONIO":{lat:29.4241,lng:-98.4936},SATX:{lat:29.4241,lng:-98.4936},AUSTIN:{lat:30.2672,lng:-97.7431},ATX:{lat:30.2672,lng:-97.7431},HOUSTON:{lat:29.7604,lng:-95.3698},"MISSOURI CITY":{lat:29.6186,lng:-95.5377},ABILENE:{lat:32.4487,lng:-99.7331},LUBBOCK:{lat:33.5779,lng:-101.8552},MEMPHIS:{lat:35.1495,lng:-90.049},NASHVILLE:{lat:36.1627,lng:-86.7816},KNOXVILLE:{lat:35.9606,lng:-83.9207},WARRENDALE:{lat:40.6365,lng:-80.0844},PHILLIPSBURG:{lat:40.6934,lng:-75.191},READING:{lat:40.3357,lng:-75.9269},SANDSTON:{lat:37.5213,lng:-77.3202},MERRIFIELD:{lat:38.8726,lng:-77.2289},ROANOKE:{lat:37.271,lng:-79.9414},OLATHE:{lat:38.8814,lng:-94.8191},WICHITA:{lat:37.6872,lng:-97.3301},"KANSAS CITY":{lat:39.0997,lng:-94.5786},HAZELWOOD:{lat:38.7714,lng:-90.3709},INDIANAPOLIS:{lat:39.7684,lng:-86.1581},LOUISVILLE:{lat:38.2527,lng:-85.7585},DENVER:{lat:39.7392,lng:-104.9903},"AURORA CO":{lat:39.7294,lng:-104.8319},"AURORA IL":{lat:41.7606,lng:-88.3201},CHICAGO:{lat:41.8781,lng:-87.6298},JACKSONVILLE:{lat:30.3322,lng:-81.6557},TAMPA:{lat:27.9506,lng:-82.4572},ORLANDO:{lat:28.5383,lng:-81.3792},"OPA LOCKA":{lat:25.9023,lng:-80.2501},"WEST PALM BEACH":{lat:26.7153,lng:-80.0534},TALLAHASSEE:{lat:30.4383,lng:-84.2807},PENSACOLA:{lat:30.4213,lng:-87.2169},PALMETTO:{lat:33.5118,lng:-84.641},FAIRBURN:{lat:33.5668,lng:-84.581},"RICHMOND CA":{lat:37.9358,lng:-122.3478},"SAN FRANCISCO":{lat:37.7749,lng:-122.4194},AVONDALE:{lat:33.4356,lng:-112.3496},"BATON ROUGE":{lat:30.4515,lng:-91.1871},"NEW ORLEANS":{lat:29.9511,lng:-90.0715},"LITTLE ROCK":{lat:34.7465,lng:-92.2896},"OKLAHOMA CITY":{lat:35.4676,lng:-97.5164},"COLUMBIA SC":{lat:34.0007,lng:-81.0348},"N CHARLESTON":{lat:32.8546,lng:-79.9748},"GREENVILLE SC":{lat:34.8526,lng:-82.394},GASTONIA:{lat:35.2621,lng:-81.1873},GREENSBORO:{lat:36.0726,lng:-79.792},RALEIGH:{lat:35.7796,lng:-78.6382},BIRMINGHAM:{lat:33.5186,lng:-86.8104},MONTGOMERY:{lat:32.3792,lng:-86.3077},HUNTSVILLE:{lat:34.7304,lng:-86.5861},MOBILE:{lat:30.6954,lng:-88.0399},"JACKSON MS":{lat:32.2988,lng:-90.1848},GULFPORT:{lat:30.3674,lng:-89.0928},"JERSEY CITY":{lat:40.7178,lng:-74.0431},CLEVELAND:{lat:41.4993,lng:-81.6944},AKRON:{lat:41.0814,lng:-81.519},"SAINT LOUIS":{lat:38.627,lng:-90.1994},"CORPUS CHRISTI":{lat:27.8006,lng:-97.3964},MCALLEN:{lat:26.2034,lng:-98.23}};

export const TRUCKS: Truck[] = [
{tractor:"447",rating:"A (G)(I)",driver1:"Christopher Rinehart",driver2:"Erin del Bosque",type:"OMNI Weekly Team",currentCity:"COPPELL",homeCity:"DALLAS",returnDate:"",hoursAvail:55,status:"dispatched",currentRoute:"LS 16182 - VA to TX"},
{tractor:"458",rating:"A",driver1:"Timothy Brown",driver2:"Ibrahima Fall",type:"OMNI Weekly Team",currentCity:"COPPELL",homeCity:"DALLAS",returnDate:"",hoursAvail:48,status:"dispatched",currentRoute:"LS 16183 - OMNI"},
{tractor:"761",rating:"A (I)",driver1:"Carlos Ramirez",driver2:"",type:"OTR Solo",currentCity:"DALLAS",homeCity:"DALLAS",returnDate:"03/03",hoursAvail:32,status:"delivering",currentRoute:"16151 VA-TX"},
{tractor:"456",rating:"A",driver1:"Robert Spangler Sr.",driver2:"Jose Guajardo",type:"OTR Team",currentCity:"SATX",homeCity:"SATX",returnDate:"03/02",hoursAvail:45,status:"delivering",currentRoute:"16186 SC-TX"},
{tractor:"758",rating:"A (I)",driver1:"Rafael Gama",driver2:"Salvador Luna",type:"OTR Team",currentCity:"OPA LOCKA",homeCity:"SATX",returnDate:"",hoursAvail:60,status:"en route",currentRoute:"DH to OPA → 16193 Opa-Irv"},
{tractor:"765",rating:"A (G)(I)",driver1:"Derek Brewer",driver2:"Derrick Frazier",type:"OTR Team",currentCity:"MEMPHIS",homeCity:"DALLAS",returnDate:"03/25",hoursAvail:58,status:"en route",currentRoute:"16191 TN-VA"},
{tractor:"957",rating:"A",driver1:"Daniel Williams",driver2:"Ricky Rodriguez",type:"OTR Team",currentCity:"COPPELL",homeCity:"SATX",returnDate:"End of March",hoursAvail:52,status:"en route",currentRoute:"16207 COP-CO"},
{tractor:"759",rating:"A",driver1:"Jermaine Thomas",driver2:"Martez Jackson",type:"OTR Team",currentCity:"IRVING",homeCity:"DALLAS",returnDate:"",hoursAvail:50,status:"en route",currentRoute:"16189 IRV-CO"},
{tractor:"444",rating:"A (G)(I)",driver1:"Bruce Woodrum",driver2:"Anthony Garcia",type:"OTR Team",currentCity:"HOUSTON",homeCity:"SATX",returnDate:"",hoursAvail:0,status:"on 34hr reset",currentRoute:"⏰ ON 34 - Houston"},
{tractor:"766",rating:"A (G)(I)",driver1:"Kyonna Harrison",driver2:"Derrick Mitchell",type:"OTR Team",currentCity:"DENVER",homeCity:"DALLAS",returnDate:"End of Feb",hoursAvail:0,status:"on 34hr reset",currentRoute:"⏰ ON 34 - Colorado"},
{tractor:"443",rating:"A (G)(I)",driver1:"Davonte Galbert",driver2:"Erick Hall",type:"OTR Team",currentCity:"MEMPHIS",homeCity:"DALLAS",returnDate:"",hoursAvail:46,status:"en route",currentRoute:"16190 Mem-SC"},
{tractor:"748",rating:"A I",driver1:"Luis Trinidad",driver2:"Silvestre Contreras",type:"OTR Team",currentCity:"RALEIGH",homeCity:"SATX",returnDate:"04/02",hoursAvail:55,status:"en route",currentRoute:"16192 NC-FL"},
{tractor:"455",rating:"A",driver1:"Claude Whisenhunt",driver2:"Damon Spencer",type:"OTR Team",currentCity:"MEMPHIS",homeCity:"DALLAS",returnDate:"",hoursAvail:0,status:"on 34hr reset",currentRoute:"⏰ ON 34 - Memphis"},
{tractor:"436",rating:"A",driver1:"Donna Langston",driver2:"Brian Laitinen",type:"OTR Team",currentCity:"SATX",homeCity:"SATX",returnDate:"",hoursAvail:60,status:"dispatched",currentRoute:"16156 SATX-NJ"},
{tractor:"769",rating:"A (G)(I)",driver1:"Oscar Flores Jr",driver2:"Jennifer Flores",type:"OTR Team",currentCity:"RALEIGH",homeCity:"SATX",returnDate:"03/06",hoursAvail:50,status:"en route",currentRoute:"16228 NC-TX"},
{tractor:"757",rating:"A (I)",driver1:"Alexander Brenes",driver2:"Stephen Ward",type:"OTR Team",currentCity:"PALMETTO",homeCity:"DALLAS",returnDate:"03/06",hoursAvail:42,status:"en route",currentRoute:"16201 GA-TX"},
{tractor:"768",rating:"A (G)(I)",driver1:"Uri Montano",driver2:"Victor Arredondo",type:"OTR Team",currentCity:"COPPELL",homeCity:"SATX",returnDate:"03/13",hoursAvail:56,status:"en route",currentRoute:"16187 COP-GA"},
{tractor:"958",rating:"A",driver1:"Jamarrio Loggins",driver2:"",type:"Memphis Local",currentCity:"MEMPHIS",homeCity:"MEMPHIS",returnDate:"",hoursAvail:40,status:"en route",currentRoute:"16230 VA-DAL"},
{tractor:"764",rating:"A (G)(I)",driver1:"Kevon Terrell",driver2:"Demariye Collins",type:"OTR Team",currentCity:"COPPELL",homeCity:"DALLAS",returnDate:"",hoursAvail:48,status:"en route",currentRoute:"16188 COP-PA"},
];

export const ROUTES: AssetRoute[] = [
{route:"Coppell, TX - Warrendale, PA FA2D3-5001 TRIP B",freq:"Daily Except Monday",rate:"$2500-$2900",miles:"1253",planning:"Live/Preload",departure:"12:30",delivery:"02:10 Next Day",puTime:"00:00"},
{route:"Coppell, TX - Olathe, KS FA2D3-5003 TRIP A",freq:"Daily",rate:"$1050-$1200",miles:"511",planning:"DROP/PO",departure:"00:30",delivery:"11:05 Same Day",puTime:"00:30"},
{route:"Coppell, TX - Indianapolis FA2D3-5002 TRIP A",freq:"Wed-Fri",rate:"$1600-$1800",miles:"886",planning:"DROP/PO",departure:"00:45",delivery:"20:20 Same Day",puTime:"00:45"},
{route:"Coppell, TX - Warrendale PA FA2D3-572 TRIP A",freq:"Daily Except Sun/Mon",rate:"$2000-$2400",miles:"1249",planning:"PRELOAD",departure:"02:00",delivery:"03:40 Next Day",puTime:"01:30"},
{route:"Coppell TX - Denver, CO FA2D3-575 TRIP A",freq:"Daily Except Mon",rate:"$2000-$2400",miles:"776",planning:"PRELOAD",departure:"02:30",delivery:"17:05 Same Day",puTime:"01:45"},
{route:"Coppell TX - Olathe KS FA2D3-580 TRIP A",freq:"Daily Except Mon",rate:"$1000-$1150",miles:"517",planning:"PRELOAD",departure:"02:30",delivery:"12:35 Same Day",puTime:"02:00"},
{route:"Coppell, TX - Indianapolis FA2D3-27 TRIP A",freq:"Daily Except Mon",rate:"$1600-$1800",miles:"886",planning:"PRELOAD",departure:"03:00",delivery:"22:00 Same Day",puTime:"02:25"},
{route:"Coppell TX - Baton Rouge LA - New Orleans LA FA2D3-568",freq:"Daily Except Mon",rate:"$1400-$1600",miles:"520",planning:"PRELOAD",departure:"03:00",delivery:"14:05 Same Day",puTime:"02:30"},
{route:"Coppell, TX - Jacksonville FL FA2D3-6 TRIP A",freq:"Daily Except Sun/Mon",rate:"$2000-$2300",miles:"1117",planning:"PRELOAD",departure:"03:00",delivery:"00:05 Next Day",puTime:"02:30"},
{route:"Coppell TX - Palmetto, GA FA2D3-4 TRIP A",freq:"Daily Except Mon",rate:"$1800-$2100",miles:"805",planning:"PRELOAD",departure:"03:00",delivery:"19:40 Same Day",puTime:"02:30"},
{route:"Coppell TX - Aurora IL FA2D3-597 TRIP A",freq:"Daily",rate:"$1600-$1800",miles:"906",planning:"PRELOAD",departure:"04:30",delivery:"23:30 Same Day",puTime:"04:00"},
{route:"Coppell TX - San Antonio TX FA2D3-569",freq:"Daily Except Mon",rate:"$500-$700",miles:"297",planning:"PRELOAD",departure:"04:00",delivery:"08:55 Same Day",puTime:"02:30"},
{route:"Coppell - Missouri City (S Houston) FA2D3-48",freq:"Daily",rate:"$600-$800",miles:"254",planning:"PRELOAD",departure:"03:00",delivery:"08:35 Same Day",puTime:"02:30"},
{route:"Coppell TX - Richmond, CA FA2D3-553 TRIP B",freq:"Daily Except Mon",rate:"$3500-$4000",miles:"1709",planning:"LIVE/LIVE",departure:"04:30",delivery:"14:20 Next Day",puTime:"04:00"},
{route:"Coppell TX - Olathe KS FA2D3-555 TRIP B",freq:"Daily Except Mon",rate:"$1000-$1200",miles:"517",planning:"Live/Solo",departure:"03:30",delivery:"13:35 Same Day",puTime:"03:00"},
{route:"Coppell TX - Memphis TN RPDC FA2D3-2000",freq:"Daily",rate:"$900-$1100",miles:"453",planning:"DROP/PO",departure:"02:00",delivery:"09:35 Same Day",puTime:"02:00"},
{route:"Coppell, TX - Richmond, CA FA2D3-2005 TRIP A",freq:"Daily Except Mon",rate:"$3500-$4000",miles:"1709",planning:"PRELOAD",departure:"04:00",delivery:"14:20 Next Day",puTime:"03:30"},
{route:"Coppell TX - Abilene TX - Lubbock TX FA2D3-581",freq:"Daily Except Mon",rate:"$700-$900",miles:"350",planning:"PRELOAD",departure:"02:30",delivery:"09:30 Same Day",puTime:"02:00"},
{route:"Coppell TX - Avondale AZ FA2D3-574",freq:"Daily Except Mon",rate:"$2200-$2600",miles:"1065",planning:"PRELOAD",departure:"03:00",delivery:"18:00 Same Day",puTime:"02:00"},
{route:"Coppell TX - Denver, CO (NDC) FA2D3-552 TRIP B",freq:"Daily Except Mon",rate:"$2000-$2400",miles:"776",planning:"PRELOAD",departure:"04:00",delivery:"17:05 Same Day",puTime:"03:00"},
{route:"Coppell, TX - Jacksonville FL FA2D3-7 TRIP B",freq:"Daily Except Sun/Mon",rate:"$2000-$2300",miles:"1117",planning:"PRELOAD",departure:"04:00",delivery:"00:05 Next Day",puTime:"03:00"},
{route:"Coppell TX - Warrendale PA FA2D3-571 TRIP B",freq:"Daily Except Mon",rate:"$2000-$2400",miles:"1249",planning:"PRELOAD",departure:"04:00",delivery:"03:40 Next Day",puTime:"03:00"},
{route:"Coppell, TX - Indianapolis FA2D3-28 TRIP B",freq:"Daily Except Mon",rate:"$1600-$1800",miles:"886",planning:"PRELOAD",departure:"04:00",delivery:"22:00 Same Day",puTime:"03:00"},
{route:"Coppell, TX - Memphis, TN FA2D3-1",freq:"Daily Except Mon",rate:"$900-$1100",miles:"453",planning:"PRELOAD",departure:"04:00",delivery:"11:00 Same Day",puTime:"03:00"},
{route:"Coppell TX - Olathe KS FA2D3-573 Solo TRIP C",freq:"Daily Except Mon",rate:"$1000-$1200",miles:"517",planning:"PRELOAD",departure:"04:30",delivery:"14:30 Same Day",puTime:"04:00"},
{route:"Coppell TX - Fairburn GA FA2D3-15 TRIP B",freq:"Daily Except Mon",rate:"$1800-$2100",miles:"780",planning:"PRELOAD",departure:"04:00",delivery:"19:00 Same Day",puTime:"03:30"},
{route:"Irving TX - Austin TX - San Antonio TX FA2D3_5",freq:"Daily Except Mon",rate:"$600-$800",miles:"300",planning:"LIVE",departure:"02:00",delivery:"08:00 Same Day",puTime:"02:00"},
{route:"Irving TX - Palmetto GA HCR 7523D_7503",freq:"Tue/Sat",rate:"$2000-$2300",miles:"780",planning:"LIVE",departure:"13:45",delivery:"08:00 Next Day",puTime:"13:45"},
{route:"Irving TX - Greenville SC - Columbia SC FA2D3-1005",freq:"Mon/Wed",rate:"$2000-$2400",miles:"950",planning:"LIVE",departure:"00:00",delivery:"19:30 Same Day",puTime:"00:00"},
{route:"Grand Prairie TX - Phillipsburg NJ HCR 7523D_7502",freq:"Tue/Sat",rate:"$3000-$3500",miles:"1560",planning:"LIVE",departure:"15:00",delivery:"Next Day",puTime:"15:00"},
{route:"Irving TX - Jacksonville FL FA2D3_542",freq:"Daily Except Mon",rate:"$2000-$2300",miles:"1100",planning:"LIVE",departure:"00:00",delivery:"20:00 Same Day",puTime:"00:00"},
{route:"Irving TX - San Antonio TX FA2D3-544",freq:"Daily",rate:"$500-$700",miles:"275",planning:"PRELOAD",departure:"00:00",delivery:"05:30 Same Day",puTime:"00:00"},
{route:"Memphis TN - Sandston VA FA2D3-301",freq:"Daily",rate:"$1500-$1800",miles:"850",planning:"LIVE",departure:"01:00",delivery:"14:30 Same Day",puTime:"01:00"},
{route:"Memphis TN - Gastonia NC FA2D3-315",freq:"Daily",rate:"$1000-$1300",miles:"600",planning:"LIVE",departure:"01:00",delivery:"10:00 Same Day",puTime:"01:00"},
{route:"Memphis TN - Greensboro NC FA2D3-300",freq:"Daily",rate:"$1100-$1400",miles:"680",planning:"LIVE",departure:"01:00",delivery:"11:00 Same Day",puTime:"01:00"},
{route:"Memphis RPDC - Jacksonville FL FA2D3-342",freq:"Daily",rate:"$1200-$1500",miles:"650",planning:"LIVE",departure:"02:00",delivery:"12:00 Same Day",puTime:"02:00"},
{route:"Memphis RPDC - Orlando FL FA2D3-340",freq:"Daily",rate:"$1400-$1700",miles:"750",planning:"LIVE",departure:"02:00",delivery:"13:00 Same Day",puTime:"02:00"},
{route:"Memphis RPDC - West Palm Beach FL FA2D3-345",freq:"Daily",rate:"$1800-$2200",miles:"1020",planning:"LIVE",departure:"02:00",delivery:"16:00 Same Day",puTime:"02:00"},
{route:"Memphis RPDC - Opa Locka FL FA2D3-344",freq:"Daily",rate:"$1800-$2200",miles:"1015",planning:"LIVE",departure:"03:00",delivery:"17:00 Same Day",puTime:"03:00"},
{route:"Memphis NDC - Tampa FL FA2D3-347",freq:"Daily",rate:"$1400-$1700",miles:"750",planning:"DROP",departure:"22:00",delivery:"Next Day",puTime:"22:00"},
{route:"Memphis NDC - Sandston VA FA2D3-320",freq:"Daily",rate:"$1500-$1800",miles:"850",planning:"DROP",departure:"22:00",delivery:"Next Day",puTime:"22:00"},
{route:"Memphis NDC - Gastonia NC FA2D3-328",freq:"Daily",rate:"$1000-$1300",miles:"600",planning:"DROP",departure:"22:00",delivery:"Next Day",puTime:"22:00"},
{route:"Memphis NDC - Greensboro NC FA2D3-604",freq:"Daily",rate:"$1100-$1400",miles:"680",planning:"DROP",departure:"22:00",delivery:"Next Day",puTime:"22:00"},
{route:"Memphis NDC - Nashville TN FA2D3-354",freq:"Daily",rate:"$400-$500",miles:"210",planning:"DROP",departure:"22:00",delivery:"Next Day",puTime:"22:00"},
{route:"Memphis NDC - Jacksonville FL FA2D3-341",freq:"Daily",rate:"$1200-$1500",miles:"650",planning:"DROP",departure:"22:00",delivery:"Next Day",puTime:"22:00"},
{route:"Memphis RPDC - Palmetto GA FA2D3-334",freq:"Daily",rate:"$800-$1000",miles:"390",planning:"LIVE",departure:"04:00",delivery:"11:00 Same Day",puTime:"04:00"},
{route:"Memphis RPDC - Nashville TN FA2D3-356",freq:"Daily",rate:"$400-$500",miles:"210",planning:"LIVE",departure:"04:00",delivery:"07:30 Same Day",puTime:"04:00"},
{route:"Memphis RPDC - N Charleston SC FA2D3-330",freq:"Daily",rate:"$1000-$1300",miles:"620",planning:"LIVE",departure:"04:45",delivery:"15:00 Same Day",puTime:"04:45"},
{route:"Memphis RPDC - Montgomery AL FA2D3-352",freq:"Daily",rate:"$700-$900",miles:"350",planning:"LIVE",departure:"06:00",delivery:"12:00 Same Day",puTime:"06:00"},
{route:"Memphis TN - Columbia SC FA2D3-302",freq:"Daily",rate:"$1100-$1400",miles:"640",planning:"LIVE",departure:"01:00",delivery:"11:00 Same Day",puTime:"01:00"},
{route:"Memphis TN - Palmetto GA FA2D3-303",freq:"Daily",rate:"$800-$1000",miles:"390",planning:"LIVE",departure:"01:00",delivery:"07:30 Same Day",puTime:"01:00"},
{route:"Memphis TN - Montgomery AL FA2D3-308",freq:"Daily",rate:"$700-$900",miles:"350",planning:"LIVE",departure:"01:00",delivery:"06:30 Same Day",puTime:"01:00"},
{route:"Memphis TN - Mobile AL FA2D3-309",freq:"Daily",rate:"$700-$900",miles:"400",planning:"LIVE",departure:"01:00",delivery:"07:00 Same Day",puTime:"01:00"},
{route:"Memphis TN - Birmingham AL FA2D3-307",freq:"Daily",rate:"$600-$700",miles:"245",planning:"LIVE",departure:"01:00",delivery:"05:00 Same Day",puTime:"01:00"},
{route:"Memphis TN - Nashville TN FA2D3-310",freq:"Daily",rate:"$400-$500",miles:"210",planning:"LIVE",departure:"01:00",delivery:"04:30 Same Day",puTime:"01:00"},
{route:"Memphis TN - Jackson MS FA2D3-312",freq:"Daily",rate:"$500-$600",miles:"210",planning:"LIVE",departure:"01:00",delivery:"04:30 Same Day",puTime:"01:00"},
{route:"Columbia SC - Gastonia NC FA2D3-596",freq:"Daily",rate:"$400-$500",miles:"160",planning:"LIVE",departure:"06:00",delivery:"09:00 Same Day",puTime:"06:00"},
{route:"Columbia SC - Birmingham AL x2 FA2D3-588 TRIP A",freq:"Daily",rate:"$800-$1000",miles:"450",planning:"LIVE",departure:"06:00",delivery:"14:00 Same Day",puTime:"06:00"},
{route:"Columbia SC - Jacksonville FL - Opa Locka FL FA2D3-594",freq:"Daily",rate:"$1200-$1500",miles:"600",planning:"LIVE",departure:"06:00",delivery:"16:00 Same Day",puTime:"06:00"},
{route:"Columbia SC - Montgomery AL - Mobile AL FA2D3-587 TRIP B",freq:"Daily",rate:"$900-$1100",miles:"520",planning:"LIVE",departure:"06:00",delivery:"15:00 Same Day",puTime:"06:00"},
{route:"Columbia SC - Jackson MS - Irving TX FA2D3-595",freq:"Daily",rate:"$1800-$2200",miles:"1050",planning:"LIVE",departure:"06:00",delivery:"Next Day",puTime:"06:00"},
{route:"Columbia SC - Phillipsburg NJ FA2D3-600",freq:"Daily",rate:"$1200-$1500",miles:"720",planning:"LIVE",departure:"06:00",delivery:"18:00 Same Day",puTime:"06:00"},
{route:"Greensboro NC - Dallas TX FA2D3-1007",freq:"Daily",rate:"$2000-$2400",miles:"1060",planning:"LIVE",departure:"06:00",delivery:"Next Day",puTime:"06:00"},
{route:"Greensboro NC - Tampa FL FA2D3-1004",freq:"Daily",rate:"$1200-$1500",miles:"680",planning:"LIVE",departure:"06:00",delivery:"17:00 Same Day",puTime:"06:00"},
{route:"Tampa FL - Gastonia NC FA2D3-1003",freq:"Daily",rate:"$1000-$1200",miles:"650",planning:"LIVE",departure:"06:00",delivery:"17:00 Same Day",puTime:"06:00"},
{route:"Opa Locka FL - Charleston SC - Columbia SC FA26E-31",freq:"Daily",rate:"$1300-$1500",miles:"620",planning:"LIVE",departure:"06:00",delivery:"16:00 Same Day",puTime:"06:00"},
{route:"Tampa FL - Hazelwood MO FA2D3-2004",freq:"Daily",rate:"$1500-$1800",miles:"720",planning:"LIVE",departure:"06:00",delivery:"20:00 Same Day",puTime:"06:00"},
{route:"Opa Locka FL - Irving TX FA26E-41 Bedload",freq:"Daily",rate:"$2450",miles:"1250",planning:"Bedload",departure:"06:00",delivery:"Next Day",puTime:"06:00"},
{route:"Hazelwood MO - Jacksonville FL FA28D-408 (UMT)",freq:"Daily",rate:"$2792",miles:"850",planning:"DROP/PO",departure:"06:00",delivery:"Next Day",puTime:"06:00"},
{route:"Hazelwood MO - Indianapolis IN FA28D-415 (UMT)",freq:"Daily",rate:"$1139",miles:"243",planning:"DROP/PO",departure:"06:00",delivery:"10:00 Same Day",puTime:"06:00"},
{route:"Hazelwood MO - Irving TX FA28D-436 TRIP A (UMT)",freq:"Daily",rate:"$1939",miles:"640",planning:"DROP/PO",departure:"06:00",delivery:"18:00 Same Day",puTime:"06:00"},
{route:"Hazelwood MO - Aurora CO FA28D-438 TRIP B (UMT)",freq:"Daily",rate:"$3099",miles:"850",planning:"DROP/PO",departure:"06:00",delivery:"Next Day",puTime:"06:00"},
{route:"Hazelwood MO - Avondale AZ FA28D-439 (UMT)",freq:"Daily",rate:"$3608",miles:"1500",planning:"DROP/PO",departure:"06:00",delivery:"Next Day",puTime:"06:00"},
{route:"Louisville KY - Dallas TX FA2D3-538",freq:"Daily",rate:"$1600-$2000",miles:"780",planning:"LIVE",departure:"01:30",delivery:"14:00 Same Day",puTime:"01:30"},
{route:"Oklahoma City OK - Austin TX - San Antonio TX FA2D3_541",freq:"Daily",rate:"$800-$1000",miles:"490",planning:"LIVE",departure:"06:00",delivery:"14:00 Same Day",puTime:"06:00"},
{route:"Cleveland OH - Akron OH - Irving TX HCR 7523D-7504",freq:"Mon/Thu",rate:"$2500-$3000",miles:"1200",planning:"LIVE",departure:"07:00",delivery:"Next Day",puTime:"07:00"},
{route:"Merrifield VA - Dallas TX FA2D3_535",freq:"Mon/Thu",rate:"$2500-$3000",miles:"1350",planning:"LIVE",departure:"06:00",delivery:"Next Day",puTime:"06:00"},
{route:"Reading PA - Irving TX HCR 7523D_7505",freq:"Thu/Sun",rate:"$2500-$3000",miles:"1450",planning:"LIVE",departure:"06:00",delivery:"Next Day",puTime:"06:00"},
{route:"Wichita KS - Kansas City MO FA2D3-564",freq:"Daily",rate:"$400-$500",miles:"190",planning:"LIVE",departure:"06:00",delivery:"09:00 Same Day",puTime:"06:00"},
];

/* The three primary terminals the Asset Matrix schedules by (Houston kept as a 4th group). */
export const TERMINALS = ['SATX','DALLAS','MEMPHIS'] as const;
export const TERMINAL_LABELS: Record<string,string> = {
  SATX:'San Antonio, TX', DALLAS:'Dallas, TX', MEMPHIS:'Memphis, TN', HOUSTON:'Houston, TX' };
