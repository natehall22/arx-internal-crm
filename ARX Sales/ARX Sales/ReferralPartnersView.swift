import SwiftUI

// MARK: - Referral Partners tab

/// Search first, then the list. "+ Add Partner" opens the three-field form.
struct ReferralPartnersView: View {
    @State private var query = ""
    @State private var scope = "all"
    @State private var partners: [ReferralPartner] = []
    @State private var isLoading = true
    @State private var error: String?
    @State private var showAdd = false
    @State private var openedPartnerId: String?

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 12) {
                    searchField

                    Picker("Scope", selection: $scope) {
                        Text("All").tag("all")
                        Text("Assigned To me").tag("mine")
                        Text("Open").tag("open")
                    }
                    .pickerStyle(.segmented)

                    if let error {
                        Text(error)
                            .font(.subheadline)
                            .foregroundColor(.red)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    if isLoading && partners.isEmpty {
                        ProgressView().padding(.top, 40)
                    } else if partners.isEmpty && error == nil {
                        emptyState
                    }

                    ForEach(partners) { partner in
                        NavigationLink(destination: ReferralPartnerDetailView(partnerId: partner.id)) {
                            PartnerRow(partner: partner)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding()
                // Keep the floating tab bar from covering the last rows.
                .padding(.bottom, 80)
            }
            .navigationTitle("Referral Partners")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button { showAdd = true } label: {
                        Label("Add Partner", systemImage: "plus.circle.fill")
                    }
                }
            }
            .sheet(isPresented: $showAdd) {
                AddPartnerSheet(initialQuery: query) { created in
                    showAdd = false
                    openedPartnerId = created.id
                    Task { await load() }
                }
            }
            .background(
                NavigationLink(
                    destination: Group {
                        if let id = openedPartnerId { ReferralPartnerDetailView(partnerId: id) }
                    },
                    isActive: Binding(get: { openedPartnerId != nil }, set: { if !$0 { openedPartnerId = nil } })
                ) { EmptyView() }
            )
            .refreshable { await load() }
            .task(id: "\(query)|\(scope)") {
                // Debounce typing; a changed id cancels this task.
                if !query.isEmpty { try? await Task.sleep(nanoseconds: 250_000_000) }
                if Task.isCancelled { return }
                await load()
            }
            .onReceive(NotificationCenter.default.publisher(for: .addReferralPartner)) { _ in
                showAdd = true
            }
        }
        .navigationViewStyle(.stack)
    }

    private var searchField: some View {
        HStack {
            Image(systemName: "magnifyingglass").foregroundColor(.secondary)
            TextField("Search name, company or phone", text: $query)
                .textInputAutocapitalization(.never)
                .disableAutocorrection(true)
            if !query.isEmpty {
                Button { query = "" } label: {
                    Image(systemName: "xmark.circle.fill").foregroundColor(.secondary)
                }
            }
        }
        .padding(12)
        .background(Color(.secondarySystemBackground))
        .cornerRadius(10)
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            if query.isEmpty && scope == "all" {
                Text("Add the agents and partners you network with. They're yours, and you get paid on jobs they send.")
                    .font(.subheadline)
                    .multilineTextAlignment(.center)
                    .foregroundColor(.primary)
            } else {
                Text("No match.").font(.subheadline).foregroundColor(.primary)
            }
            Button("+ Add Partner") { showAdd = true }
                .buttonStyle(.borderedProminent)
        }
        .padding(.vertical, 30)
    }

    private func load() async {
        do {
            let result = try await APIClient.referralPartners(query: query, scope: scope)
            partners = result
            error = nil
        } catch is CancellationError {
            return
        } catch {
            self.error = "Could not load partners. Check your connection."
        }
        isLoading = false
    }
}

extension Notification.Name {
    /// Posted by the dashboard card / quick-add so the Partners tab opens its Add form.
    static let addReferralPartner = Notification.Name("addReferralPartner")
}

// MARK: - Row + badge

struct PartnerOwnerBadge: View {
    let partner: ReferralPartner

    private var tint: Color {
        switch partner.status {
        case "company_relationship": return .blue
        case "open": return .orange
        default: return partner.isMine ? .green : .gray
        }
    }

    var body: some View {
        Text(partner.assignedToLabel)
            .font(.caption.weight(.semibold))
            .foregroundColor(.primary)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(tint.opacity(0.22))
            .clipShape(Capsule())
    }
}

private struct PartnerRow: View {
    let partner: ReferralPartner

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(partner.name).font(.headline).foregroundColor(.primary)
                    Text([partner.company, partner.typeLabel].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
                Spacer()
            }
            HStack {
                PartnerOwnerBadge(partner: partner)
                if partner.similar == true {
                    Text("Similar spelling").font(.caption).foregroundColor(.secondary)
                } else if partner.isMine, let opens = partner.opensInLabel {
                    Text(opens).font(.caption).foregroundColor(.secondary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
    }
}

// MARK: - Add partner

struct AddPartnerSheet: View {
    var initialQuery: String = ""
    let onCreated: (ReferralPartner) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var types: [ReferralPartnerType] = []
    @State private var typeId = ""
    @State private var otherText = ""
    @State private var name = ""
    @State private var phone = ""
    @State private var company = ""
    @State private var email = ""
    @State private var notes = ""
    @State private var showMore = false
    @State private var saving = false
    @State private var error: String?
    @State private var existing: ReferralPartner?

    private var isOther: Bool {
        types.first(where: { $0.id == typeId })?.name.lowercased() == "other"
    }
    private var canSave: Bool {
        !typeId.isEmpty && !name.trimmingCharacters(in: .whitespaces).isEmpty
            && phone.filter({ $0.isNumber }).count >= 7 && !saving
    }

    var body: some View {
        NavigationView {
            Form {
                Section {
                    Picker("Type", selection: $typeId) {
                        Text("Choose…").tag("")
                        ForEach(types) { Text($0.name).tag($0.id) }
                    }
                    if isOther {
                        TextField("What kind?", text: $otherText)
                    }
                    TextField("Name", text: $name)
                    TextField("Phone", text: $phone).keyboardType(.phonePad)
                    TextField("Company (optional)", text: $company)
                    if showMore {
                        TextField("Email (optional)", text: $email)
                            .keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never)
                        TextField("Notes (optional)", text: $notes)
                    } else {
                        Button("+ Email, notes") { showMore = true }
                    }
                }

                if let existing {
                    Section {
                        Text("That phone number is already \(existing.name) — \(existing.assignedToLabel).")
                            .foregroundColor(.primary)
                    }
                }
                if let error {
                    Section { Text(error).foregroundColor(.red) }
                }

                Section {
                    Button {
                        Task { await save() }
                    } label: {
                        HStack {
                            Spacer()
                            if saving { ProgressView() } else { Text("Save — Assigned To me").bold() }
                            Spacer()
                        }
                    }
                    .disabled(!canSave)
                }
            }
            .navigationTitle("Add Partner")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
            .task {
                if name.isEmpty, !initialQuery.contains(where: { $0.isNumber }) { name = initialQuery }
                types = (try? await APIClient.referralPartnerTypes()) ?? []
            }
        }
    }

    private func save() async {
        saving = true
        error = nil
        existing = nil
        defer { saving = false }
        do {
            let created = try await APIClient.createReferralPartner(.init(
                type_id: typeId, other_type_text: otherText, name: name, phone: phone,
                company: company, email: email, notes: notes
            ))
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            onCreated(created)
        } catch PartnerAPIError.alreadyExists(let found) {
            existing = found
            error = found == nil ? "That phone number is already in the system." : nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}
