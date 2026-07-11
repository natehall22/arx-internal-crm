import SwiftUI
import Combine

// MARK: - Opportunities Tab
// List of opportunities assigned to the current user (closer/inspector flow).
// Tapping opens OpportunityDetailView for measurements, proposals, and inspection info.

struct OpportunitiesView: View {
    @StateObject private var vm = OpportunitiesVM()

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
            ForEach(vm.opportunities) { opp in
                NavigationLink(destination: OpportunityDetailView(opportunity: opp)) {
                    OpportunityRow(opportunity: opp)
                }
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await vm.load() }
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
