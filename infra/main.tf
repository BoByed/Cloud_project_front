terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

locals {
  name_prefix = "${var.project}-${var.environment}"
  s3_origin_id = "${local.name_prefix}-frontend-s3"

  # Managed AWS CloudFront Policies
  managed_caching_disabled_policy_id = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
  managed_all_viewer_policy_id       = "216adef6-5c7f-47e4-b989-5492eafa07d3"
  managed_caching_optimized_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"

  common_tags = {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "Terraform"
    Component   = "frontend"
  }
}

# ------------------------------------------------------------------------------
# 1. Private S3 Bucket for Static Frontend Assets
# ------------------------------------------------------------------------------
resource "aws_s3_bucket" "frontend" {
  bucket        = "${local.name_prefix}-frontend-${var.aws_account_id}"
  force_destroy = false

  tags = local.common_tags
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket                  = aws_s3_bucket.frontend.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# ------------------------------------------------------------------------------
# 2. CloudFront Origin Access Control (OAC)
# ------------------------------------------------------------------------------
resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${local.name_prefix}-frontend-oac"
  description                       = "OAC for CloudChat frontend private S3 bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# ------------------------------------------------------------------------------
# 3. Single-Origin CloudFront Distribution
# Routes static web assets to S3 and /api/*, /auth/*, /health/* to ALB
# ------------------------------------------------------------------------------
resource "aws_cloudfront_distribution" "cdn" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "CloudChat Cloud-Native Edge Distribution (${var.environment})"
  default_root_object = "index.html"
  price_class         = "PriceClass_100"

  # Origin 1: Private S3 Bucket for Frontend Assets
  origin {
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id                = local.s3_origin_id
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  # Origin 2: ALB for Backend Go API, Auth & WebSocket
  origin {
    domain_name = var.alb_dns_name
    origin_id   = var.alb_origin_id

    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "https-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 60
      origin_keepalive_timeout = 5
    }
  }

  # Default Behavior: Serve Static S3 SPA
  default_cache_behavior {
    target_origin_id       = local.s3_origin_id
    viewer_protocol_policy = "redirect-to-https"

    allowed_methods = ["GET", "HEAD"]
    cached_methods  = ["GET", "HEAD"]

    cache_policy_id = local.managed_caching_optimized_policy_id
    compress        = true
  }

  # Ordered Behavior 1: /api/* -> ALB (No caching, forward all headers & cookies)
  ordered_cache_behavior {
    path_pattern           = "/api/*"
    target_origin_id       = var.alb_origin_id
    viewer_protocol_policy = "https-only"

    allowed_methods = ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"]
    cached_methods  = ["GET", "HEAD"]

    cache_policy_id          = local.managed_caching_disabled_policy_id
    origin_request_policy_id = local.managed_all_viewer_policy_id
    compress                 = false
  }

  # Ordered Behavior 2: /auth/* -> ALB (No caching, forward all headers & cookies)
  ordered_cache_behavior {
    path_pattern           = "/auth/*"
    target_origin_id       = var.alb_origin_id
    viewer_protocol_policy = "https-only"

    allowed_methods = ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"]
    cached_methods  = ["GET", "HEAD"]

    cache_policy_id          = local.managed_caching_disabled_policy_id
    origin_request_policy_id = local.managed_all_viewer_policy_id
    compress                 = false
  }

  # Ordered Behavior 3: /health/* -> ALB
  ordered_cache_behavior {
    path_pattern           = "/health/*"
    target_origin_id       = var.alb_origin_id
    viewer_protocol_policy = "https-only"

    allowed_methods = ["GET", "HEAD"]
    cached_methods  = ["GET", "HEAD"]

    cache_policy_id          = local.managed_caching_disabled_policy_id
    origin_request_policy_id = local.managed_all_viewer_policy_id
    compress                 = false
  }

  # SPA Routing Fallback for Client-Side Routing
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 10
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 10
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = local.common_tags
}

# ------------------------------------------------------------------------------
# 4. S3 Bucket Policy for CloudFront OAC
# ------------------------------------------------------------------------------
data "aws_iam_policy_document" "s3_oac_policy" {
  statement {
    sid       = "AllowCloudFrontServicePrincipalReadOnly"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.frontend.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.cdn.arn]
    }
  }

  statement {
    sid       = "EnforceTLSRequestsOnly"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.frontend.arn, "${aws_s3_bucket.frontend.arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "frontend_oac" {
  bucket = aws_s3_bucket.frontend.id
  policy = data.aws_iam_policy_document.s3_oac_policy.json

  depends_on = [aws_s3_bucket_public_access_block.frontend]
}
