import SwiftUI
import Combine

// MARK: - Opportunity Detail View
// Shown when a closer/inspector opens an opportunity.
// Key sections: status header, inspection outcome, LiDAR measurements, proposals.

struct OpportunityDetailView: View {
    let opportunity: Opportunity

    @StateObject private var vm: OpportunityDetailVM
    @State private var activeScanType: ScanType? = nil
    @Environment(\.dismiss) private var dismiss

    init(opportunity: Opportunity) {
        self.opportunity = opportunity
        _vm = StateObject(wrappedValue: OpportunityDetailVM(opportunityId: opportunity.id))
    }

    var body: some View {
        List {
            // MARK: Header
            Section {
                headerCard
            }

            // MARK: Next Step
            if let next = vm.nextStepLabel {
                Section {
                    HStack(spacing: 12) {
                        Image(systemName: "arrow.right.circle.fill")
                            .foregroundColor(.blue).font(.title3)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Next Step").font(.caption).foregroundColor(.secondary)
                            Text(next).font(.subheadline.weight(.semibold))
                        }
                    }
                    .padding(.vertical, 4)
                }
            }

            // MARK: Inspection
            if let outcome = opportunity.inspectionOutcomeLabel {
                Section("Inspection") {
                    FormValueRow(label: "Outcome", value: outcome)
                    if let notes = opportunity.inspection_notes, !notes.isEmpty {
                        Text(notes).font(.caption).foregroundColor(.secondary)
                    }
                    if let date = opportunity.inspection_date {
                        FormValueRow(label: "Date", value: friendlyDate(date))
                    }
                }
            }

            // MARK: LiDAR Measurements
            Section {
                if vm.isLoadingMeasurements {
                    HStack {
                        ProgressView()
                        Text("Loading measurements…")
                            .font(.subheadline).foregroundColor(.secondary)
                    }
                } else if vm.measurements.isEmpty {
                    Text("No measurements yet")
                        .font(.subheadline).foregroundColor(.secondary)
                } else {
                    ForEach(vm.measurements) { m in
                        MeasurementSummaryRow(measurement: m)
                    }
                }
            } header: {
                Text("Measurements")
            } footer: {
                // Scan action buttons
                HStack(spacing: 12) {
                    Button {
                        activeScanType = .roof
                    } label: {
                        Label("Scan Roof", systemImage: "house.fill")
                            .font(.subheadline.weight(.semibold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .background(Color.blue)
                            .foregroundColor(.white)
                            .cornerRadius(10)
                    }
                    Button {
                        activeScanType = .siding
                    } label: {
                        Label("Scan Siding", systemImage: "square.split.2x1.fill")
                            .font(.subheadline.weight(.semibold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .background(Color.purple)
                            .foregroundColor(.white)
                            .cornerRadius(10)
                    }
                }
                .padding(.top, 12)
            }

            // MARK: Proposals
            Section("Proposals") {
                if vm.isLoadingProposals {
                    HStack {
                        ProgressView()
                        Text("Loading…").font(.subheadline).foregroundColor(.secondary)
                    }
                } else if vm.proposals.isEmpty {
                    Text("No proposals yet")
                        .font(.subheadline).foregroundColor(.secondary)
                } else {
                    ForEach(vm.proposals) { p in
                        ProposalRow(proposal: p)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(opportunity.displayName)
        .navigationBarTitleDisplayMode(.inline)
        .fullScreenCover(item: $activeScanType, onDismiss: {
            activeScanType = nil
        }) { scanType in
            CaptureGuidanceView(
                scanType: scanType,
                address: opportunity.address_text ?? "",
                opportunityId: opportunity.id
            ) { _ in
                activeScanType = nil
                // Reload measurements after a scan is saved
                Task { await vm.loadMeasurements() }
            }
        }
        .task { await vm.loadAll() }
    }

    // MARK: - Header Card

    private var headerCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(opportunity.address_text ?? "No address")
                        .font(.subheadline.weight(.medium))
                    if let closer = opportunity.closerName {
                        Text("Closer: \(closer)")
                            .font(.caption).foregroundColor(.secondary)
                    }
                }
                Spacer()
                StatusBadge(label: opportunity.statusLabel, hex: opportunity.statusColor)
            }

            if let phone = opportunity.lead_phone, !phone.isEmpty {
                HStack(spacing: 6) {
                    Image(systemName: "phone.fill").foregroundColor(.green).font(.caption)
                    Text(phone).font(.caption)
                    Spacer()
                    Button {
                        if let url = URL(string: "tel:\(phone.filter { $0.isNumber })") {
                            UIApplication.shared.open(url)
                        }
                    } label: {
                        Text("Call").font(.caption.weight(.semibold))
                            .padding(.horizontal, 10).padding(.vertical, 4)
                            .background(Color.green.opacity(0.15))
                            .foregroundColor(.green)
                            .cornerRadius(8)
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }

    // MARK: - Helpers

    private func friendlyDate(_ isoString: String) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = f.date(from: isoString) ?? ISO8601DateFormatter().date(from: isoString)
        guard let date else { return isoString }
        let df = DateFormatter()
        df.dateStyle = .medium
        df.timeStyle = .short
        return df.string(from: date)
    }
}

// MARK: - Measurement Summary Row

struct MeasurementSummaryRow: View {
    let measurement: SavedMeasurement
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                let isRoof = measurement.scanTypeLabel == "Roof"
                Label(measurement.scanTypeLabel,
                      systemImage: isRoof ? "house.fill" : "square.split.2x1.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundColor(isRoof ? .blue : .purple)
                Spacer()
                if let dateStr = measurement.created_at,
                   let date = MeasurementListDateParsing.parse(dateStr) {
                    Text(date, style: .date).font(.caption2).foregroundColor(.secondary)
                }
            }
            HStack(spacing: 12) {
                if let sq = measurement.total_squares {
                    Label(String(format: "%.2f sq", sq), systemImage: "square.grid.2x2")
                }
                if let area = measurement.total_area_sqft {
                    Label("\(Int(area)) ft²", systemImage: "ruler")
                }
                if measurement.usedLiDAR {
                    Label("LiDAR", systemImage: "lidar.scanner").foregroundColor(.blue)
                }
            }
            .font(.caption2).foregroundColor(.secondary)
        }
        .padding(.vertical, 2)
    }
}

// MARK: - Proposal Model + Row

struct Proposal: Decodable, Identifiable {
    let id: String
    let proposal_number: String?
    let status: String?
    let title: String?
    let total_price: Double?
    let created_at: String?

    var statusLabel: String { status?.capitalized ?? "Draft" }
    var statusColor: Color {
        switch status {
        case "accepted": return .green
        case "rejected": return .red
        case "sent":     return .blue
        default:         return .secondary
        }
    }
}

struct ProposalRow: View {
    let proposal: Proposal
    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(proposal.title ?? "Proposal \(proposal.proposal_number ?? "")")
                    .font(.subheadline.weight(.medium))
                if let total = proposal.total_price {
                    Text(String(format: "$%.2f", total))
                        .font(.caption).foregroundColor(.secondary)
                }
            }
            Spacer()
            Text(proposal.statusLabel)
                .font(.caption.weight(.semibold))
                .foregroundColor(proposal.statusColor)
        }
        .padding(.vertical, 2)
    }
}

// MARK: - Detail ViewModel

class OpportunityDetailVM: ObservableObject {
    let opportunityId: String

