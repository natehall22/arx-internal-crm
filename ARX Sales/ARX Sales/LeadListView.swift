import SwiftUI
import MapKit

// MARK: - My Leads list (sheet from Canvass)

enum LeadListFilter: String, CaseIterable, Identifiable {
    case all
    case hotGoBack
    case scheduled
    case other

    var id: String { rawValue }

    var label: String {
        switch self {
        case .all: return "All"
        case .hotGoBack: return "Hot & Go-backs"
        case .scheduled: return "Scheduled"
        case .other: return "Other"
        }
    }

    func matches(_ lead: MobileLead) -> Bool {
        switch self {
        case .all:
            return true
        case .hotGoBack:
            return lead.canvass_disposition == "hot_lead" || lead.canvass_disposition == "go_back"
        case .scheduled:
            return lead.isScheduled
        case .other:
            if lead.isScheduled { return false }
            if lead.canvass_disposition == "hot_lead" || lead.canvass_disposition == "go_back" { return false }
            return true
        }
    }
}

struct LeadListView: View {
    var onSelectLead: (MobileLead) -> Void

    @AppStorage(AppSettings.Keys.navigationApp) private var navigationAppRaw = NavigationAppSetting.appleMaps.rawValue

    @Environment(\.dismiss) private var dismiss
    @State private var leads: [MobileLead] = []
    @State private var isLoading = true
    @State private var error: String?
    @State private var searchText = ""
    @State private var filter: LeadListFilter = .all
    @State private var hasMore = false

    private var filtered: [MobileLead] {
        let base = leads.filter { filter.matches($0) }
        let q = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return base }
        return base.filter { lead in
            (lead.homeowner_name?.lowercased().contains(q) ?? false)
                || (lead.address_text?.lowercased().contains(q) ?? false)
                || (lead.phone?.contains(q) ?? false)
        }
    }

    var body: some View {
        NavigationView {
            Group {
                if isLoading {
                    ProgressView("Loading leads…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let error, leads.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "wifi.exclamationmark")
                            .font(.system(size: 40))
                            .foregroundColor(.secondary)
                        Text(error).foregroundColor(.secondary)
                        Button("Retry") { Task { await load() } }
                            .buttonStyle(.borderedProminent)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if filtered.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "mappin.slash")
                            .font(.system(size: 40))
                            .foregroundColor(.secondary)
                        Text(leads.isEmpty ? "No leads yet" : "No matches")
                            .foregroundColor(AppSettings.darkText)
                        Text(leads.isEmpty
                             ? "Pins you knock will show up here."
                             : "Try a different search or filter.")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    listContent
                }
            }
            .navigationTitle("My Leads")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .searchable(text: $searchText, placement: .navigationBarDrawer(displayMode: .always), prompt: "Name, address, or phone")
            .safeAreaInset(edge: .top) {
                filterChips
            }
            .refreshable { await load() }
        }
        .task { await load() }
    }

    // MARK: - Filter chips

    private var filterChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(LeadListFilter.allCases) { chip in
                    Button {
                        filter = chip
                    } label: {
                        Text(chip.label)
                            .font(.caption.weight(.semibold))
                            .foregroundColor(filter == chip ? .white : AppSettings.darkText)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 7)
                            .background(
                                Capsule().fill(filter == chip ? AppSettings.brandBlue : Color(.secondarySystemBackground))
                            )
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
        }
        .background(Color(.systemBackground))
    }

    // MARK: - List

    private var listContent: some View {
        List {
            if hasMore {
                Text("Showing first 500 leads")
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .listRowBackground(Color.clear)
            }
            ForEach(filtered) { lead in
                Button {
                    guard lead.hasCoordinate else { return }
                    onSelectLead(lead)
                } label: {
                    LeadListRow(lead: lead)
                }
                .buttonStyle(.plain)
                .disabled(!lead.hasCoordinate)
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    if let phone = lead.phone, !phone.isEmpty {
                        Button {
                            let digits = phone.filter { $0.isNumber }
                            if let url = URL(string: "tel:\(digits)") {
                                UIApplication.shared.open(url)
                            }
                        } label: {
                            Label("Call", systemImage: "phone.fill")
                        }
                        .tint(.green)
                    }
                    if let address = lead.address_text, !address.isEmpty {
                        Button {
                            openDirections(to: address)
                        } label: {
                            Label("Directions", systemImage: "arrow.triangle.turn.up.right.diamond.fill")
                        }
                        .tint(AppSettings.brandBlue)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    // MARK: - Load / helpers

    private func load() async {
        let hadLeads = !leads.isEmpty
        if !hadLeads { isLoading = true }
        error = nil
        do {
            let response = try await APIClient.myLeads()
            leads = response.leads
            hasMore = response.hasMore ?? false
            error = nil
        } catch {
            // Keep showing cached leads on refresh failure; only blank when empty.
            if !hadLeads {
                self.error = error.localizedDescription
            }
        }
        isLoading = false
    }

    private func openDirections(to address: String) {
        let encoded = address.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? address
        let app = NavigationAppSetting(rawValue: navigationAppRaw) ?? .appleMaps
        switch app {
        case .appleMaps:
            if let url = URL(string: "http://maps.apple.com/?daddr=\(encoded)") {
                UIApplication.shared.open(url)
            }
        case .googleMaps:
            let googleURL = URL(string: "comgooglemaps://?daddr=\(encoded)&directionsmode=driving")
            let webFallback = URL(string: "https://maps.google.com/?daddr=\(encoded)")
            if let googleURL, UIApplication.shared.canOpenURL(googleURL) {
                UIApplication.shared.open(googleURL)
            } else if let webFallback {
                UIApplication.shared.open(webFallback)
            }
        }
    }
}

// MARK: - Row

private struct LeadListRow: View {
    let lead: MobileLead

    private var disposition: CanvassDisposition? {
        CanvassDisposition.find(lead.canvass_disposition)
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(lead.displayName)
                    .font(.subheadline.weight(.semibold))
                    .foregroundColor(AppSettings.darkText)

                if let address = lead.address_text, !address.isEmpty,
                   address != lead.homeowner_name {
                    Text(address)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(2)
                }

                HStack(spacing: 8) {
                    if let disp = disposition {
                        Text(disp.label)
                            .font(.caption2.weight(.semibold))
                            .foregroundColor(.white)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(Capsule().fill(Color(hex: disp.color)))
                    } else if lead.isScheduled {
                        Text("Scheduled")
                            .font(.caption2.weight(.semibold))
                            .foregroundColor(.white)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(Capsule().fill(AppSettings.brandBlue))
                    }

                    if let updated = relativeUpdated(lead.updated_at) {
                        Text(updated)
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }

                    if !lead.hasCoordinate {
                        Text("No map pin")
                            .font(.caption2)
                            .foregroundColor(Color(hex: "#B45309"))
                    }
                }
            }

            Spacer(minLength: 0)

            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundColor(.secondary)
                .opacity(lead.hasCoordinate ? 1 : 0.3)
        }
        .padding(.vertical, 4)
    }

    private func relativeUpdated(_ raw: String?) -> String? {
        guard let raw,
              let date = MobileAppointment.parseISO8601(raw) ?? Self.fallbackDate(raw)
        else { return nil }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
    }

    private static func fallbackDate(_ raw: String) -> Date? {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSSSSXXXXX"
        if let d = f.date(from: raw) { return d }
        f.dateFormat = "yyyy-MM-dd'T'HH:mm:ssXXXXX"
        return f.date(from: raw)
    }
}

#Preview {
    LeadListView(onSelectLead: { _ in })
}
