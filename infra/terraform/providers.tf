provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "hoshirube"
      ManagedBy = "terraform"
      Env       = var.env
    }
  }
}
