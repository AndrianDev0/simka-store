import { BlockList, isIP } from "node:net";
import { readFile, stat } from "node:fs/promises";
import { Reader, type CityResponse } from "mmdb-lib";
export type ApproximateLocation = { countryCode: string | null; region: string | null; city: string | null };
const unknown: ApproximateLocation = { countryCode: null, region: null, city: null };
const privateRanges = new BlockList();
for (const [address,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.168.0.0',16],['224.0.0.0',4],['240.0.0.0',4]] as const) privateRanges.addSubnet(address,prefix,'ipv4');
for (const [address,prefix] of [['::',128],['::1',128],['fc00::',7],['fe80::',10],['ff00::',8]] as const) privateRanges.addSubnet(address,prefix,'ipv6');

export function geolocationAddress(request: Request, trustProxy = process.env.GEOIP_TRUST_PROXY === 'true') {
  if (!trustProxy) return null;
  // The app is loopback-only; nginx overwrites this header with $remote_addr.
  const raw = request.headers.get('x-real-ip')?.trim() || '';
  const address = raw.startsWith('::ffff:') ? raw.slice(7) : raw;
  const version = isIP(address);
  if (!version || privateRanges.check(address,version===4?'ipv4':'ipv6')) return null;
  return address;
}

let reader: Reader<CityResponse> | null = null;
let loadedPath = '', modified = 0, checkedAt = 0;
let refreshing: Promise<void> | null = null;
async function refresh(path: string) {
  try {
    const metadata = await stat(path);
    if (!reader || path !== loadedPath || metadata.mtimeMs !== modified) {
      const next = new Reader<CityResponse>(await readFile(path));
      reader = next; loadedPath = path; modified = metadata.mtimeMs;
    }
  } catch {
    console.warn('geoip_database_unavailable');
  } finally { checkedAt = Date.now(); }
}

export async function geolocateRequest(request: Request): Promise<ApproximateLocation> {
  const address = geolocationAddress(request), path = process.env.GEOIP_DATABASE_PATH;
  if (!address || !path) return unknown;
  if (Date.now()-checkedAt > 60000 || path !== loadedPath) {
    if (!refreshing) refreshing = refresh(path).finally(()=>{refreshing=null;});
    await refreshing;
  }
  if (!reader) return unknown;
  try {
    const record = reader.get(address);
    const name = (names?:{ru?:string;en?:string}) => (names?.ru || names?.en || '').slice(0,120) || null;
    return {
      countryCode: /^[A-Z]{2}$/.test(record?.country?.iso_code || '') ? record!.country!.iso_code! : null,
      region: name(record?.subdivisions?.[0]?.names), city: name(record?.city?.names),
    };
  } catch { return unknown; }
}
