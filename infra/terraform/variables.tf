variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "ap-south-1"
}

variable "transcription_queue_name" {
  description = "SQS queue name for audio transcription jobs"
  type        = string
  default     = "novelos-transcription"
}

variable "extraction_queue_name" {
  description = "SQS queue name for LLM extraction jobs"
  type        = string
  default     = "novelos-extraction"
}

variable "transcription_visibility_timeout" {
  description = "Seconds a transcription message is hidden after being received. Must be >= transcription_lambda_timeout."
  type        = number
  default     = 60
}

variable "extraction_visibility_timeout" {
  description = "Seconds an extraction message is hidden after being received. Must be >= extraction_lambda_timeout."
  type        = number
  default     = 120
}

variable "max_receive_count" {
  description = "Times a message is retried before going to its DLQ"
  type        = number
  default     = 3
}

variable "bucket_name" {
  description = "S3 bucket name for media uploads (must be globally unique)"
  type        = string
  default     = "novel-os-media"
}

# ── Lambda runtime & timeouts ─────────────────────────────────────────────────
variable "lambda_runtime" {
  description = "Lambda runtime identifier"
  type        = string
  default     = "nodejs20.x"
}

variable "transcription_lambda_timeout" {
  description = "Max seconds for the transcription Lambda (S3 download + AssemblyAI submit)"
  type        = number
  default     = 60
}

variable "extraction_lambda_timeout" {
  description = "Max seconds for the extraction Lambda (LLM extraction can take 10–60 s)"
  type        = number
  default     = 120
}

variable "transcription_reserved_concurrency" {
  description = "Reserved concurrency for the transcription Lambda. Must equal ASSEMBLYAI_MAX_CONCURRENT (5) to cap concurrent AssemblyAI jobs."
  type        = number
  default     = 5
}

variable "extraction_reserved_concurrency" {
  description = "Reserved concurrency for the extraction Lambda. Tune to your LLM provider's rate limit."
  type        = number
  default     = 5
}

# ── Lambda environment variables (sensitive) ──────────────────────────────────
# Pass via TF_VAR_* environment variables or a terraform.tfvars file (not committed).

variable "database_url" {
  description = "Postgres connection string — used by both Lambdas to read/write dictation rows"
  type        = string
  sensitive   = true
}

variable "stt_api_key" {
  description = "AssemblyAI API key for the transcription Lambda"
  type        = string
  sensitive   = true
}

variable "webhook_secret" {
  description = "Secret echoed back by AssemblyAI in the x-webhook-secret header"
  type        = string
  sensitive   = true
}

variable "llm_provider" {
  description = "LLM provider for the extraction Lambda (openai | anthropic)"
  type        = string
  default     = "openai"
}

variable "llm_api_key" {
  description = "API key for the LLM provider used by the extraction Lambda"
  type        = string
  sensitive   = true
}

variable "llm_cheap_model" {
  description = "Model ID for cheap/fast LLM calls in the extraction Lambda"
  type        = string
  default     = "gpt-4o-mini"
}

variable "llm_standard_model" {
  description = "Model ID for standard LLM calls in the extraction Lambda"
  type        = string
  default     = "gpt-4o"
}

variable "llm_best_model" {
  description = "Model ID for best-quality LLM calls in the extraction Lambda"
  type        = string
  default     = "gpt-4o"
}

variable "tags" {
  description = "Tags applied to all resources"
  type        = map(string)
  default = {
    Project   = "novel-os"
    ManagedBy = "terraform"
  }
}
