# J2SW Prefix Advertisement Checker

The Prefix Advertisement Checker compares an exact IPv4 or IPv6 prefix against
current RIPEstat and RIPE RIS data. It reports whether the route is visible,
which ASN originates it, how consistently RIPE RIS collectors see that origin,
whether the route passes RPKI validation, and whether an exact IRR route object
was returned.

## Live checks

- Exact-prefix BGP visibility
- Observed origin ASN and optional expected-origin comparison
- Sample AS paths
- RIPE RIS collector agreement
- RPKI origin validation
- ROA prefix and maximum length
- Exact IRR route objects and returned registry sources

The prefix is required. The expected ASN is optional. When no ASN is entered,
the application uses the most commonly observed origin as the reference for
RPKI, IRR, and collector checks.

## Data source

The browser queries the public
[RIPEstat Data API](https://stat.ripe.net/docs/data-api/ripestat-data-api).
Version 1.0 uses the `prefix-overview`, `bgp-state`,
`prefix-routing-consistency`, and `rpki-validation` endpoints. No prefix or ASN
lookup is sent to a J2SW server.

RIPE RIS collectors do not represent every network. A passing result shows that
the advertisement matches the tested data. It does not prove reachability from
every source network.

## Run locally

Install Node.js 24, then run:

```bash
npm ci
npm run dev
```

Vite prints the local address after it starts.

## Test and build

```bash
npm test
npm run build
```

The tests cover IPv4 and IPv6 prefix validation, CIDR normalization, 32-bit ASN
validation, a complete passing advertisement, prefix-only lookup, origin
mismatch, and rejection of invalid input before an API request.

The production files are written to `dist/`.

## Deploy with GitHub Pages

1. Create an empty GitHub repository.
2. Copy every file from this project into the repository.
3. Commit the files and push them to the `main` branch.
4. Open **Settings → Pages** in GitHub.
5. Set **Source** to **GitHub Actions**.
6. Open the **Actions** tab and confirm that **Deploy to GitHub Pages** passes.

The workflow uses `npm ci`, runs the test suite, builds the application, and
deploys `dist/`. Vite uses relative asset paths, so the project works under a
GitHub Pages repository path without changing the repository name in the
source.

## Project structure

```text
src/App.tsx       Application interface
src/check.ts      Validation, RIPEstat requests, and result evaluation
src/styles.css    Layout and responsive styles
tests/            Routing-result and input-validation tests
.github/          Pages workflow and repository templates
```

## Version

Current release: **1.0.0**

See [CHANGELOG.md](CHANGELOG.md) for release details.

## License

Released under the [MIT License](LICENSE).
