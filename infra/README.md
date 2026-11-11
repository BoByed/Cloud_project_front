# Frontend Infrastructure & CloudFront Edge Distribution

This Terraform root manages the frontend static hosting and CloudFront edge delivery layer for CloudChat (LINE เถื่อน), adhering to the design specifications in [ADR 0003: AWS Hosting & Delivery](../../chat-api/docs/adr/0003-aws-hosting-and-delivery.md) and [Shared Edge Spec](../../chat-api/infra/shared-edge/README.md).

## Architecture

- **Private S3 Bucket**: Stores static Svelte SPA assets (`index.html`, `_app/immutable/*`).
  - Block Public Access enabled on all 4 settings.
  - BucketOwnerEnforced object ownership.
  - Default server-side encryption (SSE-S3 AES-256).
  - Strict bucket policy enforcing TLS and granting `s3:GetObject` only to CloudFront via Origin Access Control (OAC).
- **CloudFront Origin Access Control (OAC)**: Modern, secure AWS authentication mechanism replacing legacy OAI.
- **Single-Origin CloudFront Distribution**:
  - Serves static SPA from S3 under the default behavior (`/*`).
  - Routes `/api/*`, `/auth/*`, and `/health/*` directly to the Application Load Balancer (ALB) pointing to ECS Fargate backend tasks.
  - Applies `Managed-CachingDisabled` and `Managed-AllViewer` policies for API and Auth paths, forwarding cookies, query strings, headers, and WebSocket upgrades (`/api/v1/ws`).
  - Provides SPA fallback for client-side routing (`/index.html` on 403/404).

## Deployment

```sh
terraform init
terraform plan -var="aws_account_id=<ACCOUNT_ID>" -var="alb_dns_name=<ALB_DNS>"
terraform apply -var="aws_account_id=<ACCOUNT_ID>" -var="alb_dns_name=<ALB_DNS>"
```

Deploying frontend static files after build:

```sh
aws s3 sync build/ s3://<frontend_bucket_name>/ --delete
aws cloudfront create-invalidation --distribution-id <distribution_id> --paths "/*"
```
