import SwiftUI
import CoreLocation
import MapKit

/// Est. construction / roof age from the parcel roof-age layer (claims-safe copy in UI).
struct CanvassPropertyRoofAgeEst: Equatable {
    let yearBuilt: Int
    let roofAge: Int
}

// MARK: - Lead Sheet

struct LeadSheetView: View {
    let pin: CanvassPin?
    let coordinate: CLLocationCoordinate2D?
    /// Parcel roof-age context when opened from a roof-age circle tap.
    var propertyRoofAgeEst: CanvassPropertyRoofAgeEst? = nil
    /// Snapshots rep GPS at save time (fresh one-shot, then last known from map tracking).
    var repGeoCapture: (() async -> CLLocation?)? = nil

    @Environment(\.dismiss) private var dismiss

    @State private var firstName   = ""
    @State private var lastName    = ""
    @State private var phone       = ""
    @State private var address     = ""
    @State private var disposition = ""
    @State private var notes       = ""
    @State private var previousNotes = ""
    @State private var lastKnockedAt: String? = nil
    @State private var lastKnockedBy: String? = nil
    @State private var isSaving    = false
    @State private var error: String? = nil
    @State private var showScheduleSheet = false
    @State private var offlineSaved = false
    @State private var newClientLeadId: String?

    @AppStorage(AppSettings.Keys.navigationApp) private var navigationAppRaw = NavigationAppSetting.appleMaps.rawValue

    var isNew: Bool { pin == nil }

    /// Matches web `new Date(position.timestamp).toISOString()`.
    private static let repGeoISO8601: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private var effectiveCoordinate: CLLocationCoordinate2D? {
        if let coordinate { return coordinate }
        if let pin {
            return CLLocationCoordinate2D(latitude: pin.lat, longitude: pin.lng)
        }
        return nil
    }

    private var directionsCoordinate: CLLocationCoordinate2D? {
        effectiveCoordinate
    }

    /// Schedule row hidden only for renters (all other dispositions, including not set).
    private var showScheduleInspectionSection: Bool {
        disposition != "renter"
    }

