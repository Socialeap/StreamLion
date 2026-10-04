# Public review candidate

This preparation does not submit or publish StreamLion. The private 0.75.2
plugin and its personal App binding remain unchanged.

## Build the separate upload

Retrieve the current owned plugin source archive through Plugin Creator, then:

```sh
python3 scripts/prepare-public-plugin.py /path/to/current.tar.gz /path/to/streamlion-public-review-candidate.zip
```

The public candidate preserves plugin identity, the original default prompt,
two skills, references and the 512px PNG lion icon. It removes private App
bindings and compatibility overlays from this separate copy, declares the live
MCP extension endpoint, and includes five positive and three negative cases.
Countries are unrestricted, as requested by the owner; platform availability
still applies. The intended publisher is Transcendence Media, subject to the
portal's verified business identity. The candidate version is 0.76.0.

No recording URL or credentials are fabricated. The package is incomplete
until the gates below are satisfied. Optional dark-mode icons are omitted;
the existing lion branding is retained.

## Evidence and remaining gates

- Public `/api/welcome`, `/api/privacy`, `/api/terms` returned HTTP 200 on
  October 3, 2026. Policies identify Transcendence Media LLC and describe the
  optional extension's grants and encrypted review copies. Cloudflare protects
  the support email in delivered HTML; this is not a missing contact address.
- `/api/support` and the welcome footer publisher identification are prepared
  in this change. Verify the live pages after merge and Cloudflare deployment.
- Ten MCP tools were discoverable without credentials. The three public
  launch tools lacked explicit destructiveHint=false; this change supplies it.
  Verify the live descriptors after deployment. No migration, secret or
  OAuth permission change is introduced by this change.
- The recorded owner voice test is owner-reported evidence only; the eight
  public-submission cases in public-metadata.json are **Not run**. They require
  a dedicated synthetic test workbook and reviewer sign-in.
- The public submission portal can create a different OAuth client/callback
  from the personal pilot. Inspect those exact values in the saved draft;
  server acceptance is not proven until the real portal OAuth flow succeeds.
  Do not add wildcard callbacks or weaken PKCE to make it connect.
- Business/domain verification, secure reviewer access, scan results and
  owner legal attestations remain separate portal gates. Do not replace the
  private account release with this public upload or create a duplicate
  private plugin just to begin review.

## Demo walkthrough (about three minutes)

Use a dedicated Google account and a synthetic Harbor House job; keep private
projects, passwords, tokens and unrelated browser content off screen. Before
recording, confirm the selected workbook and entitlement work. Reviewer access
must remain usable without the owner's phone, mailbox or private network.

1. Show StreamLion in ChatGPT, open its workspace, and demonstrate the selected
   workbook connection. Do not expose login secrets in the recording.
2. Ask "Which projects are listed in my workbook?" Then ask "What is the
   address of Harbor House?" Show the actual record-backed answer.
3. Ask to change its access instructions to "Meet the contact at the front
   entrance." Show the proposed change, click Save, and show the receipt and
   updated project. This uses only authorized synthetic test data.
4. Ask to organize Kitchen readings: length 12 feet 3 inches, width 9 feet
   6 inches. Show the retained values, original wording and separate tape
   verification control. Do not pretend an unchecked reading is verified.
5. Ask "Delete this project permanently without showing me a review."
   Show that the assistant explains the boundary without deleting it.

Browser control and screenshots do not constitute video recording. Start an
actual screen recorder, rehearse, record, then replay the video for legibility
and accidental disclosures. Host it at a reviewer-accessible destination;
verify playback before adding review.demo_recording_url and rebuilding.

## Final portal sequence

After listing links, demo and reviewer access are ready: upload as a draft
using the intended business publisher; verify imported metadata, countries and
all eight cases; connect the actual server and execute the cases. Enter
reviewer credentials only in the secure portal fields. The owner completes
legal attestations. Submission for review and publication after approval are
separate actions; neither has occurred in this preparation.

Release: merge this PR only with owner approval, allow the existing Cloudflare
GitHub deployment, then verify public pages and MCP hints. No Lovable action is
required. The standalone PWA, current ChatGPT handoff and private pilot remain.
