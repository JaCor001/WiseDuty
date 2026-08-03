/**
 * Airport search (ICAO / IATA / name / city) with IANA time zones.
 * Curated static list — offline-safe for Capacitor. Expand as needed.
 */
import type { AirportRef } from './types'

/** Compact rows: icao, iata?, name, city, country, tz */
const RAW: Array<[string, string, string, string, string, string]> = [
  // Canada
  ['CYUL', 'YUL', 'Montréal-Trudeau', 'Montréal', 'CA', 'America/Toronto'],
  ['CYYZ', 'YYZ', 'Toronto Pearson', 'Toronto', 'CA', 'America/Toronto'],
  ['CYTZ', 'YTZ', 'Billy Bishop Toronto City', 'Toronto', 'CA', 'America/Toronto'],
  ['CYOW', 'YOW', 'Ottawa Macdonald-Cartier', 'Ottawa', 'CA', 'America/Toronto'],
  ['CYQB', 'YQB', 'Québec City Jean Lesage', 'Québec', 'CA', 'America/Toronto'],
  ['CYHZ', 'YHZ', 'Halifax Stanfield', 'Halifax', 'CA', 'America/Halifax'],
  ['CYYG', 'YYG', 'Charlottetown', 'Charlottetown', 'CA', 'America/Halifax'],
  ['CYSJ', 'YSJ', 'Saint John', 'Saint John', 'CA', 'America/Moncton'],
  ['CYQM', 'YQM', 'Greater Moncton', 'Moncton', 'CA', 'America/Moncton'],
  ['CYYT', 'YYT', 'St. John\'s', 'St. John\'s', 'CA', 'America/St_Johns'],
  ['CYQX', 'YQX', 'Gander', 'Gander', 'CA', 'America/St_Johns'],
  ['CYYT', 'YYT', 'St. Johns International', 'St. Johns', 'CA', 'America/St_Johns'],
  ['CYWG', 'YWG', 'Winnipeg Richardson', 'Winnipeg', 'CA', 'America/Winnipeg'],
  ['CYQR', 'YQR', 'Regina', 'Regina', 'CA', 'America/Regina'],
  ['CYXE', 'YXE', 'Saskatoon John G. Diefenbaker', 'Saskatoon', 'CA', 'America/Regina'],
  ['CYYC', 'YYC', 'Calgary International', 'Calgary', 'CA', 'America/Edmonton'],
  ['CYEG', 'YEG', 'Edmonton International', 'Edmonton', 'CA', 'America/Edmonton'],
  ['CYZF', 'YZF', 'Yellowknife', 'Yellowknife', 'CA', 'America/Yellowknife'],
  ['CYVR', 'YVR', 'Vancouver International', 'Vancouver', 'CA', 'America/Vancouver'],
  ['CYYJ', 'YYJ', 'Victoria International', 'Victoria', 'CA', 'America/Vancouver'],
  ['CYXX', 'YXX', 'Abbotsford', 'Abbotsford', 'CA', 'America/Vancouver'],
  ['CYKA', 'YKA', 'Kamloops', 'Kamloops', 'CA', 'America/Vancouver'],
  ['CYLW', 'YLW', 'Kelowna', 'Kelowna', 'CA', 'America/Vancouver'],
  ['CYXY', 'YXY', 'Erik Nielsen Whitehorse', 'Whitehorse', 'CA', 'America/Whitehorse'],
  ['CYFB', 'YFB', 'Iqaluit', 'Iqaluit', 'CA', 'America/Iqaluit'],
  ['CYQB', 'YQB', 'Quebec Jean Lesage', 'Quebec', 'CA', 'America/Toronto'],
  ['CYMX', 'YMX', 'Montréal-Mirabel', 'Montréal', 'CA', 'America/Toronto'],
  ['CYHU', 'YHU', 'Montréal Saint-Hubert', 'Longueuil', 'CA', 'America/Toronto'],
  ['CYVO', 'YVO', 'Val-d\'Or', 'Val-d\'Or', 'CA', 'America/Toronto'],
  ['CYYB', 'YYB', 'North Bay', 'North Bay', 'CA', 'America/Toronto'],
  ['CYAM', 'YAM', 'Sault Ste. Marie', 'Sault Ste. Marie', 'CA', 'America/Toronto'],
  ['CYTS', 'YTS', 'Timmins', 'Timmins', 'CA', 'America/Toronto'],
  ['CYQT', 'YQT', 'Thunder Bay', 'Thunder Bay', 'CA', 'America/Toronto'],
  ['CYSB', 'YSB', 'Sudbury', 'Sudbury', 'CA', 'America/Toronto'],
  ['CYKF', 'YKF', 'Region of Waterloo', 'Kitchener', 'CA', 'America/Toronto'],
  ['CYHM', 'YHM', 'John C. Munro Hamilton', 'Hamilton', 'CA', 'America/Toronto'],
  ['CYXU', 'YXU', 'London', 'London', 'CA', 'America/Toronto'],
  ['CYYG', 'YYG', 'Charlottetown Airport', 'Charlottetown', 'CA', 'America/Halifax'],
  ['CZBF', 'ZBF', 'Bathurst', 'Bathurst', 'CA', 'America/Moncton'],
  ['CYQY', 'YQY', 'Sydney J.A. Douglas McCurdy', 'Sydney', 'CA', 'America/Halifax'],
  ['CYDF', 'YDF', 'Deer Lake', 'Deer Lake', 'CA', 'America/St_Johns'],
  ['CYYR', 'YYR', 'Goose Bay', 'Happy Valley-Goose Bay', 'CA', 'America/Goose_Bay'],
  ['CYZF', 'YZF', 'Yellowknife Airport', 'Yellowknife', 'CA', 'America/Yellowknife'],
  ['CYMM', 'YMM', 'Fort McMurray', 'Fort McMurray', 'CA', 'America/Edmonton'],
  ['CYQU', 'YQU', 'Grande Prairie', 'Grande Prairie', 'CA', 'America/Edmonton'],
  ['CYYC', 'YYC', 'Calgary Intl', 'Calgary', 'CA', 'America/Edmonton'],
  ['CYLW', 'YLW', 'Kelowna Intl', 'Kelowna', 'CA', 'America/Vancouver'],
  ['CYXS', 'YXS', 'Prince George', 'Prince George', 'CA', 'America/Vancouver'],
  ['CYCD', 'YCD', 'Nanaimo', 'Nanaimo', 'CA', 'America/Vancouver'],
  ['CYQQ', 'YQQ', 'Comox Valley (CFB Comox)', 'Comox', 'CA', 'America/Vancouver'],
  ['CYPR', 'YPR', 'Prince Rupert', 'Prince Rupert', 'CA', 'America/Vancouver'],
  ['CYXT', 'YXT', 'Northwest Regional Terrace-Kitimat', 'Terrace', 'CA', 'America/Vancouver'],
  ['CYZP', 'YZP', 'Sandspit', 'Sandspit', 'CA', 'America/Vancouver'],
  ['CYYJ', 'YYJ', 'Victoria', 'Victoria', 'CA', 'America/Vancouver'],
  // USA major
  ['KJFK', 'JFK', 'John F. Kennedy Intl', 'New York', 'US', 'America/New_York'],
  ['KLGA', 'LGA', 'LaGuardia', 'New York', 'US', 'America/New_York'],
  ['KEWR', 'EWR', 'Newark Liberty', 'Newark', 'US', 'America/New_York'],
  ['KBOS', 'BOS', 'Logan Intl', 'Boston', 'US', 'America/New_York'],
  ['KPHL', 'PHL', 'Philadelphia Intl', 'Philadelphia', 'US', 'America/New_York'],
  ['KDCA', 'DCA', 'Ronald Reagan Washington National', 'Washington', 'US', 'America/New_York'],
  ['KIAD', 'IAD', 'Washington Dulles', 'Washington', 'US', 'America/New_York'],
  ['KBWI', 'BWI', 'Baltimore/Washington', 'Baltimore', 'US', 'America/New_York'],
  ['KATL', 'ATL', 'Hartsfield-Jackson Atlanta', 'Atlanta', 'US', 'America/New_York'],
  ['KCLT', 'CLT', 'Charlotte Douglas', 'Charlotte', 'US', 'America/New_York'],
  ['KMIA', 'MIA', 'Miami Intl', 'Miami', 'US', 'America/New_York'],
  ['KFLL', 'FLL', 'Fort Lauderdale-Hollywood', 'Fort Lauderdale', 'US', 'America/New_York'],
  ['KMCO', 'MCO', 'Orlando Intl', 'Orlando', 'US', 'America/New_York'],
  ['KTPA', 'TPA', 'Tampa Intl', 'Tampa', 'US', 'America/New_York'],
  ['KJAX', 'JAX', 'Jacksonville Intl', 'Jacksonville', 'US', 'America/New_York'],
  ['KVQQ', 'VQQ', 'Cecil Airport', 'Jacksonville', 'US', 'America/New_York'],
  ['KORD', 'ORD', 'Chicago O\'Hare', 'Chicago', 'US', 'America/Chicago'],
  ['KMDW', 'MDW', 'Chicago Midway', 'Chicago', 'US', 'America/Chicago'],
  ['KDFW', 'DFW', 'Dallas/Fort Worth', 'Dallas', 'US', 'America/Chicago'],
  ['KIAH', 'IAH', 'George Bush Intercontinental', 'Houston', 'US', 'America/Chicago'],
  ['KHOU', 'HOU', 'William P. Hobby', 'Houston', 'US', 'America/Chicago'],
  ['KMSP', 'MSP', 'Minneapolis−Saint Paul', 'Minneapolis', 'US', 'America/Chicago'],
  ['KSTL', 'STL', 'St. Louis Lambert', 'St. Louis', 'US', 'America/Chicago'],
  ['KDEN', 'DEN', 'Denver Intl', 'Denver', 'US', 'America/Denver'],
  ['KPHX', 'PHX', 'Phoenix Sky Harbor', 'Phoenix', 'US', 'America/Phoenix'],
  ['KLAS', 'LAS', 'Harry Reid Intl', 'Las Vegas', 'US', 'America/Los_Angeles'],
  ['KLAX', 'LAX', 'Los Angeles Intl', 'Los Angeles', 'US', 'America/Los_Angeles'],
  ['KSAN', 'SAN', 'San Diego Intl', 'San Diego', 'US', 'America/Los_Angeles'],
  ['KSFO', 'SFO', 'San Francisco Intl', 'San Francisco', 'US', 'America/Los_Angeles'],
  ['KSJC', 'SJC', 'San Jose Norman Y. Mineta', 'San Jose', 'US', 'America/Los_Angeles'],
  ['KSEA', 'SEA', 'Seattle-Tacoma', 'Seattle', 'US', 'America/Los_Angeles'],
  ['KPDX', 'PDX', 'Portland Intl', 'Portland', 'US', 'America/Los_Angeles'],
  ['KANC', 'ANC', 'Ted Stevens Anchorage', 'Anchorage', 'US', 'America/Anchorage'],
  ['PHNL', 'HNL', 'Daniel K. Inouye', 'Honolulu', 'US', 'Pacific/Honolulu'],
  ['KDTW', 'DTW', 'Detroit Metropolitan', 'Detroit', 'US', 'America/Detroit'],
  ['KCVG', 'CVG', 'Cincinnati/Northern Kentucky', 'Cincinnati', 'US', 'America/New_York'],
  ['KIND', 'IND', 'Indianapolis Intl', 'Indianapolis', 'US', 'America/Indiana/Indianapolis'],
  ['KBNA', 'BNA', 'Nashville Intl', 'Nashville', 'US', 'America/Chicago'],
  ['KAUS', 'AUS', 'Austin-Bergstrom', 'Austin', 'US', 'America/Chicago'],
  ['KSAT', 'SAT', 'San Antonio Intl', 'San Antonio', 'US', 'America/Chicago'],
  ['KSLC', 'SLC', 'Salt Lake City Intl', 'Salt Lake City', 'US', 'America/Denver'],
  // Europe / hubs
  ['EGLL', 'LHR', 'London Heathrow', 'London', 'GB', 'Europe/London'],
  ['EGKK', 'LGW', 'London Gatwick', 'London', 'GB', 'Europe/London'],
  ['LFPG', 'CDG', 'Paris Charles de Gaulle', 'Paris', 'FR', 'Europe/Paris'],
  ['LFPO', 'ORY', 'Paris Orly', 'Paris', 'FR', 'Europe/Paris'],
  ['EHAM', 'AMS', 'Amsterdam Schiphol', 'Amsterdam', 'NL', 'Europe/Amsterdam'],
  ['EDDF', 'FRA', 'Frankfurt am Main', 'Frankfurt', 'DE', 'Europe/Berlin'],
  ['EDDM', 'MUC', 'Munich', 'Munich', 'DE', 'Europe/Berlin'],
  ['LEMD', 'MAD', 'Madrid-Barajas', 'Madrid', 'ES', 'Europe/Madrid'],
  ['LEBL', 'BCN', 'Barcelona-El Prat', 'Barcelona', 'ES', 'Europe/Madrid'],
  ['LIRF', 'FCO', 'Rome Fiumicino', 'Rome', 'IT', 'Europe/Rome'],
  ['LIMC', 'MXP', 'Milan Malpensa', 'Milan', 'IT', 'Europe/Rome'],
  ['LSZH', 'ZRH', 'Zurich', 'Zurich', 'CH', 'Europe/Zurich'],
  ['LOWW', 'VIE', 'Vienna', 'Vienna', 'AT', 'Europe/Vienna'],
  ['EKCH', 'CPH', 'Copenhagen', 'Copenhagen', 'DK', 'Europe/Copenhagen'],
  ['ESSA', 'ARN', 'Stockholm Arlanda', 'Stockholm', 'SE', 'Europe/Stockholm'],
  ['ENGM', 'OSL', 'Oslo Gardermoen', 'Oslo', 'NO', 'Europe/Oslo'],
  ['EFHK', 'HEL', 'Helsinki-Vantaa', 'Helsinki', 'FI', 'Europe/Helsinki'],
  ['EIDW', 'DUB', 'Dublin', 'Dublin', 'IE', 'Europe/Dublin'],
  ['EGPH', 'EDI', 'Edinburgh', 'Edinburgh', 'GB', 'Europe/London'],
  ['EGCC', 'MAN', 'Manchester', 'Manchester', 'GB', 'Europe/London'],
  ['LPPT', 'LIS', 'Lisbon', 'Lisbon', 'PT', 'Europe/Lisbon'],
  ['LPPR', 'OPO', 'Porto', 'Porto', 'PT', 'Europe/Lisbon'],
  ['LTFM', 'IST', 'Istanbul', 'Istanbul', 'TR', 'Europe/Istanbul'],
  // Middle East / Asia / other
  ['OMDB', 'DXB', 'Dubai Intl', 'Dubai', 'AE', 'Asia/Dubai'],
  ['OTHH', 'DOH', 'Hamad Intl', 'Doha', 'QA', 'Asia/Qatar'],
  ['VHHH', 'HKG', 'Hong Kong Intl', 'Hong Kong', 'HK', 'Asia/Hong_Kong'],
  ['RJTT', 'HND', 'Tokyo Haneda', 'Tokyo', 'JP', 'Asia/Tokyo'],
  ['RJAA', 'NRT', 'Narita Intl', 'Tokyo', 'JP', 'Asia/Tokyo'],
  ['RKSI', 'ICN', 'Incheon Intl', 'Seoul', 'KR', 'Asia/Seoul'],
  ['WSSS', 'SIN', 'Singapore Changi', 'Singapore', 'SG', 'Asia/Singapore'],
  ['YMML', 'MEL', 'Melbourne', 'Melbourne', 'AU', 'Australia/Melbourne'],
  ['YSSY', 'SYD', 'Sydney Kingsford Smith', 'Sydney', 'AU', 'Australia/Sydney'],
  ['NZAA', 'AKL', 'Auckland', 'Auckland', 'NZ', 'Pacific/Auckland'],
  ['SBGR', 'GRU', 'São Paulo Guarulhos', 'São Paulo', 'BR', 'America/Sao_Paulo'],
  ['MMMX', 'MEX', 'Mexico City', 'Mexico City', 'MX', 'America/Mexico_City'],
  ['MMUN', 'CUN', 'Cancún', 'Cancún', 'MX', 'America/Cancun'],
  ['TJSJ', 'SJU', 'Luis Muñoz Marín', 'San Juan', 'PR', 'America/Puerto_Rico'],
  ['TNCM', 'SXM', 'Princess Juliana', 'St. Maarten', 'SX', 'America/Lower_Princes'],
  ['MKJP', 'KIN', 'Norman Manley', 'Kingston', 'JM', 'America/Jamaica'],
  ['MWCR', 'GCM', 'Owen Roberts', 'Grand Cayman', 'KY', 'America/Cayman'],
  ['MYNN', 'NAS', 'Lynden Pindling', 'Nassau', 'BS', 'America/Nassau'],
  ['TXKF', 'BDA', 'L.F. Wade Intl', 'Bermuda', 'BM', 'Atlantic/Bermuda'],
]

