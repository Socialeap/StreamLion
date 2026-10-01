# Measurements prototype

## Provider workflow

Open **Measurements**, choose a saved project, and name the room or exterior
area. Tap **Dictate or type measurements**, then use the microphone on the
phone's keyboard (or the computer's system dictation shortcut).

Say the label and units for each reading, for example:

> Length twelve feet four and three eighths inches. Width ten feet six inches.
> Ceiling eight feet nine inches to underside of beam.

Tap **Organize measurements**. StreamLion separates the readings, formats their
values, and retains the original wording. Check each reading against the tape,
then save the batch. Unclear wording stays highlighted and cannot be marked
reviewed. Unreviewed batches can still be retained for later correction.

After saving, continue in the same room or tap **Start next room**. Download a
text report or use **Print / save as PDF** for the saved batches. Measurements
also appear as readable evidence in Field notes, the ChatGPT project snapshot,
and the delivery summary.

## Supported input and limits

- Labels: Length/L, Width/W, Height/H, Ceiling/C, Depth/D, Diagonal, Segment.
- Imperial: feet and inches, mixed fractions, and spoken fractions. Exact
  fractions such as 1/32 and 3/32 are retained without rounding.
- Metric: mm, cm, and m, including spoken decimals such as "two point zero five
  meters". Numeric arithmetic uses exact rational values.
- Descriptions: wording after "from", "to", "along", "under", "above", "at",
  "beside", "between", "then", or inside parentheses.
- "Continuing six feet eight inches" connects to the preceding reading in the
  **same unsaved batch**, using the same measurement label and unit system.
  Its total describes a measured run, not an area or inferred floor plan.
- "Change width to ..." corrects a reading only when there is one matching
  unsaved entry. Use **Correct reading** for a specific entry otherwise.
- "Undo last entry" removes the latest unsaved reading. Saved batches retain
  their existing evidence and revision history.
- Up to 24 readings and 3,000 original-text characters per batch; serialized
  records must fit the existing 10,000-character observation limit. An excess
  is rejected without truncating the record.

Missing units, conflicting values, unsupported wording, and possible additional
dimensions inside descriptions require clarification. No room is automatically
excluded. The prototype does not derive geometric shapes, floor areas, or a
floor plan, and it does not pair with measuring devices over Bluetooth.

## Storage and cost

Device-keyboard dictation supplies speech-to-text; availability, connectivity,
and microphone setup depend on the device. Typing and organizing work offline.
No AI model, cloud inference, or new paid service is called by this feature.

Unfinished measurement drafts are scoped to the project and workbook (or local
device). Saved batches use versioned `streamlion.measurements` JSON inside the
existing Observations `text` field and `Measurements · ...` area. There are no
new tabs, columns, Google permissions, server functions, or secrets. Google
records use the existing durable local outbox and verified revision writes.
The UI distinguishes local, waiting-for-Google, and saved-in-Google batches.

Corrections update the existing note ID, retain earlier wording, and compare
the expected saved text to block a stale draft. Unsupported or externally
altered measurement records remain visible as evidence needing review; they
cannot silently become reviewed measurements.

## Verification and release

Automated coverage checks exact values, ambiguous speech, linked segments,
tampered records, draft scoping, review gates, correction conflicts, readable
Ask/delivery evidence, and an offline Google outbox save/reload. Local browser
QA uses synthetic projects and typed speech transcripts; it does not prove
physical device speech recognition or a live Google write.

After PR merge and the Cloudflare frontend deployment:

1. On an actual iPhone and Android device, use keyboard dictation for imperial
   fractions, metric decimals, several readings, and an unclear reading.
2. Save a reviewed room, refresh, and reopen it. Correct one reading and check
   that the prior wording is retained.
3. With a connected synthetic workbook, verify the Observations record and
   Google label. Repeat offline, then reconnect and verify one resulting record.
4. Switch projects/rooms; confirm drafts and evidence stay attached to their
   original destinations. Check downloaded and printed reports.

No Lovable action or backend activation is required for this frontend change.
