# Time-zone location search

## Cause and fix

The old filter searched only literal IANA display labels, although the input promised city/region search. San Diego and California do not appear in America/Los_Angeles. America/Texas is a location query, not a registry identifier. An unmatched query hid every selectable zone.

Normalize punctuation, separators, case and accents; match query words across zone names and explicit local aliases. Add the reported California/San Diego and Texas aliases. Texas intentionally offers both Chicago/Central and Denver/Mountain, with an explanation to choose the actual visit location. Never infer or save a zone from search text. Preserve an existing selection while filtering.

Unknown or mistyped locations now display a clear no-match message and the complete selectable registry. This is a bounded local alias search, not an arbitrary worldwide city geocoder. No external calls, credentials, permissions, paid services or dependencies are added. Stored IANA values, validation and appointment times remain unchanged.

Alias references: [San Diego official map time reference](https://webmaps.sandiego.gov/arcgis/rest/services/DSD/Zoning_Base/MapServer/0), [National Park Service Texas time-zone guidance](https://www.nps.gov/thingstodo/gumo_whattimeisit.htm). Region matches require explicit selection because boundaries can vary within a state.

## Validation

- Focused selector/search suite: 25 passed. Covers exact reported queries, separators, unknown/typo fallback, blank search, ambiguous Texas results without auto-selection, retained selections and successful JSON export from the fallback list.
- `npm test`: 1,240 passed, zero failures/skips. `npm run build` and `git diff --check`: passed. Physical Android native-selector QA remains a separate acceptance step.

## Release and rollback

Review and merge, then separately approve deployment of the exact merged SHA to Cloudflare Production streamlion. No migrations, server changes, secrets, provider settings or new services are required. Keep checkout paused, pilot disabled, metered holds and the existing owner QA deadline unchanged. Verify served revision, matching assets and health; then test San Diego, California, America/Texas, an unlisted place, selection, and Finish export in Android PWA. Roll back frontend assets only, preserving records and payment/refund processing. Do not renew the temporary QA window automatically.

Backend Activation Required: NO

No Lovable action is required.
