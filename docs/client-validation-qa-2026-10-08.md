# Client validation and authorized Google acceptance — October 8, 2026

This records actual acceptance against deployed main `72a64f3a84fc61c6c6e5389ed3acc06ffe5d9b50` and a separately reviewed validation-guidance candidate. Paid-public and scale readiness remain HOLD.

## Production Google acceptance

The owner explicitly approved one-year background access for the existing private source QA workbook and the separate private recovery QA workbook, both in the existing QA Drive folder. Only synthetic records and the approved QA inbox were used. No spending allowance, email ceiling, Google permission scope or live-payment setting changed.

- Saved and verified intake version 1 from the 3D capture preset, with a required reference question above 10,000 square feet. Sent a synthetic request using that version, then saved and verified version 2. The authenticated client and provider still displayed the request's original version 1 wording.
- At 9,000 square feet the conditional reference field was hidden; at 12,000 it appeared as required. A saved brief missing that answer blocked approval and identified the missing reference in Updates. Adding the HTTPS reference cleared the action list. Google readback retained the exact `12 7/16` scope wording.
- Submitted the request and recorded client-only approval. An offered fee without currency failed before any durable operation was created. The typed fee survived. Adding `USD` saved version 5 and cleared the prior approval. The displayed wallet remained at 1,160 credits. Cancelled this synthetic intake request at version 6 without confirming or charging it, then signed out and observed client-draft removal.
- Established a fresh client session for the earlier cancelled synthetic upload request before its normal access deadline. Used **Archive now · end client access** with a recorded QA reason; archive version 7 verified, and reloading the previously authorized client session displayed no brief and required verification.
- The actual private Drive JSON preview identified archive format version 2, digest/signature fields, all eight coordination revisions and both reports. Its single original was the approved 68-byte PNG; the archive-time SHA-256 matched the original fixture's `eb17861bd2d540a1ce8adb27f8c93add53328852b39aa07387fa0ed3d7593585`. This verifies the legacy original through the runtime's archive checks; it is not a claim that the blocked client browser download completed. Existing HTTPS references and exact scope wording were retained in the signed snapshot.
- Selected the independently authorized recovery workbook while retaining the original private folder. Recovery completed with verified Google readback at revision 8. The restored job remained archived and read-only, old client access stayed expired, and the source Sheets history was still visible. Its original eight events matched 16 cells in the source CoordinationEvents sheet. The source's unrelated existing reviewed QA project remained present before workbook switching.
- Reopening was disabled without a reason. A reasoned reopen saved revision 9 and displayed its time and reason. The provider sent a new sign-in link; fresh client verification opened the recovered brief, retaining its exact scope, references and appointment. No second project charge was created.

This archive fixture had no accepted Core project or field-observation revisions; those import paths have source/runtime coverage, not a completed live receipt from this fixture. The native source-history check is separate from physical-device, protected-download and print acceptance.

Both QA grants are still active only while the remaining authorized device/deployed-candidate checks are in progress. Revoke both and restore the original workbook/folder when those checks finish. Original files, archives and source rows must remain intact.

## Validation-guidance candidate

The live missing-currency case revealed a misleading retryable outage response. Known project-field validation now has a distinct error type, converted at the incoming coordination-brief boundary to HTTP 400 with `invalid_project_fields` and the existing actionable instruction. Unknown backend errors remain private HTTP 503 responses. The frontend drops only an explicitly rejected, unacknowledged validation request, keeps its typed draft and creates a new operation for corrected input. Acknowledged writes and uncertain failures retain their recovery behavior.

- 67 focused checks passed, including actual provider API rejection of missing currency, an insecure reference and missing time zone before operations/credits/outbox writes; a corrected save; private upstream-error handling; and rendered draft/retry behavior through the actual HTTP response adapter.
- Full source/runtime suite: 464 passed, zero failed or skipped. The initial sandbox run could not bind loopback sockets for five isolated Workers fixtures; the authorized loopback run passed all 464. App/extension builds and Pages Functions compilation passed.
- Native Chrome local synthetic preview: the precise currency instruction appeared, the fee stayed typed, invalid retry controls disappeared, and adding `USD` saved successfully. At 390 × 844 the document measured 375 pixels wide with no horizontal overflow. The viewport was restored. Captured error/warning logs were empty. This local preview made no Google, email, Stripe or AI calls; deployed acceptance of the fix remains separate.

## Release classification

This candidate requires Cloudflare Functions and frontend deployment through the existing GitHub/main release path, after required exact-head CI and explicit owner merge approval. No migration, secret, provider permission, environment activation, payment mode, AI request or allowance is added. No Lovable action is required. Verify the merged SHA against the production deployment and repeat the missing-currency/corrected-save case before declaring this specific fix activated.
