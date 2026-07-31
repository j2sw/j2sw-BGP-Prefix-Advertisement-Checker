# Contributing

Open an issue before changing result logic or adding another routing-data
source. Include the prefix type, expected result, and the documentation for the
data source.

For code changes:

1. Create a branch from `main`.
2. Run `npm ci`.
3. Add or update tests for the changed behavior.
4. Run `npm test`.
5. Run `npm run build`.
6. Open a pull request with the behavior change and test result.

Do not include customer prefixes, private routing data, API credentials, or
screenshots that expose production policy.
