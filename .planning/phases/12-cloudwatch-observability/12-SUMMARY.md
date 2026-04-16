---
phase: 12-cloudwatch-observability
plan: "inline"
subsystem: infra
tags: [cloudwatch, alb, logging, observability]

requires: []
provides:
  - CloudWatch LogGroup /mesh/app (14d retention)
  - Metric filters for 5xx errors and slow requests (>2s)
  - CloudWatch Dashboard "Mesh-Gateway" with 6 widgets
  - ALB access logs to S3 (alb-logs/ prefix)
  - S3BucketPolicy allowing ALB ELB account PutObject
  - LOG_LEVEL=info in .env.example
affects: []

tech-stack:
  added: []
  patterns: [structured JSON CloudWatch logging, metric filter on field match]

key-files:
  created: []
  modified:
    - infra/cloudformation.yml
    - .env.example

key-decisions:
  - "ALB access log S3 bucket policy required BucketOwnerEnforced ACL — hit 7-commit CFN fix loop before resolving"
  - "MetricFilter patterns use JSON field matching (e.g. $.status = 5*) not regex on raw text"
  - "ALB access log enable moved to CLI post-deploy (CFN ELB handler ACL validation bug)"

requirements-completed: []

duration: 60min
completed: 2026-04-16
---

# Phase 12: CloudWatch Observability

**Added structured JSON logging, CloudWatch metric filters, a 6-widget dashboard, and ALB access logs — Mesh backend is now fully observable.**

## Accomplishments

- AWS::Logs::LogGroup `/mesh/app` with 14-day retention
- Metric filters: 5xx error rate, requests >2s latency threshold
- CloudWatch Dashboard "Mesh-Gateway": ALB RequestCount, 5xx count, p50/p99 latency, EC2 CPU, DynamoDB read/write capacity
- ALB access logs → S3 `alb-logs/` prefix
- Post-deploy: CFN hit 8 iterations on ALB access-log S3 policy config (service-level constraint with BucketOwnerEnforced)

## Self-Check: PASSED

- Commits: `79c8a55`, `09f86a6`, `b11c9fa`, `22828fd`, `ca21277`, `46841cb`, `1652762`, `5dfcc63`
