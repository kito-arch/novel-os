output "queue_url" {
  description = "Set this as SQS_QUEUE_URL in your .env"
  value       = aws_sqs_queue.main.url
}

output "queue_arn" {
  description = "ARN of the main queue"
  value       = aws_sqs_queue.main.arn
}

output "dlq_url" {
  description = "Set this as SQS_DLQ_URL in your .env (optional)"
  value       = aws_sqs_queue.dlq.url
}

output "dlq_arn" {
  description = "ARN of the dead-letter queue"
  value       = aws_sqs_queue.dlq.arn
}

output "iam_policy_arn" {
  description = "Attach this policy to the IAM user/role your app uses"
  value       = aws_iam_policy.sqs_app.arn
}
