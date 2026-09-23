---
name: instructions
description: Extract StreamLion project requests from email text and documents, map them to the StreamLion Jotform fields, and produce a prefilled URL. Use whenever the StreamLion plugin is invoked.
---

# StreamLion: project request to prefilled form

Turn a service-request email or document into a source-backed, prefilled URL for `https://form.jotform.com/232567126292155`. Produce the URL in the first complete response whenever any reliable fields are available. The form may still need manual completion; do not require every optional field before building its URL.

## Built-in parameter map

This text map is available even when the bundled `references/StreamLion Input Fields.pdf` cannot be opened. **Never ask the user to attach the field map.** The 2024 PDF is historical; its numbered headings and file-upload fields are not 48 required URL values. The keys below were checked against the live form on September 22, 2026. Recheck if the form changes. Encode brackets and values exactly once:

| Meaning | Prefill key(s) |
| --- | --- |
| Project name / ID | `3dScanCapture`, `projectId` |
| Property size / estimated hours / anticipated on-site work | `propertySize`, `approxHours`, `anticipatedWork` |
| Offered pay (number only) / project instructions | `pay364`, `additionalNotes` |
| Requesting person's first and last name | `requestBy[first]`, `requestBy[last]` |
| Commissioning company | `companyName` |
| On-site contact 1 name and phone | `projectContact`, `projectContact247` |
| On-site contact 2 name and phone | `projectContact254`, `projectContact255` |
| Address components | `projectAddress[addr_line1]`, `projectAddress[addr_line2]`, `projectAddress[city]`, `projectAddress[state]`, `projectAddress[postal]` |
| Available scheduling windows | `availableDatestimes` |
| Selected start appointment | `startDate[day]`, `startDate[month]`, `startDate[year]`, `startDate[timeInput]`, `startDate[ampm]` |
| Selected end appointment | `endDatetime[day]`, `endDatetime[month]`, `endDatetime[year]`, `endDatetime[timeInput]`, `endDatetime[ampm]` |
| Reference 1 label / linked image or document | `reference1nameshort`, `documentimageLink-1` |
| Reference 2 label / linked image or document | `reference2nameshort`, `documentimageLink-2` |
| Document 1 label / URL | `document1Name`, `documentLink-1` |
| Document 2 label / URL | `document2Name`, `document2Link` |

The PDF also lists `projectAddress` (plain text), `availableDatestimes`, `approxEnd`, `approxEnd[timeInput]`, `dateConfirmation`, `name236[first]`, `name236[last]`, and `email237`; these are absent from the current rendered form. Omit them. Its `ContractorEmail` maps to a permanently hidden email control that did not accept the tested prefill; show the requester email in the review and, if relevant, the notes, but do not claim it was populated. The PDF sample conflicts with its table on `image1nameshort` versus `reference1nameshort` and `image2nameshort` versus `reference2nameshort`; the live form confirms the `reference…` keys. `typeA308`–`typeA312` are uploads and cannot be populated through a URL. Do not prefill payment tracking controls such as amount paid or due payment from an offered fee.

## Process

1. Read the supplied email/PDF fully, including the latest message, quoted thread, tables, footers, and attachments that are actually accessible. For a PDF, use PyMuPDF when available for text **and link annotations** (`page.get_links()`); match each link rectangle to its visible anchor text. If a scanned page lacks text, use OCR/vision when available. A clickable label can have a URL absent from extracted text. Ignore tracking, maps, social, mailto, and Gmail attachment URLs unless relevant; do not mistake a link's label for its destination type.
2. Build a short ledger of source-backed values by role: requester, commissioning company, actual on-site contacts, project location, scope, pay, confirmed appointment, delivery instructions, and relevant reference URLs. The latest confirmed appointment supersedes earlier proposals. An approver's name or store's general telephone number is not automatically a direct on-site contact. The service provider is not a project contact merely because named in the thread; do not copy the provider's own phone into an on-site contact field.
3. Map known values using the table above. `pay364` is a number input: encode `250`, never `$250`; put currency, net terms, expenses, and delivery conditions in notes. If pay includes multiple components, use the explicitly offered base amount in `pay364` and explain the others in notes; do not sum unless the source defines a total. An hour estimate of 2.5 means 2 hours 30 minutes. Do not infer an end appointment from a duration, or fill an end date/time when none was stated. Do not invent property size or an attachment's content. A filename or Gmail attachment URL is not a shareable document link.
4. For date parts, use two-digit day/month and four-digit year. The form has separate `[ampm]` fields, so use a 12-hour `HH:MM` value alongside `AM`/`PM`. On this form the date prefills the visible `MM-DD-YYYY` control even when its hidden day/month/year DOM inputs appear blank. Populate the structured address components when available. Use a recognizable company abbreviation only when supplied by the source; otherwise keep the full name. Put relevant scope, exclusions, instructions, deadline, and labeled delivery URL in `additionalNotes`, concise but complete.
5. Construct the query using `encodeURIComponent` for each JavaScript key and value, or Python `urllib.parse.urlencode(fields, quote_via=urllib.parse.quote)`. **Encode spaces as `%20`, not `+`: this form leaves `+` literally in its notes textarea.** Encode each key and value exactly once, including `&`, `?`, `%`, brackets, and nested URLs. Include populated keys only. Parse the URL back and compare every pair with the ledger. When possible, open a synthetic test prefill and inspect the rendered control values without submitting; do not claim rendered validation from URL parsing alone.
6. In the same response, show a compact extraction summary, the prefilled URL as a clickable link and copyable code block, and any important items the user must complete in the form. Missing optional details are not a reason to withhold the URL. Ask one focused question only if a critical value is contradictory or cannot be safely mapped; even then, give the safe partial URL when possible. Never request the bundled field map or a redundant second review.

## Specific care with links and privacy

If a PDF says “upload to Dropbox” but its linked label points to a Jotform upload page, report the actual destination accurately. A separate upload form is an instruction, not a reference document field; do not put it in `documentLink-1` merely because it is a URL. Treat Gmail attachment viewer URLs as session-bound and do not pass them as shared reference links. The recipient can open the linked upload destination separately from the prefilled StreamLion URL.

Use direct professional language. Disclose if the live rendered prefill could not be verified, while still supplying the syntactically validated URL.

