class VecSimilarityAudit < SyncRecord
  self.table_name = "v_vec_similarity_audit"
  self.primary_key = "pair_id"

  scope :recent, -> { order(computed_at: :desc) }
  scope :by_pair_kind, ->(pair_kind) { pair_kind.present? ? where(pair_kind:) : all }

  def readonly?
    true
  end
end
