#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# deploy-asg.sh — Deploy Mesh Gateway via ASG Instance Refresh
#
# Usage (run from CI or locally after exporting AWS credentials):
#   AWS_REGION=us-east-1 ASG_NAME=mesh-asg-<stack> bash infra/deploy-asg.sh
#
# What it does:
#   1. Triggers an ASG instance refresh (rolling replacement of all instances)
#   2. Each new instance pulls the latest code from Git in UserData on first boot
#   3. Waits up to 10 minutes for the refresh to complete
#   4. Smoke-tests /healthz through the ALB
#
# Requirements:
#   - aws CLI v2 with IAM permissions: autoscaling:StartInstanceRefresh,
#     autoscaling:DescribeInstanceRefreshes, ec2:DescribeInstances
#   - ASG_NAME and ALB_DNS must be set (pass as env vars or hard-code below)
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

AWS_REGION="${AWS_REGION:-us-east-1}"
ASG_NAME="${ASG_NAME:?ASG_NAME is required}"
ALB_DNS="${ALB_DNS:-}"          # optional — for smoke test
MAX_WAIT_SECONDS="${MAX_WAIT_SECONDS:-600}"

echo "▶ Starting instance refresh on ASG: ${ASG_NAME}"

REFRESH_ID=$(aws autoscaling start-instance-refresh \
  --region "${AWS_REGION}" \
  --auto-scaling-group-name "${ASG_NAME}" \
  --preferences "MinHealthyPercentage=50,InstanceWarmup=120,SkipMatching=false,StandbyInstances=Terminate" \
  --query 'InstanceRefreshId' \
  --output text)

echo "  Refresh ID: ${REFRESH_ID}"

echo "▶ Waiting for refresh to complete (timeout: ${MAX_WAIT_SECONDS}s)..."
ELAPSED=0
INTERVAL=15

while true; do
  STATUS=$(aws autoscaling describe-instance-refreshes \
    --region "${AWS_REGION}" \
    --auto-scaling-group-name "${ASG_NAME}" \
    --instance-refresh-ids "${REFRESH_ID}" \
    --query 'InstanceRefreshes[0].Status' \
    --output text)

  PCT=$(aws autoscaling describe-instance-refreshes \
    --region "${AWS_REGION}" \
    --auto-scaling-group-name "${ASG_NAME}" \
    --instance-refresh-ids "${REFRESH_ID}" \
    --query 'InstanceRefreshes[0].PercentageComplete' \
    --output text 2>/dev/null || echo '0')

  echo "  Status: ${STATUS}  (${PCT}% complete, ${ELAPSED}s elapsed)"

  case "${STATUS}" in
    Successful)
      echo "✅ Instance refresh completed successfully."
      break
      ;;
    Failed|Cancelled|RollbackFailed)
      echo "❌ Instance refresh failed with status: ${STATUS}"
      exit 1
      ;;
  esac

  if [[ ${ELAPSED} -ge ${MAX_WAIT_SECONDS} ]]; then
    echo "❌ Timed out waiting for instance refresh after ${MAX_WAIT_SECONDS}s"
    exit 1
  fi

  sleep ${INTERVAL}
  ELAPSED=$((ELAPSED + INTERVAL))
done

# Smoke test
if [[ -n "${ALB_DNS}" ]]; then
  echo "▶ Smoke testing /healthz via ALB..."
  if curl -sf --max-time 10 "http://${ALB_DNS}/healthz" | grep -q '"service"'; then
    echo "✅ Health check passed."
  else
    echo "❌ Health check failed — /healthz did not return expected response."
    exit 1
  fi
fi

echo "✅ Deploy complete."
