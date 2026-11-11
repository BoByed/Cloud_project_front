variable "project" {
  description = "Project identifier for naming and tags"
  type        = string
  default     = "cloudchat"
}

variable "environment" {
  description = "Deployment environment (e.g. dev, demo, staging, prod)"
  type        = string
  default     = "dev"
}

variable "aws_account_id" {
  description = "AWS Account ID for resource uniqueness"
  type        = string
}

variable "aws_region" {
  description = "AWS region for provider resources"
  type        = string
  default     = "ap-southeast-1"
}

variable "alb_dns_name" {
  description = "DNS name of the Application Load Balancer serving chat-api"
  type        = string
}

variable "alb_origin_id" {
  description = "Identifier for the ALB origin in CloudFront distribution"
  type        = string
  default     = "chat-alb"
}
