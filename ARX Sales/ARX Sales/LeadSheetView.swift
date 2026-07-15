import SwiftUI
import CoreLocation
import MapKit

// MARK: - Lead Sheet

struct LeadSheetView: View {
    let pin: CanvassPin?
    let coordinate: CLLocationCoordinate2D?

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

    private var directionsCoordinate: CLLocationCoordinate2D? {
        if let coordinate { return coordinate }
        if let pin {
            return CLLocationCoordinate2D(latitude: pin.lat, longitude: pin.lng)
        }
        return nil
    }

    /// Returns true when the current disposition warrants showing "Schedule Inspection".
    /// Only offered for existing leads (we need a lead_id), and only for dispositions
    /// where an inspection is the natural next step.
    private var canScheduleInspection: Bool {
        guard !isNew, pin?.id != nil, pin?.isPending != true else { return false }
        return disposition == "hot_lead" || disposition == "go_back"
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
                    if address.isEmpty {
                        HStack(spacing: 8) {
                            ProgressView().scaleEffect(0.75)
                            Text("Looking up address…")
                                .foregroundColor(.secondary)
                                .font(.subheadline)
                        }
                    } else {
                        Text(address)
                            .foregroundColor(AppSettings.darkText)
                            .font(.subheadline)
                    }

                    if directionsCoordinate != nil {
                        Button {
                            openDirections()
                        } label: {
                            Label("Directions", systemImage: "arrow.triangle.turn.up.right.diamond.fill")
                        }
                    }
                }

                // MARK: - Schedule Inspection
                if canScheduleInspection {
                    Section {
                        Button {
                            showScheduleSheet = true
                        } label: {
                            HStack {
                                Image(systemName: "calendar.badge.plus")
                                Text("Schedule Inspection")
                                    .fontWeight(.semibold)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 4)
                        }
                        .foregroundColor(.white)
                        .listRowBackground(Color.blue)
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
                if let leadId = pin?.id {
                    ScheduleInspectionSheet(
                        leadId: leadId,
                        address: address,
                        homeownerName: [firstName, lastName]
                            .filter { !$0.isEmpty }
                            .joined(separator: " ")
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

        let coord = coordinate
        let preserveQueued = queued != nil
        // Detail fetch only applies to a real, already-synced existing pin — matches the
        // four branches this replaces (skip for a brand-new lead or an offline-pending one).
        let detailPinId: String? = (pin != nil && !isNew && pin?.isPending != true) ? pin?.id : nil

        // Geocoding and the lead-detail fetch each carry their own bounded timeout
        // (reverseGeocode: ~5s, fetchDetail: ~10s) and now run as independent tasks in
        // this group, each applying its own result the moment it resolves. Previously
        // they were joined via `await (geoTask, detailTask)`, which held the address
        // field on "Looking up address…" for as long as the SLOWER of the two took —
        // so a rep on a weak connection (or any detail-fetch hiccup) saw the address
        // stay stuck well past the point geocoding itself had already succeeded.
        await withTaskGroup(of: Void.self) { group in
            group.addTask { @MainActor in
                let geo = await self.reverseGeocode(coord)
                if self.address.isEmpty {
                    self.address = geo ?? self.coordString(coord) ?? ""
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

    private func populateForm(from lead: CanvassLeadDetail, preserveQueuedFields: Bool) {
        if !preserveQueuedFields {
            if let name = lead.homeowner_name {
                let parts = name.split(separator: " ", maxSplits: 1)
                firstName = parts.first.map(String.init) ?? ""
                lastName  = parts.dropFirst().first.map(String.init) ?? ""
            }
            phone         = lead.phone ?? ""
            address       = lead.address_text ?? address
            disposition   = lead.canvass_disposition ?? disposition
            previousNotes = lead.canvass_notes ?? ""
        } else {
            if address.isEmpty {
                address = lead.address_text ?? address
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

    private func save() async {
        isSaving = true
        error = nil

        // Combine previous notes + new notes so history is preserved
        let combinedNotes: String? = {
            let parts = [notes, previousNotes].filter { !$0.isEmpty }
            return parts.isEmpty ? nil : parts.joined(separator: "\n\n---\n\n")
        }()

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
        payload.homeowner_name      = [firstName, lastName].filter { !$0.isEmpty }.joined(separator: " ")
        payload.phone               = phone.isEmpty ? nil : phone
        payload.canvass_disposition = disposition.isEmpty ? nil : disposition
        payload.canvass_notes       = combinedNotes

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
                let geocoder = CLGeocoder()
                let location = CLLocation(latitude: coord.latitude, longitude: coord.longitude)
                let placemarks = try? await geocoder.reverseGeocodeLocation(location)
                guard let p = placemarks?.first else { return nil }
                return [p.subThoroughfare, p.thoroughfare, p.locality, p.administrativeArea]
                    .compactMap { $0 }.joined(separator: " ")
            }
            group.addTask {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
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
