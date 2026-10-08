# Client credits and background-access disclosures

The credits page previously described only AI answers, although the existing shared wallet also funds confirmed client jobs. This copy change explains both uses in the credits page, landing page, terms, privacy policy and final Stripe Checkout disclosure. It changes no price, wallet, transaction, permission, grant, retention rule or activation flag.

## Verified behavior behind the wording

- `server/shared-credits.js` reserves the job charge once using the stable job ID. `server/coordination-engine.js` activates only after the provider has authorized the quoted price and both parties approve the current brief. Ordinary edits, same-job reopen and archive recovery add no new job charge. A completed job charge is not automatically refunded by later cancellation.
- Purchased credits and promotional starter credits are separate balances within the shared wallet. The committed purchase trigger revokes remaining promotional credits when a refund or dispute leaves no paid Core order. The starter grant is once per account; a subsequent purchase does not create another grant.
- `server/client-coordination.js` records the selected private workspace's one-year background grant. Revoking client coordination clears that grant's credentials and revokes its client sessions. `server/google-auth.js` also revokes coordination grants/client sessions for the Google account when Core disconnects. Other devices retain their separate Core sign-in sessions; their coordination grants are still revoked.
- Client records and file access remain scoped to the verified job. Early archive ends access; recovery preserves the source and leaves the job archived. Reopening an archived job requires fresh client verification. Signed manifests depend on retained private Drive originals; external reference links are not file backups.

The terms retain the existing one-time Core prices, seven-day app guarantee, prepaid credit purchase/refund rules and 30% AI-cost markup. The existing `#ai-credits` anchor stays valid. Both privacy URLs have identical content. The new wording describes current behavior; live tax, commercial policy, AI-cost approval and paid-public activation remain separate owner decisions.

## Validation

- 25 existing landing behavior checks and four existing credit entitlement/checkout-recovery checks passed. The existing test-mode warning assertion now includes both live jobs and AI answers. App/extension production builds passed. No implementation-mirroring tests were added for text-only changes.
- 11 existing Stripe credit checkout, identity, catalog/mode, refund, webhook and fail-closed checks passed after carrying the shared-wallet disclosure into the server-generated checkout text.
- Native Chrome synthetic local preview displayed the shared wallet and unchanged pack amounts; the landing link reached the credit page. At 390 × 844 the document measured 375 pixels wide, with no horizontal overflow. The viewport was reset. Credit-page error/warning logs were empty.
- Credit terms and privacy links displayed the new coordination, grant and revocation guidance. The local fixture needed pretty-URL aliases for static legal files; production routes were not changed. The preview made no Google, Stripe, email or AI calls and rejected credit mutations.

## Release classification

Frontend page text, document title, server-generated Stripe Checkout disclosure and acceptance documentation. The existing Cloudflare Functions deployment is required for new checkout sessions to display the shared-wallet wording; the frontend release is a separate gate. No migration, secret, provider configuration or catalog mutation is required. No Lovable action is required. Obtain owner review of the new disclosures and merge approval, require exact-head CI, then use the existing Cloudflare release path and verify the exact deployed SHA, public links and a fresh test checkout disclosure without accepting terms or completing payment. This does not accept terms for a buyer, open live checkout, authorize costs or establish scale readiness.
