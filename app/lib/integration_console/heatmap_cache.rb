module IntegrationConsole
  module HeatmapCache
    GENERATION_KEY = "heatmap:generation".freeze

    module_function

    def generation
      Rails.cache.fetch(GENERATION_KEY) { 0 }.to_i
    end

    def bump!
      Rails.cache.write(GENERATION_KEY, generation + 1)
    end

    def key(prefix, value)
      "#{prefix}:v#{generation}:#{value}"
    end
  end
end
