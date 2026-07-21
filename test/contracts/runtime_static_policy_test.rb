require_relative "../contract_test_helper"

class RuntimeStaticPolicyTest < Minitest::Test
  ACTIVE_PATHS = %w[app config bin Dockerfile Gemfile].freeze
  FORBIDDEN = /\b(?:postgres(?:ql)?|pgvector|solid_cache|solid_cable)\b|PG::|ILIKE|::jsonb|DISTINCT ON|pg_try_advisory_lock/i

  def test_active_runtime_has_no_postgresql_or_solid_store_path
    violations = active_files.filter_map do |path|
      next unless File.file?(path)
      next unless (match = File.read(path).match(FORBIDDEN))

      "#{path.delete_prefix("#{CONSOLE_ROOT}/")}: #{match[0]}"
    end

    assert_empty violations, violations.join("\n")
  end

  def test_runtime_migration_path_is_empty_and_history_is_archived
    assert_empty Dir.glob(File.join(CONSOLE_ROOT, "db/migrate/*.rb"))
    refute_empty Dir.glob(File.join(CONSOLE_ROOT, "db/legacy_postgresql_migrate/*.rb"))
    assert File.file?(File.join(CONSOLE_ROOT, "db/legacy_postgresql_schema.rb"))
  end

  def test_runtime_scripts_do_not_invoke_rails_database_tasks
    scripts = Dir.glob(File.join(CONSOLE_ROOT, "bin/*")).select { |path| File.file?(path) }
    invocations = scripts.filter_map do |path|
      source = File.read(path)
      File.basename(path) if source.match?(/bin\/rails\s+db:|rails\s+db:/)
    end

    assert_empty invocations
  end

  def test_core_and_search_models_are_read_only
    writable_models = %w[IntegrationConfig IntegrationRun AuditWindow ConsoleCommand]
    model_sources = Dir.glob(File.join(CONSOLE_ROOT, "app/models/*.rb")).to_h do |path|
      [File.basename(path, ".rb").camelize, File.read(path)]
    end

    writable_models.each do |model|
      assert_match(/class #{model} < ApplicationRecord/, model_sources.fetch(model))
    end

    %w[Device AuthorizedWirelessNetwork Sensor SensorAlert RedpandaTrafficSample FingerprintSource].each do |model|
      assert_match(/class #{model} < SyncRecord/, model_sources.fetch(model))
    end

    refute model_sources.key?("WirelessProbeObservation")
  end

  private

  def active_files
    ACTIVE_PATHS.flat_map do |entry|
      path = File.join(CONSOLE_ROOT, entry)
      File.directory?(path) ? Dir.glob(File.join(path, "**/*")) : [path]
    end.reject { |path| path.include?("/atheros-search-ui/") }
  end
end
