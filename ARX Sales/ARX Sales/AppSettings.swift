import Foundation
import MapKit
import SwiftUI

// MARK: - Persisted app settings (@AppStorage keys)

enum AppSettings {
    enum Keys {
        static let mapStyle = "settings.mapStyle"
        static let colorScheme = "settings.colorScheme"
        static let navigationApp = "settings.navigationApp"
        static let enable3DBuildings = "settings.enable3DBuildings"

        // Layer toggles (Phase 3)
        static let showTerritories = "settings.showTerritories"
        static let showWeather = "settings.showWeather"
        static let showRoofAge = "settings.showRoofAge"
        static let myPinsOnly = "settings.myPinsOnly"

        // Phase 4
        static let focusMode = "settings.focusMode"
        static let pinTimeFilter = "settings.pinTimeFilter"
        static let tabBarConfig = "settings.tabBarConfig"

        /// Last-known `app_access` per signed-in user (prefix — actual key appends the user id).
        /// Lets a denied user re-launching offline on a shared device still see the lockout
        /// screen without needing a network round-trip; unknown/never-seen users fail open.
        static let cachedAppAccessPrefix = "settings.cachedAppAccess."
        static func cachedAppAccessKey(userId: String) -> String { cachedAppAccessPrefix + userId }
    }

    static let brandBlue = Color(hex: "#3B82F6")
    static let darkText = Color(hex: "#2c2c2a")
    static let floatingTabContentInset: CGFloat = 88

    static let elevationNames = ["Front", "Right", "Rear", "Left"]
}

enum PinTimeFilter: String, CaseIterable, Identifiable {
    case days7 = "7d"
    case days30 = "30d"
    case days90 = "90d"
    case all = "all"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .days7: return "7d"
        case .days30: return "30d"
        case .days90: return "90d"
        case .all: return "All"
        }
    }

    var cutoff: Date? {
        let cal = Calendar.current
        switch self {
        case .days7: return cal.date(byAdding: .day, value: -7, to: Date())
        case .days30: return cal.date(byAdding: .day, value: -30, to: Date())
        case .days90: return cal.date(byAdding: .day, value: -90, to: Date())
        case .all: return nil
        }
    }
}

enum MapStyleSetting: String, CaseIterable, Identifiable {
    case standard
    case hybrid
    case satellite

    var id: String { rawValue }

    var label: String {
        switch self {
        case .standard: return "Standard"
        case .hybrid: return "Hybrid"
        case .satellite: return "Satellite"
        }
    }

    var legacyMapType: MKMapType {
        switch self {
        case .standard: return .standard
        case .hybrid: return .hybrid
        case .satellite: return .satellite
        }
    }
}

enum ColorSchemeSetting: String, CaseIterable, Identifiable {
    case system, light, dark
    var id: String { rawValue }
    var label: String {
        switch self {
        case .system: return "System"
        case .light: return "Light"
        case .dark: return "Dark"
        }
    }
    var preferredColorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }
}

enum NavigationAppSetting: String, CaseIterable, Identifiable {
    case appleMaps, googleMaps
    var id: String { rawValue }
    var label: String {
        switch self {
        case .appleMaps: return "Apple Maps"
        case .googleMaps: return "Google Maps"
        }
    }
}

// MARK: - Pin filtering helpers

struct MapCircleButton: View {
    let systemImage: String
    var isActive: Bool = false
    let action: () -> Void

    var body: some View {
        Button {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            action()
        } label: {
            Image(systemName: systemImage)
                .font(.system(size: 20, weight: .semibold))
                .foregroundColor(.white)
                .frame(width: 50, height: 50)
                .background {
                    ZStack {
                        Circle().fill(.ultraThinMaterial)
                        Circle().fill(Color.black.opacity(0.42))
                        if isActive {
                            Circle().strokeBorder(AppSettings.brandBlue, lineWidth: 2)
                        }
                    }
                }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isActive ? .isSelected : [])
    }
}

struct MapHUDChip<Content: View>: View {
    @ViewBuilder var content: () -> Content
    var body: some View {
        content()
            .font(.caption)
            .foregroundColor(AppSettings.darkText)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(Capsule().fill(Color.white.opacity(0.94)))
            .shadow(color: .black.opacity(0.18), radius: 4, y: 1)
    }
}

// MARK: - Pin filtering helpers

enum CanvassPinFilters {
    static func matchesTime(_ pin: CanvassPin, filter: PinTimeFilter) -> Bool {
        guard let cutoff = filter.cutoff else { return true }
        guard let t = pin.t else { return true }
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = parser.date(from: t) ?? ISO8601DateFormatter().date(from: t) else { return true }
        return date >= cutoff
    }

    /// When `myUserId` is unknown, exclude pins rather than showing everyone's (shared-device safe).
    static func matchesOwner(_ pin: CanvassPin, myUserId: String?) -> Bool {
        guard let myUserId, !myUserId.isEmpty else { return false }
        return pin.o == myUserId
    }
}
