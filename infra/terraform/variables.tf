variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "ap-south-1"
}

variable "queue_name" {
  description = "Base name for the SQS queue (DLQ gets a -dlq suffix)"
  type        = string
  default     = "novel-os-jobs"
}

variable "visibility_timeout_seconds" {
  description = "How long a message is hidden after being received. Must be >= your longest job runtime."
  type        = number
  default     = 60 # matches SqsJobQueue adapter default
}

variable "max_receive_count" {
  description = "How many times a message is retried before going to the DLQ"
  type        = number
  default     = 3
}

variable "bucket_name" {
  description = "S3 bucket name for media uploads (must be globally unique)"
  type        = string
  default     = "novel-os-media"
}

variable "tags" {
  description = "Tags applied to all resources"
  type        = map(string)
  default = {
    Project   = "novel-os"
    ManagedBy = "terraform"
  }
}
