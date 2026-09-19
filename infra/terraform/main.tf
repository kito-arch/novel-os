terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# ── Transcription queue + DLQ ─────────────────────────────────────────────────
resource "aws_sqs_queue" "transcription_dlq" {
  name                      = "${var.transcription_queue_name}-dlq"
  message_retention_seconds = 259200 # 3 days
  tags                      = var.tags
}

resource "aws_sqs_queue" "transcription" {
  name                       = var.transcription_queue_name
  visibility_timeout_seconds = var.transcription_visibility_timeout
  message_retention_seconds  = 86400 # 1 day
  receive_wait_time_seconds  = 20    # long polling

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.transcription_dlq.arn
    maxReceiveCount     = var.max_receive_count
  })

  tags = var.tags
}

# ── Extraction queue + DLQ ────────────────────────────────────────────────────
resource "aws_sqs_queue" "extraction_dlq" {
  name                      = "${var.extraction_queue_name}-dlq"
  message_retention_seconds = 259200 # 3 days
  tags                      = var.tags
}

resource "aws_sqs_queue" "extraction" {
  name                       = var.extraction_queue_name
  visibility_timeout_seconds = var.extraction_visibility_timeout
  message_retention_seconds  = 86400 # 1 day
  receive_wait_time_seconds  = 20    # long polling

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.extraction_dlq.arn
    maxReceiveCount     = var.max_receive_count
  })

  tags = var.tags
}

# ── S3 media bucket ───────────────────────────────────────────────────────────
resource "aws_s3_bucket" "media" {
  bucket = var.bucket_name
  tags   = var.tags
}

resource "aws_s3_bucket_server_side_encryption_configuration" "media" {
  bucket = aws_s3_bucket.media.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket                  = aws_s3_bucket.media.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ── IAM: web-app policy ───────────────────────────────────────────────────────
# The app only sends messages — Lambdas receive and delete.
# Attach this to the IAM user/role your Next.js app authenticates with.
data "aws_iam_policy_document" "app" {
  statement {
    sid     = "SqsSend"
    actions = ["sqs:SendMessage", "sqs:GetQueueAttributes"]
    resources = [
      aws_sqs_queue.transcription.arn,
      aws_sqs_queue.extraction.arn,
    ]
  }

  statement {
    sid     = "S3Objects"
    actions = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.media.arn}/*"]
  }

  statement {
    sid       = "S3Bucket"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.media.arn]
  }
}

resource "aws_iam_policy" "app" {
  name        = "novelos-app"
  description = "novel-os Next.js app: SQS send + S3 media"
  policy      = data.aws_iam_policy_document.app.json
}

# ── IAM: shared Lambda execution role ────────────────────────────────────────
# Both Lambda functions share one role and one inline policy. The transcription
# Lambda reads audio from S3; the extraction Lambda does not — but the shared
# S3 read permission is harmless for a single-project setup.
resource "aws_iam_role" "lambda" {
  name = "novelos-lambda"
  tags = var.tags

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "lambda" {
  name = "novelos-lambda-policy"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SqsConsume"
        Effect = "Allow"
        Action = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
        Resource = [
          aws_sqs_queue.transcription.arn,
          aws_sqs_queue.transcription_dlq.arn,
          aws_sqs_queue.extraction.arn,
          aws_sqs_queue.extraction_dlq.arn,
        ]
      },
      {
        Sid      = "S3ReadAudio"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = ["${aws_s3_bucket.media.arn}/*"]
      },
      {
        Sid      = "CloudWatchLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = ["arn:aws:logs:*:*:*"]
      }
    ]
  })
}

# ── Lambda: Transcription ─────────────────────────────────────────────────────
# Run `npm run build:lambda` before `terraform apply`.
data "archive_file" "transcription" {
  type        = "zip"
  source_file = "${path.module}/../../dist/transcription-lambda.js"
  output_path = "${path.module}/../../dist/transcription-lambda.zip"
}

resource "aws_lambda_function" "transcription" {
  function_name    = "novelos-transcription"
  role             = aws_iam_role.lambda.arn
  filename         = data.archive_file.transcription.output_path
  source_code_hash = data.archive_file.transcription.output_base64sha256
  handler          = "transcription-lambda.handler"
  runtime          = var.lambda_runtime
  timeout          = var.transcription_lambda_timeout

  # Caps parallel AssemblyAI jobs at ASSEMBLYAI_MAX_CONCURRENT (5).
  # The 6th audio upload waits in SQS rather than getting a 429 from AssemblyAI.
  # reserved_concurrent_executions = var.transcription_reserved_concurrency

  environment {
    variables = {
      DATABASE_URL   = var.database_url
      STT_PROVIDER   = "assemblyai"
      STT_API_KEY    = var.stt_api_key
      S3_BUCKET      = aws_s3_bucket.media.bucket
      WEBHOOK_SECRET = var.webhook_secret
    }
  }

  tags = var.tags
}

resource "aws_lambda_event_source_mapping" "transcription" {
  event_source_arn        = aws_sqs_queue.transcription.arn
  function_name           = aws_lambda_function.transcription.arn
  batch_size              = 1
  function_response_types = ["ReportBatchItemFailures"]
}

# ── Lambda: Extraction ────────────────────────────────────────────────────────
data "archive_file" "extraction" {
  type        = "zip"
  source_file = "${path.module}/../../dist/extraction-lambda.js"
  output_path = "${path.module}/../../dist/extraction-lambda.zip"
}

resource "aws_lambda_function" "extraction" {
  function_name    = "novelos-extraction"
  role             = aws_iam_role.lambda.arn
  filename         = data.archive_file.extraction.output_path
  source_code_hash = data.archive_file.extraction.output_base64sha256
  handler          = "extraction-lambda.handler"
  runtime          = var.lambda_runtime
  timeout          = var.extraction_lambda_timeout

  # reserved_concurrent_executions = var.extraction_reserved_concurrency
  # Uncomment once your account's Lambda concurrency limit is raised to >= 20.

  environment {
    variables = {
      DATABASE_URL       = var.database_url
      LLM_PROVIDER       = var.llm_provider
      LLM_API_KEY        = var.llm_api_key
      LLM_CHEAP_MODEL    = var.llm_cheap_model
      LLM_STANDARD_MODEL = var.llm_standard_model
      LLM_BEST_MODEL     = var.llm_best_model
    }
  }

  tags = var.tags
}

resource "aws_lambda_event_source_mapping" "extraction" {
  event_source_arn        = aws_sqs_queue.extraction.arn
  function_name           = aws_lambda_function.extraction.arn
  batch_size              = 1
  function_response_types = ["ReportBatchItemFailures"]
}
