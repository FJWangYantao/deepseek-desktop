---
name: todoist-cli
description: Manage Todoist tasks, projects, and labels from the command line via the Todoist REST API.
version: 1.2.0
metadata:
  openclaw:
    requires:
      env:
        - TODOIST_API_KEY
      bins:
        - curl
    primaryEnv: TODOIST_API_KEY
    envVars:
      - name: TODOIST_API_KEY
        required: true
        description: Todoist API token.
      - name: TODOIST_PROJECT_ID
        required: false
        description: Optional default project ID.
    emoji: "✅"
    homepage: https://github.com/example/todoist-cli
    install:
      - kind: brew
        formula: todoist-cli
        bins:
          - todoist
---

# Todoist CLI

This skill calls the Todoist REST API via curl.

## Usage

Read `TODOIST_API_KEY` from env, then `curl -H "Authorization: Bearer $TODOIST_API_KEY" https://api.todoist.com/rest/v2/tasks`.
