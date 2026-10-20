import SwiftUI

/// Dashboard "My Partners": count, opening soon with one-tap touch buttons, jobs this month.
/// Hides itself if the fetch fails so it can never blank the dashboard.
struct MyPartnersCard: View {
    var refreshToken: Int = 0
    var onOpenPartners: (() -> Void)? = nil

    @State private var summary: ReferralPartnerSummary?
    @State private var failed = false

    var body: some View {
        Group {
            if !failed {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text("MY PARTNERS").font(.caption.weight(.semibold)).foregroundColor(.secondary)
                        Spacer()
                        Button("Open") { onOpenPartners?() }.font(.caption.weight(.semibold))
                    }

                    if let summary {
                        if summary.assigned_count == 0 {
                            Text("Add the agents and partners you network with. They're yours, and you get paid on jobs they send.")
                                .font(.subheadline).foregroundColor(.primary)
                            Button("+ Add a partner") {
                                onOpenPartners?()
                                NotificationCenter.default.post(name: .addReferralPartner, object: nil)
                            }
                            .font(.subheadline.weight(.semibold))
                        } else {
                            HStack(spacing: 8) {
                                stat(summary.assigned_count, "Assigned To me", warn: false)
                                stat(summary.opening_soon_count, "Opening soon", warn: summary.opening_soon_count > 0)
                                stat(summary.jobs_this_month, "Jobs this month", warn: false)
                            }
                            ForEach(summary.opening_soon) { soon in
                                VStack(alignment: .leading, spacing: 6) {
                                    HStack {
                                        Text(soon.name).font(.subheadline.weight(.semibold)).foregroundColor(.primary)
                                        Spacer()
                                        Text(soon.days_until_open == 0 ? "Opens today" : "Opens in \(soon.days_until_open)d")
                                            .font(.caption.weight(.medium)).foregroundColor(.orange)
                                    }
                                    PartnerTouchButtons(partnerId: soon.id, compact: true) {
                                        Task { await load() }
                                    }
                                }
                                .padding(.top, 4)
                            }
                        }
                    } else {
                        ProgressView().frame(maxWidth: .infinity)
                    }
                }
                .padding(14)
                .background(Color(.secondarySystemBackground))
                .cornerRadius(12)
                .padding(.horizontal)
            }
        }
        .task(id: refreshToken) { await load() }
    }

    private func stat(_ value: Int, _ label: String, warn: Bool) -> some View {
        VStack(spacing: 2) {
            Text("\(value)").font(.title3.bold()).foregroundColor(.primary)
            Text(label).font(.caption2).foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background(warn ? Color.orange.opacity(0.2) : Color(.tertiarySystemBackground))
        .cornerRadius(8)
    }

    private func load() async {
        do {
            summary = try await APIClient.referralPartnerSummary()
            failed = false
        } catch is CancellationError {
            return
        } catch {
            if summary == nil { failed = true }
        }
    }
}
