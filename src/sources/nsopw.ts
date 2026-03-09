import type { RawIncident } from "../types.ts";

const NSOPW_URL = "https://www.nsopw.gov/api/Search/GetRegistrants";

interface NSORPWRegistrant {
  FullName?: string;
  FirstName?: string;
  LastName?: string;
  OffenseDescription?: string;
  ConvictionDate?: string;
  Address?: {
    Street?: string;
    City?: string;
    State?: string;
    Zip?: string;
    Latitude?: number;
    Longitude?: number;
  };
  Latitude?: number;
  Longitude?: number;
  lat?: number;
  lon?: number;
  lng?: number;
}

interface NSORPWResponse {
  Registrants?: NSORPWRegistrant[];
  registrants?: NSORPWRegistrant[];
  Results?: NSORPWRegistrant[];
  TotalCount?: number;
}

export async function fetchNSOPW(
  zipCode: string,
  radiusMiles: number
): Promise<RawIncident[]> {
  const body = JSON.stringify({
    zipCode,
    radius: String(Math.round(radiusMiles)),
    radiusType: "miles",
  });

  const response = await fetch(NSOPW_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "neighborhood-mcp/1.0",
      Referer: "https://www.nsopw.gov/",
      Origin: "https://www.nsopw.gov",
    },
    body,
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) {
    throw new Error(
      `NSOPW API error: HTTP ${response.status} ${response.statusText}`
    );
  }

  const data = (await response.json()) as NSORPWResponse;

  const registrants: NSORPWRegistrant[] =
    data.Registrants ?? data.registrants ?? data.Results ?? [];

  if (!Array.isArray(registrants)) {
    throw new Error(
      "NSOPW: unexpected response structure — no registrants array"
    );
  }

  return registrants
    .map((reg, idx): RawIncident | null => {
      const lat = reg.Latitude ?? reg.lat ?? reg.Address?.Latitude ?? null;
      const lng =
        reg.Longitude ?? reg.lon ?? reg.lng ?? reg.Address?.Longitude ?? null;

      if (lat === null || lng === null || lat === 0 || lng === 0) return null;

      const name =
        reg.FullName ??
        (`${reg.FirstName ?? ""} ${reg.LastName ?? ""}`.trim() || "Registrant");
      const offense = reg.OffenseDescription ?? "Sex Offense";
      const addr = reg.Address
        ? [
            reg.Address.Street,
            reg.Address.City,
            reg.Address.State,
            reg.Address.Zip,
          ]
            .filter(Boolean)
            .join(", ")
        : "Unknown";

      const convDate = reg.ConvictionDate
        ? new Date(reg.ConvictionDate).toISOString()
        : new Date().toISOString();

      return {
        source: "nsopw",
        id: `nsopw-${zipCode}-${idx}`,
        type: "Sex Offender",
        description: `Registered sex offender: ${name}. Offense: ${offense}`,
        date: convDate,
        address: addr,
        lat,
        lng,
        severity: "high",
      };
    })
    .filter((r): r is RawIncident => r !== null);
}
