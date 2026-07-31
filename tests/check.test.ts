import assert from "node:assert/strict";
import test from "node:test";
import {
  runPrefixCheck,
  validateAsn,
  validatePrefix,
} from "../src/check";

function ok(data: unknown) {
  return new Response(JSON.stringify({ status: "ok", data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function mockRipeFetch(): typeof fetch {
  return async (input) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    const endpoint = url.pathname.split("/").at(-2);

    if (endpoint === "prefix-overview") {
      return ok({
        announced: true,
        asns: [{ asn: 13335, holder: "CLOUDFLARENET" }],
        query_time: "2026-07-31T03:00:00Z",
      });
    }

    if (endpoint === "bgp-state") {
      return ok({
        bgp_state: [
          {
            target_prefix: "1.1.1.0/24",
            source_id: "rrc00-peer-a",
            path: [64500, 13335],
          },
          {
            target_prefix: "1.1.1.0/24",
            source_id: "rrc01-peer-b",
            path: [64496, 13335],
          },
          {
            target_prefix: "1.1.0.0/16",
            source_id: "rrc02-peer-c",
            path: [13335],
          },
        ],
        nr_routes: 3,
        timestamp: "2026-07-31T03:00:00Z",
      });
    }

    if (endpoint === "prefix-routing-consistency") {
      return ok({
        routes: [
          {
            prefix: "1.1.1.0/24",
            origin: 13335,
            in_bgp: true,
            in_whois: true,
            irr_sources: ["APNIC", "RADB"],
            asn_name: "CLOUDFLARENET",
          },
        ],
        query_time: "2026-07-31T03:00:00Z",
      });
    }

    if (endpoint === "rpki-validation") {
      const asn = Number(url.searchParams.get("resource"));
      if (asn !== 13335) {
        return ok({
          status: "invalid_asn",
          description: "The route origin does not match the ROA.",
          validating_roas: [],
        });
      }
      return ok({
        status: "valid",
        description: "The route is covered by a valid ROA.",
        validating_roas: [
          {
            origin: "13335",
            prefix: "1.1.1.0/24",
            max_length: 24,
            validity: "valid",
          },
        ],
      });
    }

    return new Response("Not found", { status: 404 });
  };
}

test("normalizes IPv4 and IPv6 prefixes to the network boundary", () => {
  assert.equal(validatePrefix("1.1.1.4/24"), "1.1.1.0/24");
  assert.equal(validatePrefix("2001:db8::1234/48"), "2001:db8::/48");
  assert.equal(validatePrefix("not-a-prefix"), null);
});

test("accepts AS-prefixed and numeric 32-bit ASNs", () => {
  assert.equal(validateAsn("AS13335"), 13335);
  assert.equal(validateAsn(4_294_967_295), 4_294_967_295);
  assert.equal(validateAsn(""), null);
  assert.equal(validateAsn("AS4294967296"), undefined);
});

test("returns a full passing result for a visible valid route", async () => {
  const result = await runPrefixCheck(
    "1.1.1.4/24",
    "AS13335",
    mockRipeFetch(),
  );

  assert.equal(result.query.prefix, "1.1.1.0/24");
  assert.equal(result.summary.level, "pass");
  assert.equal(result.bgp.routeCount, 2);
  assert.equal(result.bgp.collectorCount, 2);
  assert.equal(result.bgp.originAgreementPercent, 100);
  assert.equal(result.rpki[0].status, "valid");
  assert.equal(result.irr.referenceRegistered, true);
});

test("uses the observed origin when the expected ASN is blank", async () => {
  const result = await runPrefixCheck("1.1.1.0/24", "", mockRipeFetch());

  assert.equal(result.query.expectedOrigin, null);
  assert.equal(result.bgp.referenceOrigin, 13335);
  assert.equal(result.summary.level, "pass");
});

test("flags an expected origin that is not observed", async () => {
  const result = await runPrefixCheck(
    "1.1.1.0/24",
    "AS64500",
    mockRipeFetch(),
  );

  assert.equal(result.summary.level, "fail");
  assert.equal(result.summary.title, "The expected origin was not observed");
  assert.equal(
    result.checks.find((check) => check.id === "origin")?.level,
    "warning",
  );
});

test("rejects invalid input before making a routing-data request", async () => {
  let called = false;
  const fetchImpl: typeof fetch = async () => {
    called = true;
    return ok({});
  };

  await assert.rejects(
    runPrefixCheck("1.1.1.0/33", "AS13335", fetchImpl),
    /valid IPv4 or IPv6 prefix/,
  );
  assert.equal(called, false);
});
