module Observability
  class WorkerRunner
    def self.run_forever
      Redpanda::WirelessWorker.new.run_forever
    end
  end
end