    private var trimmedScheduleFirstName: String {
        firstName.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var trimmedScheduleLastName: String {
        lastName.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var trimmedSchedulePhone: String {
        phone.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var scheduleContactComplete: Bool {
        !trimmedScheduleFirstName.isEmpty
            && !trimmedScheduleLastName.isEmpty
            && !trimmedSchedulePhone.isEmpty
    }

    private var scheduleContactHelperText: String? {
        guard showScheduleInspectionSection, !scheduleContactComplete else { return nil }
        var missing: [String] = []
        if trimmedScheduleFirstName.isEmpty { missing.append("first name") }
        if trimmedScheduleLastName.isEmpty { missing.append("last name") }
        if trimmedSchedulePhone.isEmpty { missing.append("phone") }
        guard !missing.isEmpty else { return nil }
        if missing.count == 1 {
            return "Add \(missing[0]) to schedule an inspection."
        }
        if missing.count == 2 {
            return "Add \(missing[0]) and \(missing[1]) to schedule an inspection."
        }
        return "Add first name, last name, and phone to schedule an inspection."
    }

    private var scheduleEnablementHelperText: String? {
        if let contact = scheduleContactHelperText { return contact }
        if showScheduleInspectionSection, scheduleContactComplete, scheduleTarget == nil {
            return "Map location is required to schedule an inspection."
        }
        return nil
    }

    /// True when the schedule sheet can be presented (contact + target).
    private var canOpenScheduleInspection: Bool {
        showScheduleInspectionSection && scheduleContactComplete && scheduleTarget != nil
    }

    private var scheduleCoordinates: (lat: Double, lng: Double)? {
        if let coordinate {
            return (coordinate.latitude, coordinate.longitude)
        }
        if let pin {
            return (pin.lat, pin.lng)
        }
        return nil
    }

    /// Server lead id when the pin is synced or a pending edit overlay; nil for client-only pending knocks.
    private func resolvedServerLeadId(for pin: CanvassPin?) -> String? {
        guard let pin else { return nil }
        if pin.isPending && !pin.isPendingEdit {
            if let item = OfflineLeadQueueBridge.shared.queuedItem(matchingPinId: pin.id),
               let leadId = item.request.lead_id, !leadId.isEmpty {
                return leadId
            }
            return nil
        }
        return pin.id.isEmpty ? nil : pin.id
    }

    private var scheduleTarget: ScheduleInspectionTarget? {
        guard showScheduleInspectionSection, scheduleContactComplete else { return nil }
        guard scheduleCoordinates != nil else { return nil }
        if let pin, !isNew, !pin.isPending, pin.id.isEmpty {
            return nil
        }
        var save = buildSavePayload(combinedNotes: combinedNotesForSave())
        if save.lat == nil || save.lng == nil, let coords = scheduleCoordinates {
            save.lat = coords.lat
            save.lng = coords.lng
        }
        if let pin, let serverId = resolvedServerLeadId(for: pin) {
            save.lead_id = serverId
            return .existingLead(id: serverId, save: save)
        }
        return .createOnSchedule(save)
    }

    var body: some View {
        NavigationView {
            Form {

                // MARK: - Context (existing pins only) — show before anything else
                if !isNew {
                    // Last knock + homeowner callout
                    Section {
                        // Homeowner name & phone
                        if !firstName.isEmpty || !lastName.isEmpty || !phone.isEmpty {
                            HStack(alignment: .top, spacing: 10) {
                                Image(systemName: "person.fill")
                                    .foregroundColor(.white.opacity(0.7))
                                VStack(alignment: .leading, spacing: 2) {
                                    let fullName = [firstName, lastName].filter { !$0.isEmpty }.joined(separator: " ")
                                    if !fullName.isEmpty {
                                        Text(fullName)
                                            .font(.subheadline.weight(.semibold))
                                            .foregroundColor(.white)
                                    }
                                    if !phone.isEmpty {
                                        Text(phone)
                                            .font(.subheadline)
                                            .foregroundColor(.white.opacity(0.8))
                                    }
                                }
                                if !phone.isEmpty {
                                    Spacer()
                                    Button {
                                        if let url = URL(string: "tel:\(phone.filter { $0.isNumber })") {
                                            UIApplication.shared.open(url)
                                        }
                                    } label: {
                                        Image(systemName: "phone.fill")
                                            .foregroundColor(.white)
                                            .padding(8)
                                            .background(Circle().fill(Color.white.opacity(0.2)))
                                    }
                                    .buttonStyle(.plain)
                                    .accessibilityLabel("Call homeowner")
                                }
                            }
                            .padding(.vertical, 2)
                        }

                        // Last knock row
                        if let knocked = lastKnockedAt {
                            HStack(alignment: .top, spacing: 10) {
                                Text("🚪")
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("LAST KNOCK")
                                        .font(.caption2.weight(.semibold))
                                        .foregroundColor(.white.opacity(0.6))
                                    Text(knocked)
                                        .font(.subheadline)
                                        .foregroundColor(.white)
                                    if let by = lastKnockedBy {
                                        Text(by)
                                            .font(.caption)
                                            .foregroundColor(.white.opacity(0.7))
                                    }
                                }
                            }
                            .padding(.vertical, 2)
                        }
                    }
                    .listRowBackground(Color(hex: "#1E40AF"))

                    // Previous notes callout
                    if !previousNotes.isEmpty {
                        Section {
                            HStack(alignment: .top, spacing: 10) {
                                Text("📝")
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("PREVIOUS NOTES")
                                        .font(.caption2.weight(.semibold))
                                        .foregroundColor(Color(hex: "#92400E"))
                                    Text(previousNotes)
                                        .font(.subheadline)
                                        .foregroundColor(Color(hex: "#1C1917"))
                                }
                            }
                            .padding(.vertical, 2)
                        }
                        .listRowBackground(Color(hex: "#FEF3C7"))
                    }
                }

                // MARK: - Property preview (parcel roof-age layer)
                if let est = propertyRoofAgeEst {
                    Section {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("PROPERTY (EST.)")
                                .font(.caption2.weight(.semibold))
                                .foregroundColor(Color(hex: "#57534E"))
                            Text("Built \(est.yearBuilt) · ~\(est.roofAge) yr roof age (est.)")
                                .font(.subheadline.weight(.medium))
                                .foregroundColor(AppSettings.darkText)
                            Text("Year built is an estimate. The home may have been re-roofed since.")
                                .font(.caption)
                                .foregroundColor(Color(hex: "#57534E"))
                        }
                        .padding(.vertical, 2)
                    }
                    .listRowBackground(Color(hex: "#F5F5F4"))
                }

                // MARK: - Disposition
                Section(isNew ? "What happened?" : "Update Disposition") {
                    Picker("Disposition", selection: $disposition) {
                        Text("— Not Set —").tag("")
                        ForEach(CanvassDisposition.all) { d in
                            Label {
                                Text(d.label)
                            } icon: {
                                Circle()
                                    .fill(Color(hex: d.color))
                                    .frame(width: 10, height: 10)
                            }
                            .tag(d.id)
                        }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                }

                // MARK: - Notes
                Section("Notes") {
                    TextEditor(text: $notes)
                        .frame(minHeight: 64)
                }

                // MARK: - Homeowner
                Section("Homeowner") {
                    TextField("First Name", text: $firstName)
                        .textContentType(.givenName)
                    TextField("Last Name", text: $lastName)
                        .textContentType(.familyName)
                    TextField("Phone", text: $phone)
                        .textContentType(.telephoneNumber)
                        .keyboardType(.phonePad)
                }

                // MARK: - Location
                Section("Location") {
                    TextField(
                        "Address",
                        text: $address,
                        prompt: Text("Street address").foregroundColor(Color(hex: "#78716C"))
                    )
                        .foregroundColor(AppSettings.darkText)
                        .font(.subheadline)
                        .textContentType(.fullStreetAddress)

                    if directionsCoordinate != nil {
                        Button {
                            openDirections()
                        } label: {
                            Label("Directions", systemImage: "arrow.triangle.turn.up.right.diamond.fill")
                        }
                    }
                }

                // MARK: - Error / offline confirmation
                if offlineSaved {
                    Section {
                        HStack(spacing: 8) {
                            Image(systemName: "icloud.and.arrow.up")
                                .foregroundColor(AppSettings.brandBlue)
                            Text("Saved — will sync when back online")
                                .foregroundColor(AppSettings.darkText)
                                .font(.subheadline)
                        }
                    }
                } else if let error {
                    Section {
                        Text(error).foregroundColor(.red).font(.footnote)
                    }
                }

                // MARK: - Schedule Inspection (bottom; hidden for renters)
                if showScheduleInspectionSection {
                    Section {
                        Button {
                            showScheduleSheet = true
                        } label: {
                            VStack(spacing: 4) {
                                HStack {
                                    Image(systemName: "calendar.badge.plus")
                                    Text("Schedule Inspection")
                                        .fontWeight(.semibold)
                                }
                                if canOpenScheduleInspection {
                                    Text("Team round-robin · pick an open slot")
                                        .font(.caption)
                                        .opacity(0.9)
                                }
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 4)
                        }
                        .disabled(!canOpenScheduleInspection)
                        .foregroundColor(canOpenScheduleInspection ? .white : Color(hex: "#78716C"))
                        .listRowBackground(canOpenScheduleInspection ? Color.blue : Color(hex: "#E7E5E4"))

                        if let helper = scheduleEnablementHelperText {
                            Text(helper)
                                .font(.footnote)
                                .foregroundColor(Color(hex: "#57534E"))
                                .padding(.top, 2)
                        }
                    }
                }
            }
            .navigationTitle(isNew ? "New Lead" : "Edit Lead")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView()
                    } else {
                        Button { Task { await save() } } label: {
                            Text("Save")
                                .fontWeight(.semibold)
                        }
                    }
                }
            }
            .disabled(isSaving)
            .sheet(isPresented: $showScheduleSheet) {
                if let target = scheduleTarget {
                    ScheduleInspectionSheet(
                        target: target,
                        address: address,
                        homeownerName: [firstName, lastName]
                            .filter { !$0.isEmpty }
                            .joined(separator: " "),
                        repGeoCapture: repGeoCapture,
                        onSuccess: { dismiss() }
                    )
                }
            }
        }
        .task { await setup() }
    }

    // MARK: - Setup

    private func setup() async {
        if isNew, newClientLeadId == nil {
            newClientLeadId = UUID().uuidString.lowercased()
        }

        let pinId = pin?.id
        let queued = pinId.flatMap { OfflineLeadQueueBridge.shared.queuedItem(matchingPinId: $0) }

        // Instantly show known pin data — no waiting
        if let pin {
            disposition = pin.d ?? ""
            lastKnockedAt = pin.t.flatMap { formatDate($0) }
        }

        if let queued {
            hydrateFromQueuedItem(queued)
        }

        let coord = effectiveCoordinate
        let preserveQueued = queued != nil
        let coordFallback = coordString(coord) ?? ""
        if address.isEmpty, !coordFallback.isEmpty {
            address = coordFallback
        }

        // Detail fetch only applies to a real, already-synced existing pin — matches the
        // four branches this replaces (skip for a brand-new lead or an offline-pending one).
        let detailPinId: String? = (pin != nil && !isNew && pin?.isPending != true) ? pin?.id : nil

        // Address autofill (CRM Google geocode) and lead-detail fetch run independently.
        await withTaskGroup(of: Void.self) { group in
            group.addTask { @MainActor in
                let needsGeocode = self.address.isEmpty || self.address == coordFallback
                guard needsGeocode else { return }
                let geo = await self.reverseGeocode(coord)
                if let geo, !geo.isEmpty {
                    if self.address.isEmpty || self.address == coordFallback {
                        self.address = geo
                    }
                } else if (self.address.isEmpty || self.address == coordFallback), !coordFallback.isEmpty {
                    self.address = coordFallback
                }
            }
            if let detailPinId {
                group.addTask { @MainActor in
                    if let lead = await self.fetchDetail(id: detailPinId) {
                        self.populateForm(from: lead, preserveQueuedFields: preserveQueued)
                    }
                }
            }
        }

        if address.isEmpty, !coordFallback.isEmpty {
            address = coordFallback
        }
    }

    private func hydrateFromQueuedItem(_ item: QueuedLeadItem) {
        let req = item.request
        if let disp = req.canvass_disposition, !disp.isEmpty {
            disposition = disp
        }
        if let name = req.homeowner_name, !name.isEmpty {
            let parts = name.split(separator: " ", maxSplits: 1)
            firstName = parts.first.map(String.init) ?? ""
            lastName = parts.dropFirst().first.map(String.init) ?? ""
        }
        if let p = req.phone, !p.isEmpty { phone = p }
        if let addr = req.address_text, !addr.isEmpty { address = addr }
        if let queuedNotes = req.canvass_notes, !queuedNotes.isEmpty {
            notes = queuedNotes
            previousNotes = ""
        }
    }

    /// Fetch lead detail with a 10-second ceiling. Returns nil on timeout/error.
    private func fetchDetail(id: String) async -> CanvassLeadDetail? {
        await withTaskGroup(of: CanvassLeadDetail?.self) { group in
            group.addTask {
                (try? await APIClient.leadDetails(ids: [id]))?.first
            }
            group.addTask {
                try? await Task.sleep(nanoseconds: 10_000_000_000)
                return nil
            }
            let result = await group.next() ?? nil
            group.cancelAll()
            return result
        }
    }

    private func trimmedNonEmpty(_ value: String?) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else {
            return nil
        }
        return value
    }

    private func populateForm(from lead: CanvassLeadDetail, preserveQueuedFields: Bool) {
        let leadAddress = trimmedNonEmpty(lead.address_text)
        if !preserveQueuedFields {
            if let name = lead.homeowner_name {
                let parts = name.split(separator: " ", maxSplits: 1)
                firstName = parts.first.map(String.init) ?? ""
                lastName  = parts.dropFirst().first.map(String.init) ?? ""
            }
            phone         = lead.phone ?? ""
            address       = leadAddress ?? address
            disposition   = lead.canvass_disposition ?? disposition
            previousNotes = lead.canvass_notes ?? ""
        } else {
            if address.isEmpty {
                address = leadAddress ?? address
            }
            if firstName.isEmpty && lastName.isEmpty, let name = lead.homeowner_name {
                let parts = name.split(separator: " ", maxSplits: 1)
                firstName = parts.first.map(String.init) ?? ""
                lastName  = parts.dropFirst().first.map(String.init) ?? ""
            }
            if phone.isEmpty {
                phone = lead.phone ?? ""
            }
            // Keep queued notes in `notes`; retain server history so offline save does not wipe CRM notes.
            previousNotes = lead.canvass_notes ?? ""
        }
        // Prefer updated_at for "last knock" — falls back to created_at from pin
        if let t = lead.updated_at ?? lead.created_at {
            lastKnockedAt = formatDate(t)
        }
        if let ownerName = lead.owner_name, !ownerName.isEmpty {
            lastKnockedBy = ownerName
        }
    }

    // MARK: - Save

    private func combinedNotesForSave() -> String? {
        let parts = [notes, previousNotes].filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: "\n\n---\n\n")
    }

    private func buildSavePayload(combinedNotes: String?) -> SaveLeadRequest {
        var payload = SaveLeadRequest()
        if let pin, pin.isPending, !pin.isPendingEdit {
            payload.client_lead_id = pin.id
        } else {
            payload.lead_id = pin?.id
            if isNew {
                payload.client_lead_id = newClientLeadId ?? UUID().uuidString.lowercased()
            }
        }
        payload.lat                 = coordinate?.latitude  ?? pin?.lat
        payload.lng                 = coordinate?.longitude ?? pin?.lng
        payload.address_text        = address.isEmpty ? nil : address
        let homeownerName = [firstName, lastName].filter { !$0.isEmpty }.joined(separator: " ")
        payload.homeowner_name      = homeownerName.isEmpty ? nil : homeownerName
        payload.phone               = phone.isEmpty ? nil : phone
        payload.canvass_disposition = disposition.isEmpty ? nil : disposition
        payload.canvass_notes       = combinedNotes
        return payload
    }

    private func save() async {
        isSaving = true
        error = nil

        let combinedNotes = combinedNotesForSave()

        var payload = buildSavePayload(combinedNotes: combinedNotes)

        if let loc = await repGeoCapture?() {
            payload.rep_lat = loc.coordinate.latitude
            payload.rep_lng = loc.coordinate.longitude
            if loc.horizontalAccuracy >= 0 {
                payload.rep_geo_accuracy = loc.horizontalAccuracy
            }
            payload.rep_geo_captured_at = Self.repGeoISO8601.string(from: loc.timestamp)
        }

        do {
            let outcome = try await APIClient.saveLeadQueued(payload)
            switch outcome {
            case .synced:
                dismiss()
            case .queuedOffline:
                offlineSaved = true
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                try? await Task.sleep(nanoseconds: 1_200_000_000)
                dismiss()
            }
        } catch {
            self.error = error.localizedDescription
        }
        isSaving = false
    }

    // MARK: - Directions

    private func openDirections() {
        guard let coord = directionsCoordinate else { return }
        let navApp = NavigationAppSetting(rawValue: navigationAppRaw) ?? .appleMaps
        let label = address.isEmpty ? "Lead" : address

        switch navApp {
        case .appleMaps:
            let item = MKMapItem(placemark: MKPlacemark(coordinate: coord))
            item.name = label
            item.openInMaps(launchOptions: [
                MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeDriving
            ])
        case .googleMaps:
            let googleURL = URL(
                string: String(
                    format: "comgooglemaps://?daddr=%.6f,%.6f&directionsmode=driving",
                    coord.latitude,
                    coord.longitude
                )
            )
            let webFallback = URL(
                string: String(
                    format: "https://maps.google.com/?daddr=%.6f,%.6f&directionsmode=driving",
                    coord.latitude,
                    coord.longitude
                )
            )
            if let googleURL, UIApplication.shared.canOpenURL(googleURL) {
                UIApplication.shared.open(googleURL)
            } else if let webFallback {
                UIApplication.shared.open(webFallback)
            }
        }
    }

    // MARK: - Helpers

    private func formatDate(_ iso: String) -> String? {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = parser.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return nil }
        let fmt = DateFormatter()
        fmt.dateStyle = .medium
        fmt.timeStyle = .short
        return fmt.string(from: date)
    }

    private func coordString(_ coord: CLLocationCoordinate2D?) -> String? {
        guard let c = coord else { return nil }
        return String(format: "%.5f, %.5f", c.latitude, c.longitude)
    }

    private func reverseGeocode(_ coord: CLLocationCoordinate2D?) async -> String? {
        guard let coord else { return nil }
        return await withTaskGroup(of: String?.self) { group in
            group.addTask {
                await APIClient.reverseGeocodeCanvass(lat: coord.latitude, lng: coord.longitude)
            }
            group.addTask {
                try? await Task.sleep(nanoseconds: 8_000_000_000)
                return nil
            }
            let result = await group.next() ?? nil
            group.cancelAll()
            return result
        }
    }
}

// MARK: - Color(hex:) helper for SwiftUI

extension Color {
    init(hex: String) {
        var h = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if h.hasPrefix("#") { h = String(h.dropFirst()) }
        var rgb: UInt64 = 0
        Scanner(string: h).scanHexInt64(&rgb)
        self.init(
            red:   Double((rgb >> 16) & 0xFF) / 255,
            green: Double((rgb >> 8)  & 0xFF) / 255,
            blue:  Double( rgb        & 0xFF) / 255
        )
    }
}
