import SwiftUI

// MARK: - One-tap touch buttons (shared by detail + dashboard card)

struct PartnerTouchButtons: View {
    let partnerId: String
    var compact = false
    var onLogged: (() -> Void)? = nil

    @State private var busy: PartnerTouchKind?
    @State private var done: String?
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                ForEach(PartnerTouchKind.allCases) { kind in
                    Button {
                        Task { await log(kind) }
                    } label: {
                        Group {
                            if busy == kind { ProgressView() } else { Text(kind.label) }
                        }
                        .font(compact ? .caption.weight(.semibold) : .subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, compact ? 8 : 12)
                        .foregroundColor(.primary)
                        .background(Color(.tertiarySystemBackground))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.gray.opacity(0.4)))
                        .cornerRadius(10)
                    }
                    .buttonStyle(.plain)
                    .disabled(busy != nil)
                }
            }
            if let done, error == nil {
                Text("Logged: \(done)").font(.caption).foregroundColor(.green)
            }
            if let error {
                Text(error).font(.caption).foregroundColor(.red)
            }
        }
    }

    private func log(_ kind: PartnerTouchKind) async {
        busy = kind
        error = nil
        defer { busy = nil }
        do {
            try await APIClient.logPartnerTouch(id: partnerId, kind: kind)
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            done = kind.label
            onLogged?()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// MARK: - Detail

struct ReferralPartnerDetailView: View {
    let partnerId: String

    @State private var detail: ReferralPartnerDetail?
    @State private var error: String?

    private static let money: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.maximumFractionDigits = 0
        return f
    }()

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                if let detail {
                    content(detail)
                } else if let error {
                    Text(error).foregroundColor(.red).padding(.top, 40)
                } else {
                    ProgressView().padding(.top, 60)
                }
            }
            .padding()
            .padding(.bottom, 80)
        }
        .navigationTitle(detail?.partner.name ?? "Partner")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
    }

    @ViewBuilder
    private func content(_ detail: ReferralPartnerDetail) -> some View {
        let p = detail.partner

        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(p.name).font(.title3.bold()).foregroundColor(.primary)
                    Text([p.company, p.typeLabel].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(.subheadline).foregroundColor(.secondary)
                }
                Spacer()
                PartnerOwnerBadge(partner: p)
            }
            if let phone = p.phone, !phone.isEmpty {
                Button {
                    if let url = URL(string: "tel:\(phone.filter { $0.isNumber })") { UIApplication.shared.open(url) }
                } label: {
                    Label(phone, systemImage: "phone.fill").font(.subheadline.weight(.semibold))
                }
            }
            if let email = p.email, !email.isEmpty {
                Label(email, systemImage: "envelope.fill").font(.subheadline).foregroundColor(.primary)
            }
            if let notes = p.notes, !notes.isEmpty {
                Text(notes).font(.subheadline).foregroundColor(.primary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)

        if detail.can_work && p.status == "assigned" {
            VStack(alignment: .leading, spacing: 8) {
                Text("Log a touch").font(.subheadline.weight(.semibold)).foregroundColor(.primary)
                PartnerTouchButtons(partnerId: p.id) { Task { await load() } }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(Color(.secondarySystemBackground))
            .cornerRadius(12)
        }

        if p.status == "open" {
            Text("This partner is open. Ask an admin to assign it.")
                .font(.subheadline).foregroundColor(.primary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
                .background(Color.orange.opacity(0.18))
                .cornerRadius(12)
        }

        HStack(spacing: 8) {
            fact(p.status == "company_relationship" ? "Never" : (p.opensInLabel?.replacingOccurrences(of: "Opens ", with: "") ?? "—"), "Opens up")
            fact("\(detail.jobs_sold) · \(Self.money.string(from: NSNumber(value: detail.revenue_sold)) ?? "$0")", "Jobs sold")
            fact("\(detail.referred_count)", "Referred")
        }

        if detail.can_work {
            VStack(alignment: .leading, spacing: 6) {
                Text("Touch history").font(.subheadline.weight(.semibold)).foregroundColor(.primary)
                if detail.touches.isEmpty {
                    Text("No touches logged yet.").font(.subheadline).foregroundColor(.secondary)
                }
                ForEach(detail.touches) { touch in
                    Text("\(touch.body) · \(touch.user?.full_name ?? "Someone") · \(Self.dateLabel(touch.created_at))")
                        .font(.footnote).foregroundColor(.primary)
                    Divider()
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(Color(.secondarySystemBackground))
            .cornerRadius(12)
        }
    }

    private func fact(_ value: String, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.footnote.bold()).foregroundColor(.primary).multilineTextAlignment(.center)
            Text(label).font(.caption2).foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(Color(.secondarySystemBackground))
        .cornerRadius(10)
    }

    private static func dateLabel(_ iso: String) -> String {
        guard let date = MobileAppointment.parseISO8601(iso) else { return "" }
        return date.formatted(date: .abbreviated, time: .omitted)
    }

    private func load() async {
        do {
            detail = try await APIClient.referralPartnerDetail(id: partnerId)
            error = nil
        } catch is CancellationError {
            return
        } catch {
            if detail == nil { self.error = "Could not load this partner. Check your connection." }
        }
    }
}
