---
title: Sentry Loop · Live metric replay
emoji: 📈
colorFrom: gray
colorTo: blue
sdk: static
app_file: index.html
pinned: false
---

# Sentry Loop — Worker telemetry

This static Space replays the original repository's 216 recorded Worker GRPO
steps when opened directly. When opened from the Sentry Loop Arena, it follows
that Arena window's replay cursor and renders the current episode's Worker tool
rewards, success rate, and Auditor flags. It does not start model training.

Source: `training/grpo_metrics.csv` in the configured source repository.
