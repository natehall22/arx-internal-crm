import SwiftUI
import Supabase

// MARK: - Next Appointment Card (Dashboard + Sisu home)

/// Read-only "next appointment" card. Hides entirely when empty / on fetch failure.
struct NextAppointmentCard: View {
    /// Bumped by parent pull-to-refresh so the card reloads with the rest of the screen.
    var refreshToken: Int = 0

    @AppStorage(AppSettings.Keys.navigationApp) private var navigationAppRaw = NavigationAppSetting.appleMaps.rawValue

    @State private var appointments: [MobileAppointment] = []
    @State private var expanded = false
    @State private var loaded = false

    private var upcoming: [MobileAppointment] {
        let now = Date()
        return appointments
            .filter { ($0.scheduledDate ?? .distantPast) >= now }
            .sorted { ($0.scheduledDate ?? .distantFuture) < ($1.scheduledDate ?? .distantFuture) }
    }

    private var next: MobileAppointment? { upcoming.first }

    private var disclosureList: [MobileAppointment] {
        Array(upcoming.prefix(5))
    }

    var body: some View {
        Group {
            if loaded, let next {
                VStack(alignment: .leading, spacing: 10) {
                    Text("NEXT APPOINTMENT")
                        .font(.caption.weight(.semibold))
                        .foregroundColor(.secondary)
                        .padding(.horizontal)

                    VStack(spacing: 0) {
                        appointmentBlock(next, isPrimary: true)

                        if expanded, disclosureList.count > 1 {
                            Divider().padding(.leading, 16)
                            ForEach(Array(disclosureList.dropFirst().enumerated()), id: \.element.id) { index, apt in
                                appointmentBlock(apt, isPrimary: false)
                                if index < disclosureList.count - 2 {
                                    Divider().padding(.leading, 16)
                                }
                            }
                        }

                        if upcoming.count > 1 {
                            Button {
                                withAnimation(.easeInOut(duration: 0.2)) {
                                    expanded.toggle()
                                }
                            } label: {
                                HStack {
                                    Spacer()
                                    Label(
                                        expanded ? "Show less" : "+\(min(upcoming.count - 1, 4)) more",
                                        systemImage: expanded ? "chevron.up" : "chevron.down"
                                    )
                                    .font(.caption.weight(.medium))
                                    .foregroundColor(AppSettings.brandBlue)
                                    Spacer()
                                }
                                .padding(.vertical, 10)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .background(Color(.secondarySystemBackground))
                    .cornerRadius(16)
                    .padding(.horizontal)
                }
            }
        }
        .task(id: refreshToken) { await load() }
    }

    // MARK: - Row

    private func appointmentBlock(_ apt: MobileAppointment, isPrimary: Bool) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Button {
                guard isPrimary, upcoming.count > 1 else { return }
                withAnimation(.easeInOut(duration: 0.2)) {
                    expanded.toggle()
                }
            } label: {
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: "calendar")
                        .font(.system(size: isPrimary ? 18 : 14))
                        .foregroundColor(AppSettings.brandBlue)
                        .frame(width: 24)

                    VStack(alignment: .leading, spacing: 4) {
                        Text(Self.formatWhen(apt.scheduledDate))
                            .font(isPrimary ? .subheadline.weight(.bold) : .caption.weight(.semibold))
                            .foregroundColor(AppSettings.darkText)

                        Text(apt.homeownerName)
                            .font(isPrimary ? .subheadline.weight(.medium) : .caption)
                            .foregroundColor(AppSettings.darkText)

                        if let address = apt.displayAddress {
                            Text(address)
                                .font(isPrimary ? .caption : .caption2)
                                .foregroundColor(.secondary)
                                .lineLimit(2)
                        }

                        Text(apt.typeLabel)
                            .font(.caption2.weight(.medium))
                            .foregroundColor(AppSettings.brandBlue)
                    }

                    Spacer(minLength: 0)

                    if isPrimary, upcoming.count > 1 {
                        Image(systemName: expanded ? "chevron.up" : "chevron.down")
                            .font(.caption.weight(.semibold))
                            .foregroundColor(.secondary)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(!isPrimary || upcoming.count <= 1)

            if apt.displayAddress != nil || apt.phone != nil {
                HStack(spacing: 10) {
                    if let address = apt.displayAddress {
                        Button {
                            openDirections(to: address)
                        } label: {
                            Label("Directions", systemImage: "arrow.triangle.turn.up.right.diamond.fill")
                                .font(.caption.weight(.semibold))
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, isPrimary ? 8 : 6)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(AppSettings.brandBlue)
                    }

                    if let phone = apt.phone {
                        Button {
                            let digits = phone.filter { $0.isNumber }
                            if let url = URL(string: "tel:\(digits)") {
                                UIApplication.shared.open(url)
                            }
                        } label: {
                            Label("Call", systemImage: "phone.fill")
                                .font(.caption.weight(.semibold))
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, isPrimary ? 8 : 6)
                        }
                        .buttonStyle(.bordered)
                        .tint(Color(hex: "#10B981"))
                    }
                }
            }
        }
        .padding(isPrimary ? 16 : 14)
    }

    // MARK: - Load / helpers

    private func load() async {
        // Failure hides the card — never blanks the parent screen.
        let fetched = (try? await APIClient.upcomingAppointments()) ?? []

        // Managers with canReassign get org-wide rows from the same endpoint —
        // keep only appointments where this user is closer or setter.
        let me = (try? await supabase.auth.session.user.id.uuidString.lowercased()) ?? ""
        let mine: [MobileAppointment]
        if me.isEmpty {
            mine = fetched
        } else {
            mine = fetched.filter { apt in
                let closerId = apt.closer?.id?.lowercased()
                let setterId = apt.setter?.id?.lowercased()
                return closerId == me || setterId == me
            }
        }

        appointments = mine
        loaded = true
        if mine.isEmpty { expanded = false }
    }

    private func openDirections(to address: String) {
        let encoded = address.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? address
        let app = NavigationAppSetting(rawValue: navigationAppRaw) ?? .appleMaps
        switch app {
        case .appleMaps:
            if let url = URL(string: "http://maps.apple.com/?daddr=\(encoded)") {
                UIApplication.shared.open(url)
            }
        case .googleMaps:
            let googleURL = URL(string: "comgooglemaps://?daddr=\(encoded)&directionsmode=driving")
            let webFallback = URL(string: "https://maps.google.com/?daddr=\(encoded)")
            if let googleURL, UIApplication.shared.canOpenURL(googleURL) {
                UIApplication.shared.open(googleURL)
            } else if let webFallback {
                UIApplication.shared.open(webFallback)
            }
        }
    }

    /// "Today 2:30 PM" / "Tomorrow 9:00 AM" / "Wed 2:30 PM"
    static func formatWhen(_ date: Date?) -> String {
        guard let date else { return "TBD" }
        let cal = Calendar.current
        let timeFmt = DateFormatter()
        timeFmt.dateFormat = "h:mm a"
        let time = timeFmt.string(from: date)

        if cal.isDateInToday(date) {
            return "Today \(time)"
        }
        if cal.isDateInTomorrow(date) {
            return "Tomorrow \(time)"
        }
        let dayFmt = DateFormatter()
        dayFmt.dateFormat = "EEE"
        return "\(dayFmt.string(from: date)) \(time)"
    }
}

#Preview {
    NextAppointmentCard()
}
