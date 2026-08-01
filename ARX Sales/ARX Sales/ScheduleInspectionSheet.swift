import SwiftUI
import UIKit
import CoreLocation

// MARK: - Schedule target

enum ScheduleInspectionTarget {
    /// Pin already on the server — schedule with disposition/contact updates; omit lat/lng.
    case existingLead(id: String, save: SaveLeadRequest)
    /// New knock or queued pending pin — create (or dedupe) + schedule in one POST.
    case createOnSchedule(SaveLeadRequest)
}

private struct ScheduleDateOption: Identifiable, Hashable {
    let id: String
    let label: String
}

// MARK: - Schedule Inspection Sheet

/// Presented as a `.sheet` from `LeadSheetView` when contact info is complete (not for renters).
/// POSTs to `/api/canvass/lead` with `schedule_inspection: true` and `closer_user_id: team:{id}`.
struct ScheduleInspectionSheet: View {
    let target: ScheduleInspectionTarget
    let address: String
    let homeownerName: String
    /// Fresh rep GPS at schedule time (same as knock save on web).
    var repGeoCapture: (() async -> CLLocation?)? = nil
    var onSuccess: (() -> Void)? = nil

    @Environment(\.dismiss) private var dismiss

    @State private var notes: String = ""
    @State private var isScheduling: Bool = false
    @State private var errorMessage: String? = nil
    @StateObject private var networkMonitor = NetworkPathMonitor()

    // Round-robin scheduling (matches web LeadModal team + slot picker)
    @State private var teams: [CanvassSchedulingTeam] = []
    @State private var selectedTeamId: String = ""
    @State private var inspectionDurationMinutes: Int = 60
    @State private var metaLoading = true
    @State private var metaError: String?

    @State private var dateOptions: [ScheduleDateOption] = []
    @State private var selectedDateYmd: String = ""
    @State private var timeSlots: [CanvassAvailabilitySlot] = []
    @State private var selectedSlotTime: String = ""
    @State private var slotsLoading = false
    @State private var slotsError: String?
    @State private var slotTimezoneLabel: String = "Eastern"
    /// From `/api/canvass/team-availability` — false when no queue member has Google Calendar connected.
    @State private var teamHasConnectedCalendars: Bool?

    /// Manual fallback when teams cannot be loaded (still round-robin on server).
    @State private var useManualDatePicker = false
    @State private var manualScheduledDate: Date = Self.nextBusinessDay9am()

    @State private var showScheduledConfirmation = false
    @State private var scheduledConfirmationTitle = "Inspection scheduled"
    @State private var scheduledConfirmationMessage = ""

    private var missingCoordinates: Bool {
        switch target {
        case .existingLead:
            return false
        case .createOnSchedule(let save):
            return save.lat == nil || save.lng == nil
        }
    }

    private var usesSlotPicker: Bool {
        !useManualDatePicker && !teams.isEmpty && !selectedTeamId.isEmpty
    }

    private var canConfirmSchedule: Bool {
        if networkMonitor.isOffline || missingCoordinates || isScheduling { return false }
        if usesSlotPicker {
            return !selectedSlotTime.isEmpty
        }
        return true
    }

