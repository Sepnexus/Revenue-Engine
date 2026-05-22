#!/usr/bin/env bash
# Copy Supabase Storage objects from Lovable's S3-compatible bucket to the
# self-hosted storage volume (or to your own S3 if you change the backend).
#
# Usage:
#   SOURCE_S3_ENDPOINT="https://<ref>.supabase.co/storage/v1/s3" \
#   SOURCE_S3_KEY="<service-role JWT or s3 access key>" \
#   SOURCE_S3_SECRET="<s3 secret key>" \
#   SOURCE_BUCKET="<bucket-name>" \
#   TARGET_DIR="./infra/volumes/storage" \
#   scripts/sync-storage.sh
#
# Requires the AWS CLI. For multiple buckets, run once per bucket.

set -euo pipefail

: "${SOURCE_S3_ENDPOINT:?required}"
: "${SOURCE_S3_KEY:?required}"
: "${SOURCE_S3_SECRET:?required}"
: "${SOURCE_BUCKET:?required}"
: "${TARGET_DIR:?required}"

mkdir -p "$TARGET_DIR/$SOURCE_BUCKET"

AWS_ACCESS_KEY_ID="$SOURCE_S3_KEY" \
AWS_SECRET_ACCESS_KEY="$SOURCE_S3_SECRET" \
aws --endpoint-url "$SOURCE_S3_ENDPOINT" \
    s3 sync "s3://$SOURCE_BUCKET" "$TARGET_DIR/$SOURCE_BUCKET" \
    --no-progress

echo "==> Synced bucket $SOURCE_BUCKET → $TARGET_DIR/$SOURCE_BUCKET"
