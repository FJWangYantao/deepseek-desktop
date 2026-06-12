---
name: padel
description: Check padel court availability and manage bookings via Playtomic.
metadata:
  clawdbot:
    requires:
      env:
        - PADEL_AUTH_FILE
      bins:
        - curl
    primaryEnv: PADEL_AUTH_FILE
    nix:
      plugin: "github:clawdbot/nix-steipete-tools?dir=tools/padel"
      systems: ["aarch64-darwin"]
    config:
      requiredEnv: ["PADEL_AUTH_FILE"]
      stateDirs: [".config/padel"]
      example: 'config = { env = { PADEL_AUTH_FILE = "/run/agenix/padel-auth"; }; };'
    cliHelp: "padel --help"
---

# Padel Skill

Manages padel court bookings via Playtomic API.