    @Published var measurements: [SavedMeasurement] = []
    @Published var proposals: [Proposal] = []
    @Published var isLoadingMeasurements = false
    @Published var isLoadingProposals = false

    // Simplified next-step logic — mirrors the web app's computed state
    var nextStepLabel: String? {
        nil  // expanded in future iteration
    }

    init(opportunityId: String) {
        self.opportunityId = opportunityId
    }

    @MainActor
    func loadAll() async {
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.loadMeasurements() }
            group.addTask { await self.loadProposals() }
        }
    }

    @MainActor
    func loadMeasurements() async {
        isLoadingMeasurements = true
        // Fetch measurements filtered to this opportunity
        if let all = try? await APIClient.measurementList() {
            // The list endpoint doesn't filter by opportunity yet — filter client-side
            // TODO: add ?opportunity_id= param to the server route when needed
            measurements = all
        }
        isLoadingMeasurements = false
    }

    @MainActor
    func loadProposals() async {
        isLoadingProposals = true
        struct Response: Decodable { let proposals: [Proposal]? }
        if let data = try? await APIClient.request(
            path: "/api/opportunities/\(opportunityId)/proposals"
        ), let decoded = try? JSONDecoder().decode(Response.self, from: data) {
            proposals = decoded.proposals ?? []
        }
        isLoadingProposals = false
    }
}
