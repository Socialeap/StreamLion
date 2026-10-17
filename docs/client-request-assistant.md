# Client request assistant

A client who opens a provider's public request form (`#form=`) or private
invitation (`#invite=`) now gets a chat-style assistant
(`src/RequestAssistant.jsx`) that asks one question at a time. It sends exactly
what the one-page form sends, through the existing `public/submit` and
`prospect/request` actions, so the server contract, email confirmation, request
expiry and private status link are unchanged. **One-page form** in the header
opens the existing form (`src/ProspectIntake.jsx`) with the answers so far;
**Answer one question at a time instead** returns to the assistant. Forms
published before provider pricing (a fixed preset estimate and no `pricing`
in the descriptor) keep the one-page form.

The flow (`src/request-assistant.js`) is built from the shared descriptor with
the same chat flow engine as the provider setup assistant (`src/chat-flow.js`):

| Stage           | Questions (asked when)                                                                                                                                                           |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Welcome         | The provider's welcome line (or the standard greeting), then the client's first name, used to address them throughout                                                            |
| Your space      | Space type (Something else → its own description); property name (optional); address card; size in sq ft or Not sure; floors; high ceilings (not for homes)                      |
| What you need   | What to capture; results (multi-select, or the template's listed answers); rooms where exact dimensions matter (floor plans or measurements); the template's other questions     |
| Estimate        | Each priced extra; the live preliminary estimate (only with a size and non-quote pricing); proposed budget (only where the provider accepts one for this client)                 |
| Access & timing | How the provider gets in, with no door or alarm codes; access details (required for Something else); who meets them; up to three dates with a time of day, or flexible; deadline |
| Contact         | Full name (starts from the first name), organisation, phone, email (required for invitations and confirmation forms); role; anything else                                        |
| Review & send   | Every answer grouped by stage with Edit, the estimate line and what sending does                                                                                                 |

The Estimate stage appears only when the provider's published pricing has a
rate, extras or a budget option. A template question on a field the assistant
already asks (scope, size, deliverables, access, availability, deadline, notes,
title, address, name or organisation) rewords that step; a template question
with listed answers becomes a choice of exactly those answers, so the server's
answer check passes. Other template questions get their own step in the
provider's order, with their `when` conditions evaluated against the fields
answered so far. A question whose condition reads a field answered later (for
example the organisation) is moved to just after that answer, so it is never
skipped. Required template questions offer no skip, except the size,
which always allows Not sure.

## Template options added later

- **Several answers.** A template question with listed answers can allow
  more than one (**Clients can choose more than one** in the service template
  editor). The assistant asks it as a multi-select and the one-page form shows
  checkboxes; answers are sent one per line in the provider's order, and the
  server checks every line against the listed answers.
- **Includes condition.** A question can be shown when another answer
  **Includes** a value (case-insensitive), for example a dimensions question
  when the chosen results include "Floor plan". Size keeps its numeric
  "is greater than" condition.
- **Email my status link.** On a public form without email confirmation, a
  client who gives an email can also have the private status link emailed
  (on by default once an email is entered). It goes only to that request's
  email, once per request, through the existing notification outbox; if email
  is unavailable the request still succeeds and the page says to copy the
  link.
- **Progress on the status page.** The client and provider project status
  shows Request sent → Brief agreed → Visit scheduled → Capture complete →
  Results delivered, from the job's recorded state. The visit counts as
  scheduled only when the provider has confirmed an appointment time;
  cancelled, declined and expired requests say so instead.

Templates that use several answers or the Includes condition are rejected by
servers running earlier code, so roll back only before providers save such a
template.

## Field mapping

Every answer becomes a client-editable project field (`CLIENT_FIELDS`), a
priced-extra quantity or the proposed budget. Facts without a field of their
own are labelled lines in **Additional notes**, after anything the client
wrote: `Space type`, `Floors or levels`, `Ceilings over about 12 ft`,
`Exact dimensions needed for` and `Requester role`. The workbook keeps its
existing columns. Deliverables are one result per line. Access is the chosen
option plus any details. Availability is one line per date, `Other times may
work too` when flexible, and `Times are local to the property.`; the provider
still sets the confirmed appointment and time zone. The on-site contact is
contact 1; when someone else meets the provider, the requester becomes
contact 2. Tests check the result against the server's own field, template and
pricing validators.

## Sending, drafts and the status link

Answers are kept on this device for seven days after the last change under
`streamlion-request-v1:<digest>`, keyed by a digest of the form or invitation
token (never the token itself); expired drafts from any form are removed when
one is read. A reload resumes at the same question. For a reusable form the
operation and access token are created once and saved with the draft before
sending, so a reload after an uncertain send retries the same operation; until
then answers cannot be edited and the one-page form is hidden, preventing a
duplicate request. A 400 response discards that attempt. If prices change
before the request is saved, **Review updated prices** reloads the descriptor,
keeps the answers and shows the estimate again before sending, as a new
operation.

After sending: a confirmation form or invitation shows **Check your inbox**,
with **Send the email again** (the same operation) and, for invitations,
**Change something first**. A public form without confirmation shows the
private status link with **Copy link** and **Open request status**, a privacy
note and expiry, and what happens next. The receipt stays on the device for
seven days; **Clear from this device** removes it.

The provider's welcome line comes from business branding (see
[provider branding](provider-branding-release.md)); the assistant's avatar uses
the provider's logo when one is saved.

## Validation

`request-assistant.test.js` covers the flow built from templates and pricing,
the full field mapping against `validateFields`, `validateIntakeAnswers` and
`pricingRequest`, answers that stop applying, template choices, conditions and
required questions, answer validation, the welcome line, legacy forms and
draft storage. `RequestAssistant.test.jsx` drives the real widgets through a
whole request, the status link and reload, email confirmation and resend,
invitation edits, an uncertain send retried after a reload, changed prices,
the provider's welcome and logo, and the portal's switch to the one-page form
and back. Browser QA drove the built client portal at 390 px and 1280 px in
light and dark themes with synthetic API responses.

## Release gates

1. **Review/merge:** owner review of the exact PR; this review does not
   authorize merge.
2. **Migration:** none for the assistant or the welcome line.
3. **Configuration:** none.
4. **Server deployment:** the welcome line, several-answer and Includes
   template options and the emailed status link need the Functions from the
   same commit (shared validators and the public submit action). Until then a saved welcome line
   is ignored and clients see the standard greeting.
5. **Frontend deployment:** the assistant ships with the client portal assets
   through the normal Pages pipeline; use the normal PWA update.
6. **Owner/device QA:** on a phone, open a synthetic public form and a
   synthetic invitation, complete both, confirm the email link, reload midway
   and after sending, switch to the one-page form, and check the request in the
   provider workspace. Use synthetic records only.

No Lovable action is involved; GitHub, Cloudflare and the existing coordination
actions are the only systems used.
