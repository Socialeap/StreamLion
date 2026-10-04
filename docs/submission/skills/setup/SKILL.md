---
name: setup
description: Connect StreamLion to the user's selected Google workbook and begin project work.
---

# Connect once, then stay with the job

Call `show_streamlion_workspace` once. Let the user choose **Connect my workbook** in the view; ChatGPT handles the account authorization. The connection screen uses the Google account and workbook selected in the standalone StreamLion workspace. If none is selected, guide the user to Connections once, then return to the connection screen. Never ask for credentials or relay Google access tokens.

After connection, call `list_streamlion_projects` and show the project list. Explain only: choose a job, check **Share this job with this conversation**, then ask a question here. Do not make the user copy/paste a snapshot when these authorized tools work.

If a tool reports unavailable access or a connection error, explain the failed operation and offer Retry or the standalone workspace. The synthetic example uses sample data only. Opening the workspace does not establish authorization or confirm a Google save.
