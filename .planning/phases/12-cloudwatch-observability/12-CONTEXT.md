# Phase 12: CloudWatch Observability - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — no grey areas)

<domain>
## Phase Boundary

Add a CloudWatch Log Group (for structured JSON logs from pm2/Node.js), a CloudWatch Dashboard with 6 widgets (ALB 5xx, ALB p50/p99 latency, EC2 CPU, DynamoDB read/write capacity), metric filters for 5xx and slow request detection, and ALB access logs shipped to S3. The logger module already exists at src/logger.js and is already used in the hot paths — no code migration needed.

</domain>

<decisions>
## Implementation Decisions

### CloudFormation Approach
- Add all new resources (LogGroup, MetricFilters, Dashboard, ALB AccessLogs) to infra/cloudformation.yml as additional resources
- ALB LoadBalancerAttributes updated to enable access_logs.s3.enabled=true, pointing to existing workspace S3 bucket under prefix `alb-logs/`
- CloudWatch Log Group: /mesh/app — 14-day retention (cost-conscious, sufficient for debugging)
- Metric filter 1: 5xx errors from ALB access logs (pattern: `[..., status=5*]`)
- Metric filter 2: Slow requests >2000ms (filter pattern on response time field)
- Dashboard widgets: ALB RequestCount, HTTPCode_ELB_5XX_Count, TargetResponseTime p50+p99, CPUUtilization, DynamoDB ConsumedReadCapacityUnits, DynamoDB ConsumedWriteCapacityUnits

### Logging
- src/logger.js already outputs NDJSON to stdout — pm2 captures it and forwards to CloudWatch via CloudWatch Agent (already configured in UserData from Phase 11)
- No winston/pino needed — custom logger is sufficient for this scale
- LOG_LEVEL env var already wired via config/index.js

### Claude's Discretion
- Widget layout order in dashboard
- Exact CloudWatch namespace names for metric filters
- S3 bucket policy additions required for ALB access logs (ALB needs permission to write to S3)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- src/logger.js — structured JSON logger, already in use across hot paths
- infra/cloudformation.yml — existing stack with IAM Role, ALB, ASG, CloudFront
- EC2 UserData in CloudFormation already installs/configures CloudWatch Agent

### Established Patterns
- CloudFormation is the single source of truth for all AWS infrastructure
- IAM Role already has CloudWatchAgentServerPolicy attached
- S3 bucket (MeshWorkspaceBucket) already exists in the stack — reuse for ALB logs

### Integration Points
- ALB resource (MeshALB) needs LoadBalancerAttributes for access log S3 config
- IAM Role needs s3:PutObject permission for ALB log bucket prefix
- New CloudFormation resources: AWS::Logs::LogGroup, AWS::Logs::MetricFilter (x2), AWS::CloudWatch::Dashboard

</code_context>

<specifics>
## Specific Ideas

- Dashboard name: "Mesh-Gateway" (matches stack naming convention)
- Log group retention: 14 days (balances cost and debuggability)
- ALB logs prefix: alb-logs/ in MeshWorkspaceBucket

</specifics>

<deferred>
## Deferred Ideas

- Structured request tracing with X-Ray (separate phase if needed)
- CloudWatch Alarms + SNS notifications (can be added on top of dashboard)
- Logs Insights saved queries

</deferred>
