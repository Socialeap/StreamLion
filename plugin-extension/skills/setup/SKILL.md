---
name: setup
description: Set up the StreamLion extension pilot and the user's selected Google workbook.
---

# Connect once, then stay with the job

Call `show_streamlion_workspace` once. Let the user choose **Connect my workbook** in the view; ChatGPT handles the account authorization. The connection screen uses the Google account and workbook selected in the standalone StreamLion workspace. If none is selected, guide the user to Connections once, then return to the connection screen. Never ask for credentials or relay Google access tokens.

After connection, call `list_streamlion_projects` and show the project list. Explain only: choose a job, check **Share this job with this conversation**, then ask a question here. Do not make the user copy/paste a snapshot when these authorized tools work.

If the pilot is not activated, report that plainly. Offer the synthetic example or the existing browser workspace and its two-button ChatGPT handoff. Do not imply account access or Google writes are configured merely because the extension opened.