function dedupeAirports(rows: AirportRef[]): AirportRef[] {
  const byIcao = new Map<string, AirportRef>()
  for (const a of rows) {
    const key = a.icao.toUpperCase()
    if (!byIcao.has(key)) byIcao.set(key, { ...a, icao: key })
  }
  return [...byIcao.values()]
}

export const AIRPORTS: AirportRef[] = dedupeAirports(
  RAW.map(([icao, iata, name, city, country, tz]) => ({
    icao,
    iata: iata || undefined,
    name,
    city,
    country,
    tz,
  })),
)

const BY_ICAO = new Map(AIRPORTS.map((a) => [a.icao.toUpperCase(), a]))
const BY_IATA = new Map(
  AIRPORTS.filter((a) => a.iata).map((a) => [a.iata!.toUpperCase(), a]),
)

export function getAirportByIcao(icao: string): AirportRef | undefined {
  return BY_ICAO.get(icao.trim().toUpperCase())
}

export function getAirportByCode(code: string): AirportRef | undefined {
  const c = code.trim().toUpperCase()
  return BY_ICAO.get(c) || BY_IATA.get(c)
}

export function airportLabel(a: AirportRef): string {
  const code = a.iata ? `${a.icao}/${a.iata}` : a.icao
  const place = a.city || a.name
  return `${code} · ${a.name}${place && place !== a.name ? ` (${place})` : ''}`
}

