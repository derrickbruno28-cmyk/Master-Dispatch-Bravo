/* OTP / OTD compliance data — ported from the Operations Center.
   A Shipment is one tracked load with on-time-pickup (otp) and on-time-delivery
   (otd) outcomes. `source` marks how the record was created — today always
   'manual'; the long-game plan is a Samsara API fill that stamps 'samsara' and
   auto-populates times/outcomes from tracking + trip history. Not wired here. */

export type OtpFlag = '✓' | '✗' | 'Pending';
export interface Shipment {
  id: string;
  ls: string; loadId: string; trip: string; truck: string;
  primaryDriver: string; secondaryDriver: string; loadType: string;
  puAppt: string; puActual: string; otp: OtpFlag; otpFailReason: string;
  del1Appt: string; del1Actual: string; otd: OtpFlag; otdFailReason: string;
  week: string; month: string; notes: string;
  source: 'manual' | 'samsara';
}

export const OTP_TARGET = 97;
export const OTD_TARGET = 95;

export const OTP_DRIVERS: string[] = ["Aerial Alexus King","Ahmed Abdulwahhab","Alexander Brenes","Amador Martinez","Amir","Anthony Gonzales","Baxter B Franco","Benjamin S Anderson","Brian Keith Laitinen","Bruce Woodrum","Carlos Ramirez","Claude T Whisenhunt","Damon Spencer","Daniel Jay Williams","Dario Portillo","Daryl Oronda Marshall","David Garza","Davonte T Galbert","Demariye Mathis Grant","Deon Nickens","Derek Brewer","Derek Ramirez","Derrick Jevon Scott","Desiree Torres","Devonte Cunningham","Donna Lorraine Langston","Erick","Fausto Mandujano","Franco Santos","Gerardo Portillo","Gerzayn Miranda","Hector Nava","Ida Jones","Isaac Robles","Jacob Vasquez","Jamarrio Loggins","James Eckford","Javier, Jr Villanueva","Jay Harts","Jeanette Cruz","Jeffery Brown","Jennifer Ann Flores","Jermaine Thomas","Jessica Hudson","Johnny, Jr Eric Dominguez","Jose Angel Quinones Rivera","Jose Guajardo","Jose, Jr Enrique Morales","Joseph Barraza","Joseph Jezzard","Joshuwa M Mccain","Juan Jose Lopez","Justin Moody","Kevon Terrell","Kimala S Brown","Krystal Thrasher","Kyonna Harrison","Latoya Joycell Duffie","Leah May","Leo Avila","Leroy Van Iv Drury","Loriann Lozzi","Luis Alberto Trinidad","Luis Eraldo Fernandez Jr","Manuel Arredondo","Marcos Mata","Maurice La Quinn Williams","Michael Kruszynski","Miles Murphy","Monica Guerra","Nathaniel Fernandez","Oscar Flores Jr","Rafael Gama","Raul Cantu","Raul Jose Rubio","Ricardo Cortez","Richard Jack","Ricky Jenkins","Robert, Sr Spangler","Rocio Edith Grano","Rosendo Venegas","Silvestre Alvarez","Stephen Craig Ward","Terence Sanford","Uri Ivan Montano"];

export const OTP_FAIL_REASONS: string[] = ["Carrier Driver Late / No Show","Carrier Equipment Not Available","Carrier Communication Failure","Live Load \u2013 Shipper Not Ready","Live Load \u2013 Dock Congestion","Pre-Load Delay \u2013 Freight Not Ready","Pre-Load Delay \u2013 Loading Error","Appointment Scheduling Error","Weather / Road Conditions","Mechanical Breakdown at Origin","Hours of Service (HOS) Violation","Traffic / Accident Delay","Customs / Border Delay","Other \u2013 See Notes","APPROVED: Weather / Natural Disaster (Act of God)","APPROVED: Government / Customs Hold","APPROVED: Shipper-Requested Reschedule","APPROVED: Carrier-Approved Force Majeure","APPROVED: Other \u2013 See Notes"];

export const OTD_FAIL_REASONS: string[] = ["Carrier Driver Late Departure","Mechanical Breakdown En Route","Hours of Service (HOS) Violation","Traffic / Accident Delay","Weather / Road Conditions","Incorrect Delivery Address","Consignee Refused / Not Available","Consignee Dock Congestion","Appointment Not Honored by Consignee","Mis-Route / Wrong Destination","Customs / Border Delay","Late Pickup Cascaded to Delivery","Not Enough Transit Time","Other \u2013 See Notes","APPROVED: Weather / Natural Disaster (Act of God)","APPROVED: Government / Customs Hold","APPROVED: Consignee-Requested Reschedule","APPROVED: Carrier-Approved Force Majeure","APPROVED: Other \u2013 See Notes"];

const KEY = 'asset-otp-v1';
export function loadShipments(): Shipment[] {
  try { const raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw) as Shipment[]; } catch { /* ignore */ }
  return [];
}
export function saveShipments(list: Shipment[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

export interface OtpStats {
  total: number;
  otpTotal: number; otpPass: number; otpFail: number; otpPend: number; otpPct: number;
  otdTotal: number; otdPass: number; otdFail: number; otdPend: number; otdPct: number;
}
export function computeStats(data: Shipment[]): OtpStats {
  const otpTotal = data.filter((s) => s.otp !== 'Pending').length;
  const otpPass = data.filter((s) => s.otp === '✓').length;
  const otpFail = data.filter((s) => s.otp === '✗').length;
  const otpPend = data.filter((s) => s.otp === 'Pending').length;
  const otdTotal = data.filter((s) => s.otd !== 'Pending').length;
  const otdPass = data.filter((s) => s.otd === '✓').length;
  const otdFail = data.filter((s) => s.otd === '✗').length;
  const otdPend = data.filter((s) => s.otd === 'Pending').length;
  return {
    total: data.length,
    otpTotal, otpPass, otpFail, otpPend, otpPct: otpTotal ? otpPass / otpTotal * 100 : 0,
    otdTotal, otdPass, otdFail, otdPend, otdPct: otdTotal ? otdPass / otdTotal * 100 : 0,
  };
}
export function targetColor(p: number, t: number): string {
  return p >= t ? 'var(--green)' : p >= t - 3 ? 'var(--amber)' : 'var(--red)';
}
