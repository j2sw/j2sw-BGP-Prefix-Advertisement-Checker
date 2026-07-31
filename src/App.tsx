"use client";

import { FormEvent, useState } from "react";
import { runPrefixCheck, type CheckLevel, type CheckResult } from "./check";

const levelLabel: Record<CheckLevel, string> = {
  pass: "PASS",
  warning: "CHECK",
  fail: "FAIL",
  info: "INFO",
};

function asnLabel(asn: number | null) {
  return asn ? `AS${asn}` : "Not observed";
}

function formatDate(value: string | null) {
  if (!value) return "Unavailable";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

export default function Home() {
  const [prefix, setPrefix] = useState("1.1.1.0/24");
  const [asn, setAsn] = useState("AS13335");
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function runCheck(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      setResult(await runPrefixCheck(prefix, asn));
    } catch (requestError) {
      setResult(null);
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The routing check could not be completed.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="https://j2sw.com" aria-label="J2SW home">
          <span className="brand-mark">J2SW</span>
          <span className="brand-divider" />
          <span className="brand-product">Network Tools</span>
        </a>
        <span className="version">Prefix Checker v1.0</span>
      </header>

      <section className="hero">
        <div className="eyebrow">
          <span className="pulse" />
          LIVE ROUTING DATA
        </div>
        <h1>Prefix Advertisement Checker</h1>
        <p className="hero-copy">
          Check how a prefix appears in global BGP, then compare the observed
          origin against RPKI and IRR data.
        </p>

        <form className="check-form" onSubmit={runCheck}>
          <label>
            <span>Prefix</span>
            <input
              value={prefix}
              onChange={(event) => setPrefix(event.target.value)}
              placeholder="203.0.113.0/24"
              spellCheck={false}
              autoCapitalize="none"
              required
            />
          </label>
          <label>
            <span>Expected origin ASN <small>optional</small></span>
            <input
              value={asn}
              onChange={(event) => setAsn(event.target.value)}
              placeholder="AS64500"
              spellCheck={false}
              autoCapitalize="characters"
            />
          </label>
          <button type="submit" disabled={loading}>
            {loading ? "Checking route…" : "Run full check"}
          </button>
        </form>
        <p className="form-note">
          The ASN enables origin mismatch alerts. Prefix-only checks report the
          origin seen by RIPE RIS.
        </p>
        {error && <div className="error-message">{error}</div>}
      </section>

      {!result && !loading && (
        <section className="empty-state" aria-label="Checks performed">
          <div>
            <span className="step-number">01</span>
            <h2>BGP visibility</h2>
            <p>Observed origins, paths, peers, and RIS collectors.</p>
          </div>
          <div>
            <span className="step-number">02</span>
            <h2>RPKI validation</h2>
            <p>ROA origin, validity state, and maximum prefix length.</p>
          </div>
          <div>
            <span className="step-number">03</span>
            <h2>IRR consistency</h2>
            <p>Exact route objects and the registries that return them.</p>
          </div>
        </section>
      )}

      {loading && (
        <section className="loading-panel" aria-live="polite">
          <span className="loading-line" />
          <p>Querying RIPE RIS, RPKI, and routing registry data…</p>
        </section>
      )}

      {result && !loading && (
        <section className="results" aria-live="polite">
          <div className={`summary summary-${result.summary.level}`}>
            <div>
              <span className="summary-kicker">OVERALL RESULT</span>
              <h2>{result.summary.title}</h2>
              <p>{result.summary.detail}</p>
            </div>
            <span className="summary-badge">
              {levelLabel[result.summary.level]}
            </span>
          </div>

          <div className="check-grid">
            {result.checks.map((check) => (
              <article className="check-card" key={check.id}>
                <div className="card-heading">
                  <h3>{check.label}</h3>
                  <span className={`status status-${check.level}`}>
                    {levelLabel[check.level]}
                  </span>
                </div>
                <strong>{check.value}</strong>
                <p>{check.detail}</p>
              </article>
            ))}
          </div>

          <div className="detail-grid">
            <article className="data-panel">
              <div className="panel-heading">
                <div>
                  <span className="panel-kicker">BGP OBSERVATION</span>
                  <h2>Origin and collector view</h2>
                </div>
                <span className="mono muted">
                  {result.bgp.routeCount} routes
                </span>
              </div>

              <dl className="metric-row">
                <div>
                  <dt>Reference origin</dt>
                  <dd>{asnLabel(result.bgp.referenceOrigin)}</dd>
                </div>
                <div>
                  <dt>RIS collectors</dt>
                  <dd>{result.bgp.collectorCount}</dd>
                </div>
                <div>
                  <dt>Collector agreement</dt>
                  <dd>
                    {result.bgp.originAgreementPercent === null
                      ? "N/A"
                      : `${result.bgp.originAgreementPercent}%`}
                  </dd>
                </div>
              </dl>

              <div className="subsection">
                <h3>Observed origins</h3>
                {result.bgp.observedOrigins.length ? (
                  <div className="origin-list">
                    {result.bgp.observedOrigins.map((origin) => (
                      <div key={origin.asn}>
                        <span className="mono">AS{origin.asn}</span>
                        <span>{origin.holder || "Holder unavailable"}</span>
                        <span className="mono muted">
                          {origin.routeCount} observations
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="muted">No origin was observed for this prefix.</p>
                )}
              </div>

              <div className="subsection">
                <h3>Sample AS paths</h3>
                {result.bgp.samplePaths.length ? (
                  <div className="path-list">
                    {result.bgp.samplePaths.map((sample, index) => (
                      <div key={`${sample.path.join("-")}-${index}`}>
                        <code>{sample.path.map((item) => `AS${item}`).join(" → ")}</code>
                        <span>{sample.observations} seen</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="muted">No AS paths were returned.</p>
                )}
              </div>
            </article>

            <article className="data-panel">
              <div className="panel-heading">
                <div>
                  <span className="panel-kicker">ROUTE AUTHORIZATION</span>
                  <h2>RPKI and ROA detail</h2>
                </div>
              </div>
              <div className="rpki-list">
                {result.rpki.length ? (
                  result.rpki.map((item) => (
                    <div className="rpki-item" key={item.asn}>
                      <div className="card-heading">
                        <strong className="mono">AS{item.asn}</strong>
                        <span
                          className={`status status-${
                            item.status === "valid"
                              ? "pass"
                              : item.status === "unknown"
                                ? "warning"
                                : "fail"
                          }`}
                        >
                          {item.status.replace("_", " ").toUpperCase()}
                        </span>
                      </div>
                      <p>{item.description}</p>
                      {item.validatingRoas.map((roa, index) => (
                        <dl className="roa-row" key={`${roa.prefix}-${index}`}>
                          <div>
                            <dt>ROA prefix</dt>
                            <dd className="mono">{roa.prefix}</dd>
                          </div>
                          <div>
                            <dt>Origin</dt>
                            <dd className="mono">AS{roa.origin}</dd>
                          </div>
                          <div>
                            <dt>Max length</dt>
                            <dd className="mono">/{roa.maxLength}</dd>
                          </div>
                        </dl>
                      ))}
                    </div>
                  ))
                ) : (
                  <p className="muted">
                    RPKI cannot be checked until an origin ASN is available.
                  </p>
                )}
              </div>
            </article>
          </div>

          <article className="data-panel irr-panel">
            <div className="panel-heading">
              <div>
                <span className="panel-kicker">ROUTING REGISTRY</span>
                <h2>Exact IRR route objects</h2>
              </div>
              <span className="mono muted">
                {result.irr.exactRoutes.length} result
                {result.irr.exactRoutes.length === 1 ? "" : "s"}
              </span>
            </div>
            {result.irr.exactRoutes.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Prefix</th>
                      <th>Origin</th>
                      <th>IRR object</th>
                      <th>Sources</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.irr.exactRoutes.map((route, index) => (
                      <tr key={`${route.prefix}-${route.origin}-${index}`}>
                        <td className="mono">{route.prefix}</td>
                        <td className="mono">AS{route.origin}</td>
                        <td>{route.inWhois ? "Present" : "Missing"}</td>
                        <td>{route.irrSources.join(", ") || "None returned"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">
                No exact route object was returned for this prefix.
              </p>
            )}
          </article>

          <div className="data-footnote">
            <span>Checked {formatDate(result.query.checkedAt)} UTC</span>
            <span>Routing snapshot {formatDate(result.query.dataTimestamp)} UTC</span>
            <span>Data: RIPEstat and RIPE RIS</span>
          </div>
        </section>
      )}

      <footer>
        <p>
          Results reflect RIPE RIS collectors and current RIPEstat data. They do
          not prove reachability from every network.
        </p>
        <a href="https://blog.j2sw.com">blog.j2sw.com</a>
      </footer>
    </main>
  );
}