    var body: some View {
        NavigationView {
            Form {
                if networkMonitor.isOffline {
                    Section {
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: "wifi.slash")
                                .foregroundColor(Color(hex: "#B45309"))
                            Text("You're offline — scheduling an inspection needs a connection.")
                                .font(.subheadline)
                                .foregroundColor(.primary)
                        }
                    }
                }

                if missingCoordinates {
                    Section {
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: "mappin.slash")
                                .foregroundColor(Color(hex: "#B45309"))
                            Text("This knock is missing map coordinates. Close and save the pin on the map first.")
                                .font(.subheadline)
                                .foregroundColor(.primary)
                        }
                    }
                }

                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        if !homeownerName.isEmpty {
                            Text(homeownerName)
                                .font(.headline)
                                .foregroundColor(.primary)
                        }
                        if !address.isEmpty {
                            Text(address)
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                        }
                    }
                    .padding(.vertical, 4)
                }

                Section {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "person.3.fill")
                            .foregroundColor(.blue)
                            .padding(.top, 2)
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Team round-robin")
                                .font(.subheadline.weight(.semibold))
                                .foregroundColor(.primary)
                            Text("Pick a time when someone on the closer queue is free. The system assigns the next closer automatically — same as the canvass web app.")
                                .font(.footnote)
                                .foregroundColor(.secondary)
                        }
                    }
                }

                if metaLoading {
                    Section {
                        HStack {
                            ProgressView()
                            Text("Loading teams…")
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                        }
                    }
                } else if let metaError {
                    Section {
                        Text(metaError)
                            .font(.footnote)
                            .foregroundColor(Color(hex: "#B45309"))
                        Text("You can still pick a date and time below; the server will assign a closer via round-robin.")
                            .font(.footnote)
                            .foregroundColor(.secondary)
                    }
                }

                if usesSlotPicker {
                    Section("Assign to") {
                        if teams.count == 1, let team = teams.first {
                            Text("\(team.name) (auto-assign)")
                                .foregroundColor(.primary)
                        } else {
                            Picker("Team", selection: $selectedTeamId) {
                                Text("Select team…").tag("")
                                ForEach(teams) { team in
                                    Text("\(team.name) (auto-assign)").tag(team.id)
                                }
                            }
                            .pickerStyle(.menu)
                        }
                    }

                    if !selectedTeamId.isEmpty {
                        Section("Date") {
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 8) {
                                    ForEach(dateOptions) { option in
                                        Button {
                                            selectDate(option.id)
                                        } label: {
                                            Text(option.label)
                                                .font(.subheadline.weight(.medium))
                                                .padding(.horizontal, 12)
                                                .padding(.vertical, 8)
                                                .background(
                                                    selectedDateYmd == option.id
                                                        ? Color.blue.opacity(0.15)
                                                        : Color(hex: "#F5F5F4")
                                                )
                                                .foregroundColor(
                                                    selectedDateYmd == option.id
                                                        ? Color.blue
                                                        : AppSettings.darkText
                                                )
                                                .cornerRadius(8)
                                                .overlay(
                                                    RoundedRectangle(cornerRadius: 8)
                                                        .stroke(
                                                            selectedDateYmd == option.id ? Color.blue : Color(hex: "#E7E5E4"),
                                                            lineWidth: 1
                                                        )
                                                )
                                        }
                                        .buttonStyle(.plain)
                                    }
                                }
                                .padding(.vertical, 4)
                            }
                        }

                        if !selectedDateYmd.isEmpty {
                            Section {
                                HStack {
                                    Text("Time (\(slotTimezoneLabel))")
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundColor(.primary)
                                    Spacer()
                                    if !slotsLoading {
                                        Button("Refresh") {
                                            Task { await loadSlots(isRetry: false) }
                                        }
                                        .font(.subheadline)
                                    }
                                }
                            }

                            Section {
                                if slotsLoading {
                                    HStack {
                                        ProgressView()
                                        Text("Loading available times…")
                                            .font(.subheadline)
                                            .foregroundColor(.secondary)
                                    }
                                } else if let slotsError {
                                    Text(slotsError)
                                        .font(.footnote)
                                        .foregroundColor(Color(hex: "#B45309"))
                                    Button("Tap to retry") {
                                        Task { await loadSlots(isRetry: false) }
                                    }
                                    .font(.subheadline)
                                } else if timeSlots.isEmpty {
                                    if teamHasConnectedCalendars == false {
                                        Text("This team isn't ready to show open times — no closers in the queue have a connected Google Calendar. Contact ops to connect calendars, or ask them to schedule manually in the CRM.")
                                            .font(.footnote)
                                            .foregroundColor(Color(hex: "#B45309"))
                                    } else {
                                        Text("No open slots on this day. Try another date or tap Refresh.")
                                            .font(.footnote)
                                            .foregroundColor(.secondary)
                                    }
                                } else {
                                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 88), spacing: 8)], spacing: 8) {
                                        ForEach(timeSlots) { slot in
                                            Button {
                                                guard slot.available else { return }
                                                selectedSlotTime = slot.time
                                            } label: {
                                                VStack(spacing: 2) {
                                                    Text(slot.display)
                                                        .font(.subheadline.weight(.medium))
                                                    if let count = slot.availableClosers, count > 0 {
                                                        Text("\(count) free")
                                                            .font(.caption2)
                                                            .foregroundColor(Color(hex: "#57534E"))
                                                    }
                                                }
                                                .frame(maxWidth: .infinity)
                                                .padding(.vertical, 8)
                                                .background(
                                                    selectedSlotTime == slot.time
                                                        ? Color.blue
                                                        : slot.available
                                                            ? Color.white
                                                            : Color(hex: "#F5F5F4")
                                                )
                                                .foregroundColor(
                                                    selectedSlotTime == slot.time
                                                        ? Color.white
                                                        : slot.available
                                                            ? AppSettings.darkText
                                                            : Color(hex: "#A8A29E")
                                                )
                                                .cornerRadius(8)
                                                .overlay(
                                                    RoundedRectangle(cornerRadius: 8)
                                                        .stroke(Color(hex: "#E7E5E4"), lineWidth: 1)
                                                )
                                            }
                                            .buttonStyle(.plain)
                                            .disabled(!slot.available)
                                        }
                                    }
                                    .padding(.vertical, 4)
                                }
                            }

                            if !selectedSlotTime.isEmpty {
                                Section {
                                    HStack(spacing: 8) {
                                        Image(systemName: "checkmark.circle.fill")
                                            .foregroundColor(Color(hex: "#16A34A"))
                                        Text("Time selected — tap Schedule to confirm round-robin assignment.")
                                            .font(.footnote)
                                            .foregroundColor(.secondary)
                                    }
                                }
                            }
                        }
                    }
                } else if !metaLoading {
                    Section("Inspection date & time") {
                        DatePicker(
                            "Date & Time",
                            selection: $manualScheduledDate,
                            in: Date()...,
                            displayedComponents: [.date, .hourAndMinute]
                        )
                        .labelsHidden()
                        .datePickerStyle(.graphical)
                        .tint(.blue)
                        Text("Round-robin will assign the next available closer for this time.")
                            .font(.footnote)
                            .foregroundColor(.secondary)
                    }
                }

                Section("Notes (optional)") {
                    TextEditor(text: $notes)
                        .frame(minHeight: 72)
                }

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
                        .disabled(!canConfirmSchedule)
                    }
                }
            }
        }
        .onAppear {
            networkMonitor.start()
            dateOptions = Self.buildDateOptions()
        }
        .onDisappear { networkMonitor.stop() }
        .task { await loadSchedulingMeta() }
        .onChange(of: selectedTeamId) { newTeam in
            guard usesSlotPicker, !newTeam.isEmpty else { return }
            selectedDateYmd = ""
            selectedSlotTime = ""
            timeSlots = []
            slotsError = nil
            teamHasConnectedCalendars = nil
        }
        .alert(scheduledConfirmationTitle, isPresented: $showScheduledConfirmation) {
            Button("OK") {
                onSuccess?()
                dismiss()
            }
        } message: {
            Text(scheduledConfirmationMessage)
        }
    }

    // MARK: - Meta & slots

    private func loadSchedulingMeta() async {
        metaLoading = true
        metaError = nil
        defer { metaLoading = false }

        do {
            let meta = try await APIClient.fetchCanvassSchedulingMeta()
            teams = meta.teams
            inspectionDurationMinutes = max(15, meta.inspection_duration)
            if let userTeam = meta.user_team_id, meta.teams.contains(where: { $0.id == userTeam }) {
                selectedTeamId = userTeam
            } else if let first = meta.teams.first {
                selectedTeamId = first.id
            } else {
                useManualDatePicker = true
            }
        } catch {
            metaError = "Couldn't load closer teams."
            useManualDatePicker = true
        }
    }

    private func selectDate(_ ymd: String) {
        selectedDateYmd = ymd
        selectedSlotTime = ""
        timeSlots = []
        slotsError = nil
        teamHasConnectedCalendars = nil
        Task { await loadSlots(isRetry: false) }
    }

    private func loadSlots(isRetry: Bool) async {
        guard !selectedTeamId.isEmpty, !selectedDateYmd.isEmpty else { return }
        guard !networkMonitor.isOffline else {
            slotsError = "You're offline — connect to load open times."
            return
        }

        slotsLoading = true
        slotsError = nil
        defer { slotsLoading = false }

        do {
            let response = try await APIClient.fetchTeamAvailability(
                teamId: selectedTeamId,
                dateYmd: selectedDateYmd,
                durationMinutes: inspectionDurationMinutes
            )
            timeSlots = response.slots
            teamHasConnectedCalendars = response.hasCalendar
            if let tz = response.timezone {
                slotTimezoneLabel = tz
                    .replacingOccurrences(of: "America/", with: "")
                    .replacingOccurrences(of: "_", with: " ")
            }
            if timeSlots.isEmpty, !isRetry, response.hasCalendar != false {
                try? await Task.sleep(nanoseconds: 800_000_000)
                await loadSlots(isRetry: true)
            }
        } catch {
            slotsError = "Couldn't load times. Tap Refresh to try again."
            timeSlots = []
        }
    }

    // MARK: - Schedule action

    private func schedule() async {
        isScheduling = true
        errorMessage = nil

        let localStr: String
        if usesSlotPicker, !selectedSlotTime.isEmpty {
            localStr = selectedSlotTime
        } else {
            localStr = Self.formatLocalDateTime(manualScheduledDate)
        }
        let scheduleNotes = notes.isEmpty ? nil : notes
        let roundRobinTeamId: String? = usesSlotPicker && !selectedTeamId.isEmpty ? selectedTeamId : nil

        let payload: CanvassLeadScheduleRequest
        var usedCreateAndSchedule = false
        var createScheduleKnockSave: SaveLeadRequest?
        switch target {
        case .existingLead(let id, var save):
            if let loc = await repGeoCapture?() {
                save.rep_lat = loc.coordinate.latitude
                save.rep_lng = loc.coordinate.longitude
                if loc.horizontalAccuracy >= 0 {
                    save.rep_geo_accuracy = loc.horizontalAccuracy
                }
                save.rep_geo_captured_at = Self.repGeoISO8601.string(from: loc.timestamp)
            }
            payload = .forExistingLead(
                id: id,
                from: save,
                inspectionScheduledFor: localStr,
                scheduleNotes: scheduleNotes,
                roundRobinTeamId: roundRobinTeamId
            )
        case .createOnSchedule(var save):
            if let loc = await repGeoCapture?() {
                save.rep_lat = loc.coordinate.latitude
                save.rep_lng = loc.coordinate.longitude
                if loc.horizontalAccuracy >= 0 {
                    save.rep_geo_accuracy = loc.horizontalAccuracy
                }
                save.rep_geo_captured_at = Self.repGeoISO8601.string(from: loc.timestamp)
            }
            guard save.lat != nil, save.lng != nil else {
                errorMessage = "Missing map coordinates for this knock."
                isScheduling = false
                return
            }
            if save.lead_id == nil || save.lead_id?.isEmpty == true,
               let clientId = save.client_lead_id, !clientId.isEmpty {
                if let resolved = try? await APIClient.saveLeadDirect(save),
                   let id = resolved.lead_id, !id.isEmpty {
                    save.lead_id = id
                }
            }
            if let leadId = save.lead_id, !leadId.isEmpty {
                payload = .forExistingLead(
                    id: leadId,
                    from: save,
                    inspectionScheduledFor: localStr,
                    scheduleNotes: scheduleNotes,
                    roundRobinTeamId: roundRobinTeamId
                )
            } else {
                let mergedNotes: String? = {
                    guard let scheduleNotes else { return save.canvass_notes }
                    if let existing = save.canvass_notes, !existing.isEmpty {
                        return existing + "\n\n" + scheduleNotes
                    }
                    return scheduleNotes
                }()
                var saveWithNotes = save
                saveWithNotes.canvass_notes = mergedNotes
                payload = .forCreateAndSchedule(
                    from: saveWithNotes,
                    inspectionScheduledFor: localStr,
                    canvassNotes: nil,
                    roundRobinTeamId: roundRobinTeamId
                )
                usedCreateAndSchedule = true
                createScheduleKnockSave = saveWithNotes
            }
        }

        do {
            let result = try await APIClient.scheduleInspection(payload)
            let confirmation = Self.buildScheduleConfirmation(from: result)
            scheduledConfirmationTitle = confirmation.title
            scheduledConfirmationMessage = confirmation.message
            let generator = UINotificationFeedbackGenerator()
            generator.notificationOccurred(confirmation.calendarSyncedFully ? .success : .warning)
            showScheduledConfirmation = true
        } catch APIError.schedulingConflict(let msg) {
            if usedCreateAndSchedule, let knockSave = createScheduleKnockSave {
                await fallbackQueueKnockAfterScheduleFailure(save: knockSave, userMessage: msg)
            } else {
                errorMessage = msg
            }
        } catch APIError.httpError(let code) {
            let msg = "Server error (\(code)). Try a different time or contact support."
            if usedCreateAndSchedule, let knockSave = createScheduleKnockSave {
                await fallbackQueueKnockAfterScheduleFailure(save: knockSave, userMessage: msg)
            } else {
                errorMessage = msg
            }
        } catch APIError.unauthenticated {
            errorMessage = "Not signed in. Please log in and try again."
        } catch {
            if usedCreateAndSchedule, let knockSave = createScheduleKnockSave {
                await fallbackQueueKnockAfterScheduleFailure(save: knockSave, userMessage: error.localizedDescription)
            } else {
                errorMessage = error.localizedDescription
            }
        }

        isScheduling = false
    }

    private func fallbackQueueKnockAfterScheduleFailure(save: SaveLeadRequest, userMessage: String) async {
        do {
            _ = try await APIClient.saveLeadQueued(save)
            let generator = UINotificationFeedbackGenerator()
            generator.notificationOccurred(.success)
            errorMessage = "Could not schedule (\(userMessage)). Knock saved — sync when online and schedule from the lead."
        } catch {
            errorMessage = userMessage
        }
    }

    // MARK: - Helpers

    private struct ScheduleConfirmationCopy {
        let title: String
        let message: String
        let calendarSyncedFully: Bool
    }

    /// Interprets POST `/api/canvass/lead` fields: `calendar_synced`, `calendar_error`, `assigned_closer`.
    private static func buildScheduleConfirmation(from result: ScheduleInspectionResponse) -> ScheduleConfirmationCopy {
        let calendarErrorTrimmed = result.calendar_error?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let hasCalendarError = !(calendarErrorTrimmed?.isEmpty ?? true)

        let calendarSyncedFully: Bool = {
            if hasCalendarError { return false }
            if let synced = result.calendar_synced { return synced }
            return true
        }()

        let closerTrimmed = result.assigned_closer?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let hasCloser = !(closerTrimmed?.isEmpty ?? true)

        if calendarSyncedFully {
            let message: String
            if hasCloser {
                message = "Assigned closer: \(closerTrimmed!)\n\nThey'll receive calendar and CRM notification."
            } else {
                message = "Your inspection was booked. A closer will be assigned via round-robin."
            }
            return ScheduleConfirmationCopy(
                title: "Inspection scheduled",
                message: message,
                calendarSyncedFully: true
            )
        }

        var message = "Your inspection is booked in the CRM."
        if hasCloser {
            message += "\n\nAssigned closer: \(closerTrimmed!)"
        } else {
            message += "\n\nA closer will be assigned via round-robin."
        }
        message += "\n\nThe Google Calendar invite may not have been created."
        if hasCalendarError, let detail = calendarErrorTrimmed {
            message += "\n\n\(detail)"
        }
        message += "\n\nIf the closer doesn't see it on their calendar, contact ops."

        return ScheduleConfirmationCopy(
            title: "Inspection scheduled",
            message: message,
            calendarSyncedFully: false
        )
    }

    private static func buildDateOptions() -> [ScheduleDateOption] {
        let cal = Calendar.current
        let today = Date()
        var options: [ScheduleDateOption] = []
        for offset in 0..<7 {
            guard let date = cal.date(byAdding: .day, value: offset, to: today) else { continue }
            let ymd = formatLocalYmd(date)
            let label: String
            if offset == 0 {
                label = "Today"
            } else if offset == 1 {
                label = "Tomorrow"
            } else {
                let fmt = DateFormatter()
                fmt.locale = Locale(identifier: "en_US")
                fmt.dateFormat = "EEE, MMM d"
                label = fmt.string(from: date)
            }
            options.append(ScheduleDateOption(id: ymd, label: label))
        }
        return options
    }

    static func formatLocalYmd(_ date: Date) -> String {
        let fmt = DateFormatter()
        fmt.locale = Locale(identifier: "en_US_POSIX")
        fmt.dateFormat = "yyyy-MM-dd"
        return fmt.string(from: date)
    }

    static func nextBusinessDay9am() -> Date {
        var cal = Calendar.current
        cal.locale = Locale.current
        var comps = cal.dateComponents([.year, .month, .day], from: Date())
        comps.hour = 9
        comps.minute = 0
        comps.second = 0
        guard var candidate = cal.date(from: comps) else { return Date() }
        candidate = cal.date(byAdding: .day, value: 1, to: candidate) ?? candidate
        while true {
            let weekday = cal.component(.weekday, from: candidate)
            if weekday != 1 && weekday != 7 { break }
            candidate = cal.date(byAdding: .day, value: 1, to: candidate) ?? candidate
        }
        return candidate
    }

    static func formatLocalDateTime(_ date: Date) -> String {
        let fmt = DateFormatter()
        fmt.locale = Locale(identifier: "en_US_POSIX")
        fmt.dateFormat = "yyyy-MM-dd'T'HH:mm"
        return fmt.string(from: date)
    }

    private static let repGeoISO8601: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}
