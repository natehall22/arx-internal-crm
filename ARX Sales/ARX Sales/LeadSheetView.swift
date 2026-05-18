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

    var isNew: Bool { pin == nil }

    /// Returns true when the current disposition warrants showing "Schedule Inspection".
    /// Only offered for existing leads (we need a lead_id), and only for dispositions
    /// where an inspection is the natural next step.
    private var canScheduleInspection: Bool {
        guard !isNew, pin?.id != nil else { return false }
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
                                            .font(.subheadline)
                                            .fontWeight(.semibold)
                                            .foregroundColor(.white)
                                    }
                                    if !phone.isEmpty {
                                        Text(phone)
                                            .font(.subheadline)
                                            .foregroundColor(.white.opacity(0.8))
                                    }
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
                                        .font(.caption2)
                                        .fontWeight(.semibold)
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
                                        .font(.caption2)
                                        .fontWeight(.semibold)
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
                            .foregroundColor(.secondary)
                            .font(.subheadline)
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

                // MARK: - Error
                if let error {
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
                        Button("Save") { Task { await save() } }
                            .fontWeight(.semibold)
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
        // Instantly show known pin data — no waiting
        if let pin {
            disposition  = pin.d ?? ""
            lastKnockedAt = pin.t.flatMap { formatDate($0) }
        }

        // Geocode + detail fetch run concurrently, neither blocks the UI
        async let geoTask: String? = reverseGeocode(coordinate)

        if let pin, !isNew {
            let pinId = pin.id
            async let detailTask = fetchDetail(id: pinId)
            let (geo, lead) = await (geoTask, detailTask)
            if let lead { populateForm(from: lead) }
            if address.isEmpty {
                address = geo ?? coordString(coordinate) ?? ""
            }
        } else {
            let geo = await geoTask
            if address.isEmpty {
                address = geo ?? coordString(coordinate) ?? ""
            }
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

    private func populateForm(from lead: CanvassLeadDetail) {
        if let name = lead.homeowner_name {
            let parts = name.split(separator: " ", maxSplits: 1)
            firstName = parts.first.map(String.init) ?? ""
            lastName  = parts.dropFirst().first.map(String.init) ?? ""
        }
        phone         = lead.phone ?? ""
        address       = lead.address_text ?? address
        disposition   = lead.canvass_disposition ?? disposition
        previousNotes = lead.canvass_notes ?? ""
        // Prefer updated_at for "last knock" — falls back to created_at from pin
        if let t = lead.updated_at ?? lead.created_at {
            lastKnockedAt = formatDate(t)
        }
        if let ownerName = lead.owner_name, !ownerName.isEmpty {
            lastKnockedBy = ownerName
        }
        // Notes field starts empty — rep types fresh notes this visit.
        // Previous notes shown in the amber callout above.
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
        payload.lead_id             = pin?.id
        payload.lat                 = coordinate?.latitude  ?? pin?.lat
        payload.lng                 = coordinate?.longitude ?? pin?.lng
        payload.address_text        = address.isEmpty ? nil : address
        payload.homeowner_name      = [firstName, lastName].filter { !$0.isEmpty }.joined(separator: " ")
        payload.phone               = phone.isEmpty ? nil : phone
        payload.canvass_disposition = disposition.isEmpty ? nil : disposition
        payload.canvass_notes       = combinedNotes

        do {
            _ = try await APIClient.saveLead(payload)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
        isSaving = false
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
