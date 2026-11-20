data "aws_caller_identity" "current" {}

locals {
  function_name = "${var.name_prefix}-${var.env}-api"

  source_path  = coalesce(var.lambda_artifact_path, "${path.module}/../../backend/dist/index.mjs")
  build_dir    = "${path.module}/build"
  archive_path = "${local.build_dir}/lambda.zip"

  # 推論プロファイル ID は "jp.amazon.nova-2-lite-v1:0" のようにジオ接頭辞を持つ。
  # 接頭辞が無ければ基盤モデル ID を直接呼ぶものとして扱う。
  model_id_is_inference_profile = can(regex("^(us|eu|apac|jp|global)\\.", var.bedrock_model_id))

  # Converse API は bedrock:InvokeModel を要求する。対象を推論プロファイルと
  # 配下の基盤モデル（推論先リージョン）だけに絞る。
  bedrock_invoke_model_resources = distinct(concat(
    [for region in var.bedrock_destination_regions :
      "arn:aws:bedrock:${region}::foundation-model/${var.bedrock_foundation_model_id}"
    ],
    [
      local.model_id_is_inference_profile
      ? "arn:aws:bedrock:${var.aws_region}:${data.aws_caller_identity.current.account_id}:inference-profile/${var.bedrock_model_id}"
      : "arn:aws:bedrock:${var.aws_region}::foundation-model/${var.bedrock_model_id}"
    ],
  ))

  google_books_param_name = var.google_books_api_key_param_name
  google_books_param_arn = local.google_books_param_name == null ? null : (
    "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${local.google_books_param_name}"
  )

  # API Gateway のアクセスログ。クエリ文字列・ヘッダーは記録しない。
  access_log_format = jsonencode({
    requestId          = "$context.requestId"
    ip                 = "$context.identity.sourceIp"
    method             = "$context.httpMethod"
    routeKey           = "$context.routeKey"
    status             = "$context.status"
    responseLength     = "$context.responseLength"
    integrationLatency = "$context.integrationLatency"
  })
}

data "archive_file" "lambda" {
  type        = "zip"
  source_file = local.source_path
  output_path = local.archive_path
}

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${local.function_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "api_access" {
  name              = "/aws/apigateway/${local.function_name}-access"
  retention_in_days = var.log_retention_days
}

# 外部呼び出し（Bedrock・Google Books）の日次カウンタ。pk は "<kind>#<YYYY-MM-DD>"（JST）。
# 条件付き加算で上限を超えた更新を拒否し、使われない項目は TTL で消す。
resource "aws_dynamodb_table" "usage" {
  name         = "${var.name_prefix}-${var.env}-usage"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"

  # 誤 destroy で日次上限が無効になるのを防ぐ。削除するときは明示的に無効化する。
  deletion_protection_enabled = true

  attribute {
    name = "pk"
    type = "S"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
}

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda" {
  name               = "${local.function_name}-role"
  description        = "Execution role for the hoshirube API Lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

data "aws_iam_policy_document" "lambda" {
  statement {
    sid       = "WriteOwnLogStreams"
    effect    = "Allow"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.lambda.arn}:*"]
  }

  statement {
    sid       = "BedrockConverse"
    effect    = "Allow"
    actions   = ["bedrock:InvokeModel"]
    resources = local.bedrock_invoke_model_resources
  }

  # 日次カウンタは条件付き加算（UpdateItem）だけを許可する。
  statement {
    sid       = "ConsumeDailyUsage"
    effect    = "Allow"
    actions   = ["dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.usage.arn]
  }

  dynamic "statement" {
    for_each = local.google_books_param_arn == null ? [] : [local.google_books_param_arn]

    content {
      sid       = "ReadGoogleBooksApiKey"
      effect    = "Allow"
      actions   = ["ssm:GetParameter"]
      resources = [statement.value]
    }
  }
}

resource "aws_iam_role_policy" "lambda" {
  name   = "${local.function_name}-inline"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda.json
}

resource "aws_lambda_function" "api" {
  function_name = local.function_name
  description   = "ほしるべ API（seed / books / health）"
  role          = aws_iam_role.lambda.arn

  runtime       = "nodejs22.x"
  architectures = ["arm64"]
  handler       = "index.handler"
  timeout       = 28
  memory_size   = 512

  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256

  reserved_concurrent_executions = var.lambda_reserved_concurrency == null ? -1 : var.lambda_reserved_concurrency

  environment {
    variables = merge(
      {
        BEDROCK_REGION           = var.aws_region
        BEDROCK_MODEL_ID         = var.bedrock_model_id
        LOG_LEVEL                = "info"
        USAGE_TABLE_NAME         = aws_dynamodb_table.usage.name
        DAILY_BEDROCK_LIMIT      = tostring(var.daily_bedrock_limit)
        DAILY_GOOGLE_BOOKS_LIMIT = tostring(var.daily_google_books_limit)
      },
      local.google_books_param_name == null ? {} : {
        GOOGLE_BOOKS_API_KEY_PARAM = local.google_books_param_name
      },
    )
  }

  depends_on = [
    aws_cloudwatch_log_group.lambda,
    aws_iam_role_policy.lambda,
  ]
}

resource "aws_apigatewayv2_api" "api" {
  name          = "${local.function_name}-http-api"
  description   = "ほしるべ API の HTTP API"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins     = var.cors_allow_origins
    allow_methods     = ["GET", "POST", "OPTIONS"]
    allow_headers     = ["content-type", "x-discovery-context"]
    allow_credentials = false
    max_age           = 600
  }
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
  # Lambda のタイムアウト（28 秒）より長くし、API Gateway の上限 30 秒未満にする。
  timeout_milliseconds = 29000
}

resource "aws_apigatewayv2_route" "seed" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "POST /v1/discovery/seed"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_route" "books" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "GET /v1/themes/{themeId}/books"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_route" "health" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "GET /health"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = var.throttling_burst_limit
    throttling_rate_limit  = var.throttling_rate_limit
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_access.arn
    format          = local.access_log_format
  }
}

resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowInvokeFromOwnHttpApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  # 当該 HTTP API からの呼び出しだけに限定する（他 API や他アカウントは不可）。
  source_arn = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

# 予算アラート（任意）。budget_alert_email が null のときは何も作らない。
# 実績80%と予測100%でメール通知する。
resource "aws_budgets_budget" "monthly" {
  count = var.budget_alert_email == null ? 0 : 1

  name         = "${local.function_name}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.budget_alert_email]
  }
}
