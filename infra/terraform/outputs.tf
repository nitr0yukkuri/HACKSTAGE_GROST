output "api_base_url" {
  description = "API のルート URL（$default ステージ）。末尾スラッシュなし。フロントの NEXT_PUBLIC_API_BASE_URL に設定する。"
  value       = trimsuffix(aws_apigatewayv2_stage.default.invoke_url, "/")
}

output "lambda_function_name" {
  description = "Lambda 関数名。"
  value       = aws_lambda_function.api.function_name
}

output "bedrock_model_id" {
  description = "Lambda が Converse API で使う modelId（設定値の反映確認用）。"
  value       = var.bedrock_model_id
}
