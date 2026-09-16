terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# ── Dead-letter queue ────────────────────────────────────────────────────────
resource "aws_sqs_queue" "dlq" {
  name                       = "${var.queue_name}-dlq"
  message_retention_seconds  = 259200 # 3 days
  visibility_timeout_seconds = var.visibility_timeout_seconds

  tags = var.tags
}

# ── Main queue ───────────────────────────────────────────────────────────────
resource "aws_sqs_queue" "main" {
  name                       = var.queue_name
  visibility_timeout_seconds = var.visibility_timeout_seconds
  message_retention_seconds  = 86400 # 1 day
  receive_wait_time_seconds  = 20    # long polling — matches adapter default

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = var.max_receive_count
  })

  tags = var.tags
}

# ── IAM policy document ──────────────────────────────────────────────────────
# Grants the minimum permissions the SqsJobQueue adapter needs:
#   enqueue  → SendMessage
#   consume  → ReceiveMessage, DeleteMessage
#   fallback → (none — DLQ send goes through the same SendMessage permission)
data "aws_iam_policy_document" "sqs_app" {
  statement {
    sid    = "SendReceiveDelete"
    effect = "Allow"
    actions = [
      "sqs:SendMessage",
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
    ]
    resources = [
      aws_sqs_queue.main.arn,
      aws_sqs_queue.dlq.arn,
    ]
  }
}

resource "aws_iam_policy" "sqs_app" {
  name        = "${var.queue_name}-app-policy"
  description = "Minimal SQS permissions for novel-os job queue"
  policy      = data.aws_iam_policy_document.sqs_app.json
}
