require "socket"

module VectorEmbeddings
  Config = Struct.new(
    :enabled,
    :provider,
    :url,
    :model,
    :dimensions,
    :batch_size,
    :worker_name,
    keyword_init: true
  ) do
    def self.from_env(env = ENV)
      new(
        enabled: env.fetch("VECTOR_EMBEDDINGS_ENABLED", "false").casecmp("true").zero?,
        provider: env.fetch("VECTOR_EMBEDDING_PROVIDER", "ollama"),
        url: env.fetch("VECTOR_EMBEDDING_URL", "http://127.0.0.1:11434"),
        model: env.fetch("VECTOR_EMBEDDING_MODEL", "nomic-embed-text-v2-moe"),
        dimensions: Integer(env.fetch("VECTOR_EMBEDDING_DIMENSIONS", "768")),
        batch_size: Integer(env.fetch("VECTOR_EMBEDDING_BATCH_SIZE", "25")),
        worker_name: env.fetch("VECTOR_EMBEDDING_WORKER_NAME", Socket.gethostname)
      )
    end
  end
end
