import ipaddr from "ipaddr.js";

export type CheckLevel = "pass" | "warning" | "fail" | "info";

export type CheckResult = {
  query: {
    prefix: string;
    expectedOrigin: number | null;
    checkedAt: string;
    dataTimestamp: string | null;
  };
  summary: {
    level: Exclude<CheckLevel, "info">;
    title: string;
    detail: string;
  };
  checks: Array<{
    id: string;
    label: string;
    level: CheckLevel;
    value: string;
    detail: string;
  }>;
  bgp: {
    announced: boolean;
    observedOrigins: Array<{
      asn: number;
      holder: string | null;
      routeCount: number;
    }>;
    routeCount: number;
    peerCount: number;
    collectorCount: number;
    collectors: string[];
    referenceOrigin: number | null;
    collectorsSeeingReference: number;
    originAgreementPercent: number | null;
    samplePaths: Array<{
      path: number[];
      observations: number;
    }>;
  };
  rpki: Array<{
    asn: number;
    status: "valid" | "invalid_asn" | "invalid_length" | "unknown" | "error";
    description: string;
    validatingRoas: Array<{
      origin: string;
      prefix: string;
      maxLength: number;
      validity: string;
    }>;
  }>;
  irr: {
    exactRoutes: Array<{
      prefix: string;
      origin: number;
      inBgp: boolean;
      inWhois: boolean;
      irrSources: string[];
      asnName: string | null;
    }>;
    referenceRegistered: boolean;
  };
};

type PrefixOverview = {
  announced?: boolean;
  asns?: Array<{ asn: number; holder?: string }>;
  query_time?: string;
};

type BgpRoute = {
  target_prefix?: string;
  source_id?: string;
  path?: number[];
};

type ConsistencyRoute = {
  prefix?: string;
  origin?: number;
  in_bgp?: boolean;
  in_whois?: boolean;
  irr_sources?: string[];
  asn_name?: string;
};

const RIPESTAT = "https://stat.ripe.net/data";

export function validatePrefix(value: unknown) {
  if (typeof value !== "string") return null;
  const prefix = value.trim();
  try {
    const [address, length] = ipaddr.parseCIDR(prefix);
    if (address.kind() === "ipv4") {
      return `${ipaddr.IPv4.networkAddressFromCIDR(
        `${address.toString()}/${length}`,
      ).toString()}/${length}`;
    }
    return `${ipaddr.IPv6.networkAddressFromCIDR(
      `${address.toNormalizedString()}/${length}`,
    ).toString()}/${length}`;
  } catch {
    return null;
  }
}

export function validateAsn(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const normalized = String(value).trim().toUpperCase().replace(/^AS/, "");
  if (!/^\d+$/.test(normalized)) return undefined;
  const asn = Number(normalized);
  return Number.isSafeInteger(asn) && asn >= 1 && asn <= 4_294_967_295
    ? asn
    : undefined;
}

