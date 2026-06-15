source "https://rubygems.org"

ruby "3.4.4"

gem "rails", "~> 7.2"
gem "pg", "~> 1.5"
gem "puma", "~> 6.4"
gem "redis", "~> 5.2"
gem "csv"
gem "aws-sdk-s3", "~> 1.170", require: false
gem "opentelemetry-sdk", "~> 1.6"
gem "opentelemetry-exporter-otlp", "~> 0.29"
gem "opentelemetry-instrumentation-active_record", "~> 0.11"
gem "opentelemetry-instrumentation-pg", "~> 0.30"
gem "opentelemetry-instrumentation-rack", "~> 0.26"
gem "opentelemetry-instrumentation-rails", "~> 0.35"
gem "opentelemetry-instrumentation-redis", "~> 0.26"
gem "rdkafka", "~> 0.27"
gem "turbo-rails", "~> 2.0"
gem "vite_rails", "~> 3.0"
gem "minitest", "~> 5.25"
gem "tzinfo-data", platforms: %i[ mingw mswin x64_mingw jruby ]

group :development, :test do
  gem "axe-core-capybara", "~> 4.11"
  gem "capybara", "~> 3.40"
  gem "debug", platforms: %i[ mri mingw x64_mingw ]
  gem "selenium-webdriver", "~> 4.31"
end
