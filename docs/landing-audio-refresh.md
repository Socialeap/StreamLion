# Harbor House prerecorded playback

Frontend-only refresh of the landing demo, including the requested Smart Chat
heading. Playback uses static, same-origin MP3s rather than browser speech
synthesis. No provider calls, credentials, migrations, configuration changes or
server activation are required. Playback incurs no AI generation cost.

The voice demo has a fixed synthetic Harbor House snapshot so edits in the
separate workflow sample cannot make the displayed answer differ from its
prerecorded answer. The shared bounded project-answer lookup still supplies
the displayed facts and field sources.

## Supplied recordings, October 20, 2026

| Answer       | Source file      | Duration   | SHA-256                                                            | State                                          |
| ------------ | ---------------- | ---------- | ------------------------------------------------------------------ | ---------------------------------------------- |
| Site contact | Site Contact.mp3 | 9.168980 s | `d984f4d2241b703837b15538ba29c17878d5a6d6ed3d09f075470a3b05e349cb` | Integrated unchanged                           |
| Access       | Access.mp3       | 3.813878 s | `8b38ba3c6e8b6550f15b70b4396f3486104506d139bf8ce275ff7970747356af` | Integrated unchanged                           |
| Deliverables | Deliverables.mp3 | 7.967313 s | `d9bc557f68c9fd5e6c4a545e192507f1cf5c7320175b531d145752d361986861` | Corrected owner recording integrated unchanged |

All three files are distinct mono MP3s at 44.1 kHz. No conversion was necessary.
The corrected Deliverables recording replaces the rejected duplicate; all three
read buttons are enabled when their answer is selected.

## Verification

- 16 focused tests pass: sample answer lookup, field workflow, correct recording
  selection, explicit playback, stop, switching, end, leaving/hiding the page,
  rejected playback, stale rejection isolation, and distinct existing assets.
- Production build passes with the pre-existing read-brief.js import warning.
- Built preview at `http://127.0.0.1:4188/api/welcome#voice-sample`: all three
  selections reached readyState 4, paused false and advancing currentTime with
  their expected asset URL and duration (contact 9.17 s, access 3.81 s,
  deliverables 7.97 s). Switching removed the previous player; Stop removed the
  active player. No browser warnings/errors were captured during these checks.
- This verifies browser playback and source-file mapping, not a listening review
  of the spoken content or physical-device acceptance.

## Release gates

The corrected recording is integrated, all three mappings pass browser playback
verification, and the change is ready for review. Merge requires owner approval.
Cloudflare frontend release and subsequent owner/device playback QA are separate
gates. No backend deployment is needed. No Lovable action is required.
