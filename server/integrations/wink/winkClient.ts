/**
 * Calls to WINK's Partner API: hotel lookup and city search.
 *
 * The Partner API is gRPC only (WINK's docs: a plain HTTP request gets 415),
 * so this uses @grpc/grpc-js with WINK's own .proto files, vendored in
 * ./proto. Auth is an OAuth client-credentials token from WINK's identity
 * server, plus the affiliate account id on every call.
 *
 * Read-only: our WINK app only has inventory.read, content.read and
 * booking.read. Nothing here books, changes or cancels anything.
 */
import { join } from "path";
import {
  type WinkConfig,
  type WinkHotel,
  winkConfig,
  isWinkSlug,
  hotelFromSearchResult,
  hotelFromDestination,
  cityFromDestination,
} from "./winkHotels";

const CALL_TIMEOUT_MS = 10_000;

let token: { value: string; expiresAt: number; key: string } | null = null;

async function accessToken(cfg: WinkConfig): Promise<string> {
  const key = `${cfg.env}:${cfg.clientId}`;
  if (token && token.key === key && token.expiresAt > Date.now() + 60_000) return token.value;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: "inventory.read content.read booking.read",
  });
  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`WINK token request failed (${res.status})`);
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("WINK token response had no token");
  token = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000, key };
  return token.value;
}

type Clients = { lookup: any; search: any; grpc: typeof import("@grpc/grpc-js"); host: string };
let clients: Clients | null = null;

async function grpcClients(cfg: WinkConfig): Promise<Clients> {
  if (clients && clients.host === cfg.partnerHost) return clients;
  const grpc = await import("@grpc/grpc-js");
  const loader = await import("@grpc/proto-loader");
  // The server runs from the repository root in development and on Railway.
  const protoDir = join(process.cwd(), "server/integrations/wink/proto");
  const def = await loader.load(
    ["wink/partner/v1/partner_destination_lookup.proto", "wink/partner/v1/partner_search.proto"],
    { includeDirs: [protoDir], keepCase: false, longs: Number, enums: String, defaults: true, oneofs: true },
  );
  const pkg = (grpc.loadPackageDefinition(def) as any).wink.partner.v1;
  const creds = grpc.credentials.createSsl();
  clients = {
    lookup: new pkg.Lookup(cfg.partnerHost, creds),
    search: new pkg.Search(cfg.partnerHost, creds),
    grpc,
    host: cfg.partnerHost,
  };
  return clients;
}

async function call<T>(cfg: WinkConfig, client: any, method: string, request: object): Promise<T> {
  const c = await grpcClients(cfg);
  const md = new c.grpc.Metadata();
  md.set("authorization", `Bearer ${await accessToken(cfg)}`);
  md.set("managing-entity-id", cfg.accountId);
  return new Promise<T>((resolve, reject) => {
    client[method](request, md, { deadline: new Date(Date.now() + CALL_TIMEOUT_MS) }, (err: Error | null, res: T) =>
      err ? reject(err) : resolve(res),
    );
  });
}

/** A check-in two weeks out, for one night: only used to get a "from" rate. */
function sampleItinerary() {
  const d = new Date(Date.now() + 14 * 86_400_000);
  return { startDate: d.toISOString().slice(0, 10), nights: 1, room: { adults: 2, quantity: 1 } };
}

/** Hotels seen in a search, so adding one uses what WINK said, not the browser. */
const seen = new Map<string, { hotel: WinkHotel; at: number }>();
const SEEN_TTL_MS = 6 * 3600_000;
function remember(h: WinkHotel) {
  seen.set(h.urlName, { hotel: h, at: Date.now() });
  if (seen.size > 5000) {
    const oldest = seen.keys().next().value;
    if (oldest) seen.delete(oldest);
  }
}

export function winkEnabled(): boolean {
  return winkConfig() != null;
}

/**
 * Hotels for what a creator typed: a city ("Bangkok") lists that city's WINK
 * hotels with pictures and rates; a hotel's own name finds it directly.
 */
export async function searchWinkHotels(term: string): Promise<WinkHotel[]> {
  const cfg = winkConfig();
  if (!cfg) throw new Error("WINK is not set up");
  const c = await grpcClients(cfg);
  const found = await call<{ destinations?: any[] }>(cfg, c.lookup, "Search", { term });
  const destinations = found.destinations ?? [];

  const out: WinkHotel[] = [];
  const add = (h: WinkHotel | null) => {
    if (h && !out.some((x) => x.urlName === h.urlName)) out.push(h);
  };

  const city = destinations.map(cityFromDestination).find(Boolean);
  if (city) {
    const page = await call<{ page?: { content?: any[] } }>(cfg, c.search, "SearchByCity", {
      urlName: city.urlName,
      userSession: { itinerary: sampleItinerary(), languageCode: "en", quoteCurrencies: ["USD"] },
      page: 0,
      size: 20, // WINK refuses more than 20 a page
    });
    for (const r of page.page?.content ?? []) {
      const h = hotelFromSearchResult(r);
      if (h) add({ ...h, country: h.country ?? city.country });
    }
  }
  // Hotels named directly. A city search already gave the richer version of
  // any hotel that is in both, so these only fill in the rest.
  for (const d of destinations) add(hotelFromDestination(d));

  out.forEach(remember);
  return out;
}

/** One hotel by its slug: from a recent search, or looked up again. */
export async function getWinkHotel(urlName: string): Promise<WinkHotel | null> {
  if (!isWinkSlug(urlName)) return null;
  const hit = seen.get(urlName);
  if (hit && Date.now() - hit.at < SEEN_TTL_MS) return hit.hotel;
  const cfg = winkConfig();
  if (!cfg) return null;
  const c = await grpcClients(cfg);
  const res = await call<{ destination?: any }>(cfg, c.lookup, "Get", {
    urlName,
    type: "DESTINATION_TYPE_PROPERTY",
  }).catch(() => null);
  const h = hotelFromDestination(res?.destination);
  if (h) remember(h);
  return h;
}
