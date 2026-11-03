# Offline project-location time-zone suggestions

## Behavior

Step 5 now reads the project city, state/region and country from step 3. It resolves an exact normalized city/alternate-name match in a bundled GeoNames country table. A single matching time zone is suggested automatically; the participant confirms with one click. Multiple zones require a choice or more region detail. An unknown/conflicting region is never discarded to force a match. Existing and manual time-zone choices are never overwritten automatically. Confirmation uses the existing draft update/export path; no schema or stored appointment-time changes.

This is city-level assistance, not street-address geocoding or a boundary guarantee. Street/unit/postal fields are not used to claim precision. Country and city are needed; missing, unsupported, mismatching or unavailable data leaves the manual selector usable with clear guidance. Dataset coverage is not every worldwide settlement; no nearest-city guess is made. The former manual search remains a fallback.

## Data, privacy and offline limits

Generated from GeoNames cities500.zip, admin1CodesASCII.txt and countryInfo.txt. At this snapshot: 236,907 city records, 246 country shards, approximately 20.2 MB uncompressed in total. Only the selected country downloads at runtime (US approximately 2.6 MB uncompressed). The app shell does not precache all country tables. No paid API, key, service activation, new dependency or browser location permission is involved; ordinary existing hosting/bandwidth/storage still apply.

Matching runs locally. Static requests contain only a country code and version, use credentials:omit and never send street addresses, cities, postal codes, contact information or appointment details. The first country download needs connectivity. Successful country files are cached by the PWA; up to eight files are retained, subject to browser storage eviction. Cold offline use without that country/version shows manual recovery. Current-session country loads are shared and failures can retry. Dataset versions prevent mixing incompatible data.

Attribution appears in the UI and public NOTICE. GeoNames data is CC BY 4.0, provided without completeness/accuracy warranty: https://download.geonames.org/export/dump/readme.txt . Source SHA-256 values and version are in src/location-data-manifest.json and the public NOTICE.

## Refresh

Download the three named GeoNames files from https://download.geonames.org/export/dump/ to a temporary directory, then run:

    python3 scripts/build-location-data.py /private/tmp/streamlion-geonames

Review the generated version, source hashes, size and changed city outcomes. Run lookup/editor regressions and build. Commit/review a new release; no automatic updater or background third-party requests run for customers. Retain earlier static versions while their deployed app bundles may still need them. Do not remove cached customer records.

## Verification and release

`npm test`: 1,247 passed, zero failures/skips. Focused selector/lookup tests: 30 passed. `npm run build` and `git diff --check`: passed.

Tests cover real Miami/Florida, San Diego/California, Richmond/Virginia, El Paso/Texas, London/England and Toronto/Ontario records, ambiguous Portland, conflicting/missing fields, account-free static requests, shared loads/retry, late-response isolation, manual-choice preservation and confirmation through project draft and JSON export. Desktop Chrome synthetic fixture verified Miami confirmation and a changed San Diego location retaining the previous choice. This is not physical Android or a real offline PWA acceptance receipt. Local fixture files are removed before commit.

Review and merge, then separately approve the exact merged frontend release to Cloudflare Production streamlion. No migrations, server function, secrets, provider settings or paid-service changes. Verify canonical SHA, health, static country files and holds; then owner Android QA: populate project Location, open Visit, confirm suggestion, save/reopen/export; warm the country data, test offline reuse and cold-cache fallback. Keep paid checkout paused, pilot disabled, metered holds and owner QA deadline unchanged. No automatic QA extension. Roll back frontend assets, preserving customer data and payment/refund processing; public lookup data can remain for older bundles.

Backend Activation Required: NO

No Lovable action is required.
