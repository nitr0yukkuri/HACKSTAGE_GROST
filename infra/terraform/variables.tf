variable "aws_region" {
  description = "Lambda・API Gateway・Bedrock を配置する AWS リージョン。"
  type        = string
  default     = "ap-northeast-1"

  validation {
    condition     = can(regex("^[a-z]{2}(-gov)?-[a-z]+-[0-9]$", var.aws_region))
    error_message = "aws_region は ap-northeast-1 のようなリージョン名で指定してください。"
  }
}

variable "env" {
  description = "環境名。リソース名と default_tags の Env に使う。"
  type        = string
  default     = "dev"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,15}$", var.env))
    error_message = "env は小文字英数字とハイフン（先頭は英字、16 文字以内）で指定してください。"
  }
}

variable "name_prefix" {
  description = "リソース名の接頭辞。"
  type        = string
  default     = "hoshirube"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,31}$", var.name_prefix))
    error_message = "name_prefix は小文字英数字とハイフン（先頭は英字、32 文字以内）で指定してください。"
  }
}

variable "bedrock_model_id" {
  description = "Bedrock Converse API に渡す modelId。基盤モデル ID（既定は Qwen3 235B A22B 2507）または推論プロファイル ID を指定する。"
  type        = string
  default     = "qwen.qwen3-235b-a22b-2507-v1:0"

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]*(:[0-9]+)?$", var.bedrock_model_id))
    error_message = "bedrock_model_id は qwen.qwen3-235b-a22b-2507-v1:0 のようなモデル ID 形式で指定してください。"
  }
}

variable "bedrock_foundation_model_id" {
  description = "bedrock_model_id が推論プロファイルのときに配下で使う基盤モデル ID。推論プロファイルを使わない場合は bedrock_model_id と同じ値を指定する。"
  type        = string
  default     = "qwen.qwen3-235b-a22b-2507-v1:0"

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]*(:[0-9]+)?$", var.bedrock_foundation_model_id))
    error_message = "bedrock_foundation_model_id は qwen.qwen3-235b-a22b-2507-v1:0 のような基盤モデル ID 形式で指定してください。"
  }
}

variable "bedrock_destination_regions" {
  description = "推論プロファイル経由で基盤モデルを呼び出す可能性があるリージョン。各リージョンの基盤モデル ARN を IAM に許可する。"
  type        = list(string)
  default     = ["ap-northeast-1"]

  validation {
    condition     = length(var.bedrock_destination_regions) > 0 && alltrue([for region in var.bedrock_destination_regions : can(regex("^[a-z]{2}(-gov)?-[a-z]+-[0-9]$", region))])
    error_message = "bedrock_destination_regions は 1 件以上のリージョン名（例 ap-northeast-3）で指定してください。"
  }
}

variable "google_books_api_key_param_name" {
  description = "Google Books API キーを保持する SSM Parameter Store（SecureString）のパラメータ名。null なら Lambda にキー関連の環境変数と SSM 権限を付けない。"
  type        = string
  default     = "/hoshirube/google-books-api-key"

  validation {
    condition     = var.google_books_api_key_param_name == null || can(regex("^/[A-Za-z0-9_.\\-/]+$", var.google_books_api_key_param_name))
    error_message = "google_books_api_key_param_name は /hoshirube/google-books-api-key のように / で始まる階層名か null を指定してください。"
  }
}

variable "cors_allow_origins" {
  description = "CORS で許可するオリジン。ワイルドカード \"*\" は禁止。末尾スラッシュやパスは含めない。"
  type        = list(string)
  default     = ["http://localhost:3000"]

  validation {
    condition = length(var.cors_allow_origins) > 0 && alltrue([
      for origin in var.cors_allow_origins : origin != "*" && can(regex("^https?://[^/*]+$", origin))
    ])
    error_message = "cors_allow_origins は http(s)://ホスト[:ポート] の形式で 1 件以上指定し、\"*\" や末尾スラッシュは使わないでください。"
  }
}

variable "throttling_burst_limit" {
  description = "API Gateway のバースト上限（同時に受け付けるリクエスト数）。"
  type        = number
  default     = 10

  validation {
    condition     = var.throttling_burst_limit >= 1
    error_message = "throttling_burst_limit は 1 以上で指定してください。"
  }
}

variable "throttling_rate_limit" {
  description = "API Gateway のレート上限（1 秒あたりのリクエスト数）。"
  type        = number
  default     = 5

  validation {
    condition     = var.throttling_rate_limit >= 1
    error_message = "throttling_rate_limit は 1 以上で指定してください。"
  }
}

variable "lambda_reserved_concurrency" {
  description = "Lambda の予約同時実行数。null なら予約しない（アカウントの同時実行上限が小さい場合は予約できないため）。"
  type        = number
  default     = null

  validation {
    condition     = var.lambda_reserved_concurrency == null || var.lambda_reserved_concurrency >= 0
    error_message = "lambda_reserved_concurrency は 0 以上の整数か null を指定してください。"
  }
}

variable "budget_alert_email" {
  description = "AWS Budgets の予算アラート先メールアドレス。null なら予算を作らない。"
  type        = string
  default     = null

  validation {
    condition     = var.budget_alert_email == null || can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.budget_alert_email))
    error_message = "budget_alert_email は alert@example.com のようなメールアドレスか null を指定してください。"
  }
}

variable "monthly_budget_usd" {
  description = "budget_alert_email を設定したときに作る月次の予算額（USD）。"
  type        = number
  default     = 20

  validation {
    condition     = var.monthly_budget_usd >= 1
    error_message = "monthly_budget_usd は 1 以上で指定してください。"
  }
}

variable "daily_bedrock_limit" {
  description = "1日（Asia/Tokyo）の Bedrock 呼び出し上限。"
  type        = number
  default     = 3000

  validation {
    condition     = var.daily_bedrock_limit >= 1 && var.daily_bedrock_limit == floor(var.daily_bedrock_limit)
    error_message = "daily_bedrock_limit は 1 以上の整数で指定してください。"
  }
}

variable "daily_google_books_limit" {
  description = "1日（Asia/Tokyo）の Google Books 呼び出し上限。既定の日次クォータより少し下に置く。"
  type        = number
  default     = 900

  validation {
    condition     = var.daily_google_books_limit >= 1 && var.daily_google_books_limit == floor(var.daily_google_books_limit)
    error_message = "daily_google_books_limit は 1 以上の整数で指定してください。"
  }
}

variable "lambda_artifact_path" {
  description = "Lambda に zip する bundle ファイルのパス。null なら backend/dist/index.mjs（terraform ディレクトリからの相対）を使う。"
  type        = string
  default     = null

  validation {
    condition     = var.lambda_artifact_path == null || length(var.lambda_artifact_path) > 0
    error_message = "lambda_artifact_path は空文字にせず、パスを指定するか null にしてください。"
  }
}

variable "log_retention_days" {
  description = "CloudWatch Logs（Lambda・API Gateway アクセスログ）の保持日数。"
  type        = number
  default     = 7

  validation {
    condition = contains([
      1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365,
      400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653,
    ], var.log_retention_days)
    error_message = "log_retention_days は CloudWatch Logs が受け付ける保持日数（1, 3, 5, 7, 14, 30, ...）から選んでください。"
  }
}
