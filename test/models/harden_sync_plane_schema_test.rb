require "active_record"
require "minitest/autorun"
require_relative "../../db/migrate/20260422000500_harden_sync_plane_schema"

class HardenSyncPlaneSchemaTest < Minitest::Test
  def test_all_indexes_are_created_concurrently
    migration = HardenSyncPlaneSchema.new
    index_calls = []

    migration.define_singleton_method(:add_column) { |*, **| }
    migration.define_singleton_method(:add_check_constraint) { |*, **| }
    migration.define_singleton_method(:add_foreign_key) { |*, **| }
    migration.define_singleton_method(:reversible) { |&| }
    migration.define_singleton_method(:add_index) do |table, columns, **options|
      index_calls << [table, columns, options]
    end

    migration.change

    assert_equal 10, index_calls.size
    assert index_calls.all? { |_, _, options| options[:algorithm] == :concurrently }
  end
end