export function airportShortLabel(a: AirportRef): string {
  return a.iata ? `${a.iata} · ${a.city || a.name}` : `${a.icao} · ${a.city || a.name}`
}

/**
 * Ranked search for typeahead. Exact ICAO/IATA first, then prefix, then contains.
 */
export function searchAirports(query: string, limit = 25): AirportRef[] {
  const q = query.trim().toLowerCase()
  if (!q) return AIRPORTS.slice(0, limit)

  const qUp = q.toUpperCase()
  type Scored = { a: AirportRef; score: number }
  const scored: Scored[] = []

  for (const a of AIRPORTS) {
    const icao = a.icao.toUpperCase()
    const iata = (a.iata || '').toUpperCase()
    const name = a.name.toLowerCase()
    const city = (a.city || '').toLowerCase()
    let score = 0
    if (icao === qUp) score = 100
    else if (iata === qUp) score = 95
    else if (icao.startsWith(qUp)) score = 80
    else if (iata.startsWith(qUp)) score = 75
    else if (city.startsWith(q) || name.startsWith(q)) score = 60
    else if (city.includes(q) || name.includes(q)) score = 40
    else if (icao.includes(qUp) || iata.includes(qUp)) score = 30
    if (score > 0) scored.push({ a, score })
  }

  scored.sort((x, y) => y.score - x.score || x.a.icao.localeCompare(y.a.icao))
  return scored.slice(0, limit).map((s) => s.a)
}
