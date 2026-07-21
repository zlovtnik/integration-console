class AuthorizedWirelessNetworksController < ApplicationController
  SORTS = {
    "enabled" => :enabled,
    "location_id" => :location_id,
    "ssid" => :ssid,
    "bssid" => :bssid,
    "label" => :label,
    "updated_at" => :updated_at
  }.freeze

  FILTERS = {
    "enabled" => { column: :enabled, type: :boolean },
    "location_id" => :location_id,
    "ssid" => :ssid,
    "bssid" => :bssid,
    "label" => :label,
    "updated_at" => { column: :updated_at, type: :date }
  }.freeze

  def index
    @wireless_authorized_networks = apply_grid_filters(AuthorizedWirelessNetwork.ordered, FILTERS)
    @wireless_authorized_networks = apply_sort(@wireless_authorized_networks, SORTS, default_sort: :ssid, default_direction: :asc)
    @authorized_wireless_page_payload = authorized_wireless_page_payload(rows: @wireless_authorized_networks, mode: "index")

    respond_to do |format|
      format.html
      format.json { render json: @authorized_wireless_page_payload }
    end
  end

  def new
    @authorized_wireless_network = AuthorizedWirelessNetwork.new(enabled: true)
    @authorized_wireless_page_payload = authorized_wireless_page_payload(rows: [], mode: "form", network: @authorized_wireless_network)
  end

  def create
    @authorized_wireless_network = AuthorizedWirelessNetwork.new(authorized_wireless_network_params)
    if @authorized_wireless_network.valid?
      acknowledgement = dispatch_authorized_network_command("authorized_network.upsert", @authorized_wireless_network)
      @authorized_wireless_network = command_projection!(AuthorizedWirelessNetwork, acknowledgement.core_entity_id)
      respond_to do |format|
        format.html { redirect_to wireless_authorized_networks_path, notice: "Authorized wireless network saved", status: :see_other }
        format.json { render json: { network: authorized_wireless_network_payload(@authorized_wireless_network), redirectUrl: wireless_authorized_networks_path }, status: :created }
      end
    else
      render_authorized_wireless_errors(:new)
    end
  end

  def edit
    @authorized_wireless_network = AuthorizedWirelessNetwork.find(params[:id])
    @authorized_wireless_page_payload = authorized_wireless_page_payload(rows: [], mode: "form", network: @authorized_wireless_network)
  end

  def update
    @authorized_wireless_network = AuthorizedWirelessNetwork.find(params[:id])
    @authorized_wireless_network.assign_attributes(authorized_wireless_network_params)
    if @authorized_wireless_network.valid?
      acknowledgement = dispatch_authorized_network_command("authorized_network.upsert", @authorized_wireless_network)
      @authorized_wireless_network = command_projection!(AuthorizedWirelessNetwork, acknowledgement.core_entity_id.presence || @authorized_wireless_network.id)
      respond_to do |format|
        format.html { redirect_to wireless_authorized_networks_path, notice: "Authorized wireless network updated", status: :see_other }
        format.json { render json: { network: authorized_wireless_network_payload(@authorized_wireless_network), redirectUrl: wireless_authorized_networks_path } }
      end
    else
      render_authorized_wireless_errors(:edit)
    end
  end

  def destroy
    network = AuthorizedWirelessNetwork.find(params[:id])
    dispatch_authorized_network_command("authorized_network.delete", network)
    respond_to do |format|
      format.html { redirect_to wireless_authorized_networks_path, notice: "Authorized wireless network removed", status: :see_other }
      format.json { head :no_content }
    end
  end

  private

  def dispatch_authorized_network_command(command_type, network)
    aggregate_key = network.id&.to_s.presence || new_authorized_network_key(network)
    payload = if command_type == "authorized_network.delete"
      { id: network.id }
    else
      {
        id: network.id,
        ssid: network.ssid,
        bssid: network.bssid,
        location_id: network.location_id,
        label: network.label,
        enabled: network.enabled,
        notes: network.notes
      }.compact
    end

    dispatch_console_command(
      command_type:,
      aggregate_type: "authorized_network",
      aggregate_key:,
      payload:
    )
  end

  def new_authorized_network_key(network)
    identity = [network.location_id, network.ssid, network.bssid].map(&:to_s).join("\0")
    "new:#{Digest::SHA256.hexdigest(identity)}"
  end

  def authorized_wireless_network_params
    params.require(:authorized_wireless_network).permit(:ssid, :bssid, :location_id, :label, :enabled, :notes)
  end

  def render_authorized_wireless_errors(template)
    @authorized_wireless_page_payload = authorized_wireless_page_payload(rows: [], mode: "form", network: @authorized_wireless_network)
    respond_to do |format|
      format.html { render template, status: :unprocessable_entity }
      format.json { render json: { errors: @authorized_wireless_network.errors.full_messages, network: authorized_wireless_network_payload(@authorized_wireless_network) }, status: :unprocessable_entity }
    end
  end

  def authorized_wireless_page_payload(rows:, mode:, network: nil)
    {
      mode: mode,
      rows: rows.map { |row| authorized_wireless_network_payload(row) },
      current: network && authorized_wireless_network_payload(network),
      errors: network&.errors&.full_messages || [],
      sortKey: @sort || "ssid",
      sortDirection: @direction || "asc",
      filters: parsed_grid_filters,
      endpoints: {
        index: wireless_authorized_networks_path,
        create: wireless_authorized_networks_path
      }
    }
  end

  def authorized_wireless_network_payload(network)
    {
      id: network.id,
      enabled: network.enabled,
      location_id: network.location_id,
      ssid: network.ssid,
      bssid: network.bssid,
      label: network.label,
      notes: network.notes,
      match_label: network.match_label,
      updated_at: network.updated_at&.iso8601,
      edit_url: network.persisted? ? edit_wireless_authorized_network_path(network) : nil,
      update_url: network.persisted? ? wireless_authorized_network_path(network) : nil,
      delete_url: network.persisted? ? wireless_authorized_network_path(network) : nil
    }
  end
end
