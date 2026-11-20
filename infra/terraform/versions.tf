terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
  }

  # state はローカルに置く（MVP ではリモートバックエンドを作らない）。
  # backend ブロックは意図的に記述しない。
}
