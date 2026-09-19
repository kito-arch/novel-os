output "transcription_queue_url" {
  description = "Set this as SQS_TRANSCRIPTION_QUEUE_URL in your .env"
  value       = aws_sqs_queue.transcription.url
}

output "transcription_queue_arn" {
  description = "ARN of the transcription queue"
  value       = aws_sqs_queue.transcription.arn
}

output "transcription_dlq_url" {
  description = "URL of the transcription dead-letter queue"
  value       = aws_sqs_queue.transcription_dlq.url
}

output "extraction_queue_url" {
  description = "Set this as SQS_EXTRACTION_QUEUE_URL in your .env"
  value       = aws_sqs_queue.extraction.url
}

output "extraction_queue_arn" {
  description = "ARN of the extraction queue"
  value       = aws_sqs_queue.extraction.arn
}

output "extraction_dlq_url" {
  description = "URL of the extraction dead-letter queue"
  value       = aws_sqs_queue.extraction_dlq.url
}

output "app_policy_arn" {
  description = "Attach this policy to the IAM user/role your Next.js app uses"
  value       = aws_iam_policy.app.arn
}

output "transcription_lambda_name" {
  description = "Name of the transcription Lambda function"
  value       = aws_lambda_function.transcription.function_name
}

output "extraction_lambda_name" {
  description = "Name of the extraction Lambda function"
  value       = aws_lambda_function.extraction.function_name
}

output "bucket_name" {
  description = "Set this as S3_BUCKET in your .env"
  value       = aws_s3_bucket.media.bucket
}

output "bucket_arn" {
  description = "ARN of the media S3 bucket"
  value       = aws_s3_bucket.media.arn
}
