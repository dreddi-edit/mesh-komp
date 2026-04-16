---
phase: 27
plan: "02"
title: "CloudWatch Error Monitoring"
status: complete
started: 2026-04-17T02:30:00Z
completed: 2026-04-17T02:45:00Z
---

# Summary: 27-02 CloudWatch Error Monitoring

## What was built

### Task 1: Add error-code metric filters to CloudFormation — DONE
`infra/cloudformation.yml`: Added 5 MetricFilter resources and 1 Alarm resource after the `AppLogGroup` resource:

- **ValidationErrorMetricFilter**: filter `{ $.code = "VALIDATION_ERROR" }` → `Mesh/Errors::ValidationErrors`
- **NotFoundErrorMetricFilter**: filter `{ $.code = "NOT_FOUND" }` → `Mesh/Errors::NotFoundErrors`
- **AuthErrorMetricFilter**: filter `{ $.code = "AUTH_ERROR" }` → `Mesh/Errors::AuthErrors`
- **InternalErrorMetricFilter**: filter `{ $.code = "INTERNAL_ERROR" }` → `Mesh/Errors::InternalErrors`
- **ConflictErrorMetricFilter**: filter `{ $.code = "CONFLICT" }` → `Mesh/Errors::ConflictErrors`
- **HighErrorRateAlarm**: fires when `InternalErrors` sum > 10 in 2 consecutive 5-minute windows

All filters use `DependsOn: AppLogGroup` to ensure the log group exists before creating filters.

Filter patterns match the `code` field emitted by `src/errors/index.js` in structured JSON log lines. The logger outputs `{ ts, level, msg, ...ctx }` — errors logged with a `code` field hit these filters.

## Key files
- `infra/cloudformation.yml` — 5 MetricFilter + 1 Alarm resources added

## Self-Check: PASSED
- `grep "ValidationErrorMetricFilter" infra/cloudformation.yml` — matches
- `grep "AuthErrorMetricFilter" infra/cloudformation.yml` — matches
- `grep "InternalErrorMetricFilter" infra/cloudformation.yml` — matches
- `grep "Mesh/Errors" infra/cloudformation.yml` — 7 matches (5 namespaces + 2 alarm refs)
- `grep "HighErrorRateAlarm" infra/cloudformation.yml` — matches
