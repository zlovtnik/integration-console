class ConsoleCommandAcknowledgement < ApplicationRecord
  self.primary_key = "acknowledgement_id"

  belongs_to :command,
    class_name: "ConsoleCommand",
    foreign_key: :command_id,
    inverse_of: :acknowledgement

  def readonly?
    true
  end

  def delete
    raise_readonly_record!
  end

  before_destroy :raise_readonly_record!

  class << self
    %i[delete delete_all update_all insert insert! insert_all insert_all! upsert_all].each do |method_name|
      define_method(method_name) do |*_args, **_kwargs, &_block|
        raise ActiveRecord::ReadOnlyRecord, "#{name} is written by Octopus"
      end
    end
  end

  private

  def raise_readonly_record!
    raise ActiveRecord::ReadOnlyRecord, "#{self.class.name} is written by Octopus"
  end
end
