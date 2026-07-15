import SwiftUI
import Combine

// MARK: - Opportunities Tab
// List of opportunities assigned to the current user (closer/inspector flow).
// Tapping opens OpportunityDetailView for measurements, proposals, and inspection info.

struct OpportunitiesView: View {
    @StateObject private var vm = OpportunitiesVM()
    @State private var searchText = ""
    @State private var statusFilter: StatusFilter = .active
    @AppStorage(AppSettings.Keys.navigationApp) private var navigationAppRaw = NavigationAppSetting.appleMaps.rawValue

    /// "Active" is the working default — a closer's daily list shouldn't start
    /// buried under every won/lost record from the past year.
    enum StatusFilter: String, CaseIterable, Identifiable {
        case active = "Active"
        case won = "Won"
        case lost = "Lost"
        case all = "All"
        var id: String { rawValue }

        func matches(_ status: String?) -> Bool {
            switch self {
            case .all: return true
            case .won: return status == "won"
            case .lost: return status == "lost"
            case .active: return status != "won" && status != "lost"
            }
        }
    }

    private var filteredOpportunities: [Opportunity] {
        vm.opportunities.filter { opp in
            guard statusFilter.matches(opp.status) else { return false }
            guard !searchText.isEmpty else { return true }
            let q = searchText.lowercased()
            return opp.displayName.lowercased().contains(q)
                || (opp.address_text ?? "").lowercased().contains(q)
                || (opp.lead_phone ?? "").contains(q)
        }
    }

    var body: some View {
        NavigationView {
            Group {
                if vm.isLoading && vm.opportunities.isEmpty {
                    loadingState
                } else if vm.opportunities.isEmpty {
                    emptyState
                } else {
                    opportunityList
                }
            }
            .navigationTitle("Opportunities")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { Task { await vm.load() } } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                }
            }
            .alert("Error", isPresented: Binding(
                get: { vm.error != nil },
                set: { if !$0 { vm.error = nil } }
            )) {
                Button("OK", role: .cancel) { vm.error = nil }
            } message: {
                Text(vm.error ?? "")
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                Color.clear.frame(height: AppSettings.floatingTabContentInset)
            }
        }
        .task { await vm.load() }
    }

    // MARK: - List

    private var opportunityList: some View {
        List {
            Section {
                Picker("Status", selection: $statusFilter) {
                    ForEach(StatusFilter.allCases) { f in
                        Text(f.rawValue).tag(f)
                    }
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }

            Section {
                if filteredOpportunities.isEmpty {
                    Text(searchText.isEmpty ? "Nothing matching this filter" : "No matches for “\(searchText)”")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                } else {
                    ForEach(filteredOpportunities) { opp in
                        NavigationLink(destination: OpportunityDetailView(opportunity: opp)) {
                            OpportunityRow(opportunity: opp)
                        }
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            if let phone = opp.lead_phone, !phone.isEmpty {
                                Button {
                                    if let url = URL(string: "tel:\(phone.filter { $0.isNumber })") {
                                        UIApplication.shared.open(url)
                                    }
                                } label: {
                                    Label("Call", systemImage: "phone.fill")
                                }
                                .tint(.green)
                            }
                            if let address = opp.address_text, !address.isEmpty {
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
            }
        }
        .listStyle(.insetGrouped)
        .searchable(text: $searchText, placement: .navigationBarDrawer(displayMode: .always), prompt: "Name, address, or phone")
        .refreshable { await vm.load() }
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

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: 20) {
            Spacer()
            Image(systemName: "briefcase")
                .font(.system(size: 52))
                .foregroundColor(.blue)
            Text("No Opportunities")
                .font(.title2.weight(.bold))
            Text("Opportunities assigned to you will appear here.")
                .font(.subheadline).foregroundColor(.secondary)
                .multilineTextAlignment(.center).padding(.horizontal, 40)
            Button("Refresh") { Task { await vm.load() } }
                .buttonStyle(.borderedProminent)
            Spacer()
        }
    }

    private var loadingState: some View {
        VStack(spacing: 16) {
            ProgressView()
            Text("Loading opportunities…")
                .font(.subheadline).foregroundColor(.secondary)
        }
    }
}

// MARK: - Opportunity Row

struct OpportunityRow: View {
    let opportunity: Opportunity

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(opportunity.displayName)
                    .font(.subheadline.weight(.semibold))
                Spacer()
                StatusBadge(label: opportunity.statusLabel, hex: opportunity.statusColor)
            }

            Text(opportunity.address_text ?? "No address")
                .font(.caption).foregroundColor(.secondary)

            HStack(spacing: 12) {
                if let closer = opportunity.closerName {
                    Label(closer, systemImage: "person.fill")
                        .font(.caption2).foregroundColor(.secondary)
                }
                if let outcome = opportunity.inspectionOutcomeLabel {
                    Label(outcome, systemImage: "checkmark.circle")
                        .font(.caption2)
                        .foregroundColor(opportunity.inspection_outcome == "completed" ? .green : .orange)
                }
                if let pt = opportunity.project_type {
                    Label(pt.capitalized, systemImage: "house")
                        .font(.caption2).foregroundColor(.secondary)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Status Badge

struct StatusBadge: View {
    let label: String
    let hex: String
    var body: some View {
        Text(label)
            .font(.caption2.weight(.semibold))
            .foregroundColor(.white)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(Color(UIColor(hex: hex)))
            .cornerRadius(8)
    }
}

// MARK: - ViewModel

class OpportunitiesVM: ObservableObject {
    @Published var opportunities: [Opportunity] = []
    @Published var isLoading = false
    @Published var error: String? = nil

    @MainActor
    func load() async {
        isLoading = true
        error = nil
        do {
            opportunities = try await APIClient.fetchOpportunities()
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}