async function ripeCall<T>(
  endpoint: string,
  parameters: Record<string, string>,
  fetchImpl: typeof fetch,
) {
  const search = new URLSearchParams(parameters);
  search.set("sourceapp", "j2sw-prefix-checker");
  const response = await fetchImpl(`${RIPESTAT}/${endpoint}/data.json?${search}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`RIPEstat ${endpoint} returned HTTP ${response.status}.`);
  }
  const payload = (await response.json()) as {
    status?: string;
    data?: T;
    messages?: Array<[string, string]>;
  };
  if (payload.status !== "ok" || !payload.data) {
    throw new Error(
      payload.messages?.[0]?.[1] || `RIPEstat ${endpoint} returned no data.`,
    );
  }
  return payload.data;
}

function finalOrigin(path: number[] | undefined) {
  if (!path?.length) return null;
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const candidate = Number(path[index]);
    if (Number.isInteger(candidate) && candidate > 0) return candidate;
  }
  return null;
}

export async function runPrefixCheck(
  prefixInput: unknown,
  asnInput: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<CheckResult> {
    const prefix = validatePrefix(prefixInput);
    const expectedOrigin = validateAsn(asnInput);

    if (!prefix) {
      throw new Error("Enter a valid IPv4 or IPv6 prefix in CIDR notation.");
    }
    if (expectedOrigin === undefined) {
      throw new Error("Enter an ASN from 1 through 4294967295, or leave it blank.");
    }

    const encodedPrefix = prefix;
    const [overview, bgpState, consistency] = await Promise.all([
      ripeCall<PrefixOverview>(
        "prefix-overview",
        { resource: encodedPrefix },
        fetchImpl,
      ),
      ripeCall<{ bgp_state?: BgpRoute[]; nr_routes?: number; timestamp?: string }>(
        "bgp-state",
        { resource: encodedPrefix },
        fetchImpl,
      ),
      ripeCall<{ routes?: ConsistencyRoute[]; query_time?: string }>(
        "prefix-routing-consistency",
        { resource: encodedPrefix },
        fetchImpl,
      ),
    ]);

    const routes = Array.isArray(bgpState.bgp_state)
      ? bgpState.bgp_state.filter((route) => route.target_prefix === prefix)
      : [];
    const overviewHolders = new Map(
      (overview.asns || []).map((item) => [Number(item.asn), item.holder || null]),
    );

    const originCounts = new Map<number, number>();
    const collectors = new Map<string, { total: number; origins: Set<number> }>();
    const pathCounts = new Map<string, { path: number[]; observations: number }>();

    for (const route of routes) {
      const origin = finalOrigin(route.path);
      if (origin) originCounts.set(origin, (originCounts.get(origin) || 0) + 1);

      const collector = String(route.source_id || "unknown").split("-")[0];
      const collectorEntry = collectors.get(collector) || {
        total: 0,
        origins: new Set<number>(),
      };
      collectorEntry.total += 1;
      if (origin) collectorEntry.origins.add(origin);
      collectors.set(collector, collectorEntry);

      if (route.path?.length) {
        const key = route.path.join(" ");
        const existing = pathCounts.get(key);
        if (existing) existing.observations += 1;
        else pathCounts.set(key, { path: route.path, observations: 1 });
      }
    }

    for (const item of overview.asns || []) {
      const asn = Number(item.asn);
      if (asn && !originCounts.has(asn)) originCounts.set(asn, 0);
    }

    const observedOrigins = [...originCounts.entries()]
      .map(([asn, routeCount]) => ({
        asn,
        holder: overviewHolders.get(asn) || null,
        routeCount,
      }))
      .sort((a, b) => b.routeCount - a.routeCount || a.asn - b.asn);

    const referenceOrigin = expectedOrigin ?? observedOrigins[0]?.asn ?? null;
    const collectorsSeeingReference = referenceOrigin
      ? [...collectors.values()].filter((entry) =>
          entry.origins.has(referenceOrigin),
        ).length
      : 0;
    const originAgreementPercent =
      referenceOrigin && collectors.size
        ? Math.round((collectorsSeeingReference / collectors.size) * 100)
        : null;

    const originsForRpki = [
      ...new Set(
        [expectedOrigin, ...observedOrigins.map((item) => item.asn)].filter(
          (item): item is number => Boolean(item),
        ),
      ),
    ].slice(0, 8);

    const rpki = await Promise.all(
      originsForRpki.map(async (asn) => {
        try {
          const data = await ripeCall<{
            status?: "valid" | "invalid_asn" | "invalid_length" | "unknown";
            description?: string;
            validating_roas?: Array<{
              origin?: string;
              prefix?: string;
              max_length?: number;
              validity?: string;
            }>;
          }>("rpki-validation", {
            resource: String(asn),
            prefix,
          }, fetchImpl);
          return {
            asn,
            status: data.status || ("unknown" as const),
            description:
              data.description || "No RPKI description was returned.",
            validatingRoas: (data.validating_roas || []).map((roa) => ({
              origin: String(roa.origin || ""),
              prefix: String(roa.prefix || ""),
              maxLength: Number(roa.max_length || 0),
              validity: String(roa.validity || ""),
            })),
          };
        } catch {
          return {
            asn,
            status: "error" as const,
            description: "RPKI data was unavailable for this origin.",
            validatingRoas: [],
          };
        }
      }),
    );

    const exactRoutes = (consistency.routes || [])
      .filter((route) => route.prefix === prefix && Number(route.origin) > 0)
      .map((route) => ({
        prefix: String(route.prefix),
        origin: Number(route.origin),
        inBgp: Boolean(route.in_bgp),
        inWhois: Boolean(route.in_whois),
        irrSources: Array.isArray(route.irr_sources) ? route.irr_sources : [],
        asnName: route.asn_name || null,
      }));

    const announced = Boolean(overview.announced && observedOrigins.length);
    const expectedSeen =
      expectedOrigin === null ||
      observedOrigins.some((origin) => origin.asn === expectedOrigin);
    const referenceRegistered = referenceOrigin
      ? exactRoutes.some(
          (route) => route.origin === referenceOrigin && route.inWhois,
        )
      : false;
    const referenceRpki = referenceOrigin
      ? rpki.find((item) => item.asn === referenceOrigin)
      : null;
    const hasInvalidRpki = rpki.some(
      (item) => item.status === "invalid_asn" || item.status === "invalid_length",
    );
    const multiOrigin = observedOrigins.length > 1;

    const checks = [
      {
        id: "visibility",
        label: "Global BGP visibility",
        level: announced ? ("pass" as const) : ("fail" as const),
        value: announced ? "Announced" : "Not observed",
        detail: announced
          ? `${routes.length} peer routes were returned across ${collectors.size} RIS collectors.`
          : "RIPE RIS did not return an exact route for this prefix.",
      },
      {
        id: "origin",
        label: "Origin ASN",
        level: !announced
          ? ("fail" as const)
          : !expectedSeen || multiOrigin
            ? ("warning" as const)
            : ("pass" as const),
        value: observedOrigins.length
          ? observedOrigins.map((origin) => `AS${origin.asn}`).join(", ")
          : "None",
        detail:
          expectedOrigin === null
            ? multiOrigin
              ? "More than one origin ASN is visible for the exact prefix."
              : "No expected ASN was supplied; the observed origin is shown."
            : expectedSeen
              ? `AS${expectedOrigin} is visible from ${collectorsSeeingReference} of ${collectors.size} collectors.`
              : `Expected AS${expectedOrigin}, but it was not observed for the exact prefix.`,
      },
      {
        id: "rpki",
        label: "RPKI origin validation",
        level:
          referenceRpki?.status === "valid"
            ? ("pass" as const)
            : referenceRpki?.status === "invalid_asn" ||
                referenceRpki?.status === "invalid_length"
              ? ("fail" as const)
              : ("warning" as const),
        value: referenceRpki
          ? referenceRpki.status.replace("_", " ").toUpperCase()
          : "Unavailable",
        detail:
          referenceRpki?.description ||
          "An origin ASN is required before RPKI can be checked.",
      },
      {
        id: "irr",
        label: "IRR route object",
        level: referenceRegistered ? ("pass" as const) : ("warning" as const),
        value: referenceRegistered ? "Exact match" : "No exact match",
        detail: referenceRegistered
          ? `An exact route object for AS${referenceOrigin} was returned from ${[
              ...new Set(
                exactRoutes
                  .filter((route) => route.origin === referenceOrigin)
                  .flatMap((route) => route.irrSources),
              ),
            ].join(", ")}.`
          : "No exact IRR route object matched the reference origin and prefix.",
      },
      {
        id: "collectors",
        label: "Collector agreement",
        level:
          originAgreementPercent === null
            ? ("info" as const)
            : originAgreementPercent === 100
              ? ("pass" as const)
              : originAgreementPercent >= 80
                ? ("warning" as const)
                : ("fail" as const),
        value:
          originAgreementPercent === null
            ? "Unavailable"
            : `${originAgreementPercent}%`,
        detail: referenceOrigin
          ? `${collectorsSeeingReference} of ${collectors.size} RIS collectors returned at least one path ending at AS${referenceOrigin}.`
          : "No reference origin was available for collector comparison.",
      },
    ];

    let summary: {
      level: "pass" | "warning" | "fail";
      title: string;
      detail: string;
    };
    if (!announced) {
      summary = {
        level: "fail",
        title: "The exact prefix was not observed",
        detail:
          "RIPE RIS did not return a current exact-prefix route. Check the export policy and upstream acceptance.",
      };
    } else if (expectedOrigin !== null && !expectedSeen) {
      summary = {
        level: "fail",
        title: "The expected origin was not observed",
        detail: `The prefix is visible, but current paths do not end at AS${expectedOrigin}.`,
      };
    } else if (hasInvalidRpki) {
      summary = {
        level: "fail",
        title: "The route has an RPKI conflict",
        detail:
          "At least one observed or expected origin fails the current ROA origin or maximum-length policy.",
      };
    } else if (
      multiOrigin ||
      referenceRpki?.status !== "valid" ||
      !referenceRegistered ||
      originAgreementPercent !== 100
    ) {
      summary = {
        level: "warning",
        title: "The route is visible with items to check",
        detail:
          "BGP is returning the prefix, but one or more origin, RPKI, IRR, or collector checks need review.",
      };
    } else {
      summary = {
        level: "pass",
        title: "The advertisement matches the expected state",
        detail:
          "The prefix is visible from the expected origin with valid RPKI and a matching IRR route object.",
      };
    }

    return {
      query: {
        prefix,
        expectedOrigin,
        checkedAt: new Date().toISOString(),
        dataTimestamp:
          bgpState.timestamp || consistency.query_time || overview.query_time || null,
      },
      summary,
      checks,
      bgp: {
        announced,
        observedOrigins,
        routeCount: routes.length,
        peerCount: routes.length,
        collectorCount: collectors.size,
        collectors: [...collectors.keys()].sort(),
        referenceOrigin,
        collectorsSeeingReference,
        originAgreementPercent,
        samplePaths: [...pathCounts.values()]
          .sort(
            (a, b) =>
              b.observations - a.observations || a.path.length - b.path.length,
          )
          .slice(0, 8),
      },
      rpki,
      irr: {
        exactRoutes,
        referenceRegistered,
      },
    };
}
