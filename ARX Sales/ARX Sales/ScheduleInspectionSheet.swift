import SwiftUI
import UIKit

// MARK: - Schedule Inspection Sheet

/// Presented as a `.sheet` from `LeadSheetView` when disposition is "hot_lead" or "go_back".
/// POSTs to `/api/canvass/lead` with `schedule_inspection: true`.
/// Closer assignment is handled server-side via round-robin — the iOS client never picks an inspector.
struct ScheduleInspectionSheet: View {
    let leadId: String
    let address: String
    let homeownerName: String

    @Environment(\.dismiss) private var dismiss

    // Date picker state — default to next business day at 9 am
    @State private var scheduledDate: Date = Self.nextBusinessDay9am()
    @State private var notes: String = ""
    @State private var isScheduling: Bool = false
    @State private var errorMessage: String? = nil

    var body: some View {
        NavigationView {
            Form {
                // MARK: Summary callout
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        if !homeownerName.isEmpty {
                            Text(homeownerName)
                                .font(.headline)
                        }
                        if !address.isEmpty {
                            Text(address)
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                        }
                    }
                    .padding(.vertical, 4)
                }

                // MARK: Date & time picker
                Section("Inspection Date & Time") {
                    DatePicker(
                        "Date & Time",
                        selection: $scheduledDate,
                        in: Date()...,
                        displayedComponents: [.date, .hourAndMinute]
                    )
                    .labelsHidden()
                    .datePickerStyle(.graphical)
                    .tint(.blue)
                }

                // MARK: Notes
                Section("Notes (optional)") {
                    TextEditor(text: $notes)
                        .frame(minHeight: 72)
                }

                // MARK: Info blurb
                Section {
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "info.circle")
                            .foregroundColor(.blue)
                            .padding(.top, 2)
                        Text("The next available inspector will be assigned automatically.")
                            .font(.footnote)
                            .foregroundColor(.secondary)
                    }
                }

                // MARK: Error
                if let msg = errorMessage {
                    Section {
                        Text(msg)
                            .foregroundColor(.red)
                            .font(.footnote)
                    }
                }
            }
            .navigationTitle("Schedule Inspection")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(isScheduling)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isScheduling {
                        ProgressView()
                    } else {
                        Button {
                            Task { await schedule() }
                        } label: {
                            Text("Schedule")
                                .fontWeight(.semibold)
                        }
                        .disabled(isScheduling)
                    }
                }
            }
        }
    }

    // MARK: - Schedule action

    private func schedule() async {
        isScheduling = true
        errorMessage = nil

        // Format the date as "YYYY-MM-DDTHH:MM" local time — same format the web app expects.
        let localStr = Self.formatLocalDateTime(scheduledDate)

        let payload = ScheduleInspectionRequest(
            lead_id: leadId,
            schedule_inspection: true,
            inspection_scheduled_for: localStr,
            canvass_notes: notes.isEmpty ? nil : notes,
            use_round_robin: true
        )

        do {
            _ = try await APIClient.scheduleInspection(payload)
            // Success — trigger haptic then dismiss
            let generator = UINotificationFeedbackGenerator()
            generator.notificationOccurred(.success)
            dismiss()
        } catch APIError.schedulingConflict(let msg) {
            errorMessage = msg
        } catch APIError.httpError(let code) {
            errorMessage = "Server error (\(code)). Try a different time or contact support."
        } catch APIError.unauthenticated {
            errorMessage = "Not signed in. Please log in and try again."
        } catch {
            errorMessage = error.localizedDescription
        }

        isScheduling = false
    }

    // MARK: - Helpers

    /// Returns the next weekday (Mon–Fri) at 9:00 am local time.
    static func nextBusinessDay9am() -> Date {
        var cal = Calendar.current
        cal.locale = Locale.current
        var comps = cal.dateComponents([.year, .month, .day], from: Date())
        comps.hour = 9
        comps.minute = 0
        comps.second = 0
        guard var candidate = cal.date(from: comps) else { return Date() }
        // Advance past today (always schedule at least tomorrow)
        candidate = cal.date(byAdding: .day, value: 1, to: candidate) ?? candidate
        // Skip weekend
        while true {
            let weekday = cal.component(.weekday, from: candidate) // 1=Sun 7=Sat
            if weekday != 1 && weekday != 7 { break }
            candidate = cal.date(byAdding: .day, value: 1, to: candidate) ?? candidate
        }
        return candidate
    }

    /// Produces a string like "2026-05-20T09:00" in the device's local timezone.
    static func formatLocalDateTime(_ date: Date) -> String {
        let fmt = DateFormatter()
        fmt.locale = Locale(identifier: "en_US_POSIX")
        fmt.dateFormat = "yyyy-MM-dd'T'HH:mm"
        return fmt.string(from: date)
    }
}
