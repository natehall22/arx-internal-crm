import SwiftUI

/// "Referred By" on an opportunity, next to Closer. Everyone sees it; only roles that
/// control payroll attribution (server `referred_by_edit`) get the change button.
struct ReferredByRow: View {
    let opportunityId: String
    let partnerId: String?

    @State private var current: ReferralPartner?
    @State private var currentId: String?
    @State private var canEdit = false
    @State private var showPicker = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: "person.2.fill").font(.caption).foregroundColor(.secondary)
                Text("Referred By:").font(.caption).foregroundColor(.secondary)
                if currentId != nil {
                    Text(current.map { "\($0.name) · \($0.assignedToLabel)" } ?? "…")
                        .font(.caption.weight(.semibold)).foregroundColor(.primary)
                } else {
                    Text("None").font(.caption).foregroundColor(.primary)
                }
                Spacer()
                if canEdit {
                    Button(currentId == nil ? "+ Add" : "Change") { showPicker = true }
                        .font(.caption.weight(.semibold))
                }
            }
            if let error {
                Text(error).font(.caption).foregroundColor(.red)
            }
        }
        .task {
            currentId = partnerId
            canEdit = (try? await APIClient.mobileCapabilities().referredByEdit) ?? false
            await loadCurrent()
        }
        .sheet(isPresented: $showPicker) {
            PartnerPickerSheet(allowClear: currentId != nil) { picked in
                showPicker = false
                Task { await save(picked) }
            }
        }
    }

    private func loadCurrent() async {
        guard let id = currentId else { current = nil; return }
        current = (try? await APIClient.referralPartnerDetail(id: id))?.partner
    }

    private func save(_ picked: ReferralPartner?) async {
        error = nil
        do {
            try await APIClient.setReferredBy(opportunityId: opportunityId, partnerId: picked?.id)
            currentId = picked?.id
            current = picked
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// Search a partner and pick it. `nil` result clears Referred By.
struct PartnerPickerSheet: View {
    let allowClear: Bool
    let onPick: (ReferralPartner?) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var partners: [ReferralPartner] = []
    @State private var loading = true

    var body: some View {
        NavigationView {
            List {
                if allowClear {
                    Button("Clear Referred By", role: .destructive) { onPick(nil) }
                }
                if loading && partners.isEmpty {
                    ProgressView()
                } else if partners.isEmpty {
                    Text("No match.").foregroundColor(.secondary)
                }
                ForEach(partners) { partner in
                    Button { onPick(partner) } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(partner.name).font(.headline).foregroundColor(.primary)
                            Text([partner.company, partner.typeLabel, partner.assignedToLabel]
                                .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                                .font(.caption).foregroundColor(.secondary)
                        }
                    }
                }
            }
            .navigationTitle("Referred By")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .safeAreaInset(edge: .top) {
                TextField("Search name, company or phone", text: $query)
                    .textFieldStyle(.roundedBorder)
                    .padding(.horizontal)
                    .padding(.vertical, 8)
                    .background(Color(.systemBackground))
            }
            .task(id: query) {
                if !query.isEmpty { try? await Task.sleep(nanoseconds: 250_000_000) }
                if Task.isCancelled { return }
                partners = (try? await APIClient.referralPartners(query: query, scope: "all")) ?? partners
                loading = false
            }
        }
    }
}
