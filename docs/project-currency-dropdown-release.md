# Project currency dropdown

## Scope

Replace only the Payment step’s Currency (ISO code) free-text input with a native select. The browser’s currency-code list supplies formatted choices; older browsers fall back to the existing setup currency list. Blank remains available for unknown currency when no amounts are entered. Existing schema validation still requires a currency for monetary amounts.

Do not infer a currency from an old value such as `US`. Preserve that saved value visibly as a disabled option until the participant chooses a currency. Existing three-letter saved codes remain available, including codes absent from a browser’s list. No automatic draft correction or customer-data migration occurs.

## Verification

- Regression starts with the reported saved `US` draft, checks the adjacent export error and Payment correction route, then verifies a native combobox, disabled invalid saved option, correctly formatted selectable codes, and successful JSON export after selecting USD.
- `node --import tsx --test src/ProjectWizard.test.jsx`: 19 passed.
- `npm test`: 1,229 passed, zero failures/skips.
- `npm run build` and `git diff --check`: passed.
- Tests simulate browser DOM behavior; physical Android native-picker behavior remains owner QA after deployment.

## Release gates

PR #149 is already deployed separately at merged SHA `1137422451a8ee66f4e75acef64f6b66e62e8e36`, Cloudflare Production deployment `da9559dd-e1ae-49f3-be05-258c64c14aac`. Canonical served SHA, persistent health and unchanged provider configuration were verified. Checkout remains paused and free pilot disabled. That deployment does not include this dropdown follow-up.

Review and merge this follow-up before separately authorizing deployment of its exact merged SHA to Cloudflare Pages/Functions `streamlion`. No configuration changes or migrations are required. Retest the installed Android PWA after the normal update: select the actual currency, save/retrieve and download project JSON. Preserve checkout/pilot/metered holds. Roll back only frontend assets to the preceding reviewed artifact if needed; preserve customer data and payment/refund processing.

Backend Activation Required: NO

No Lovable action is required.
