import SwiftUI

enum AppTab: String, CaseIterable, Identifiable {
    case dashboard
    case canvass
    case opportunities
    case measure

    var id: String { rawValue }

    var title: String {
        switch self {
        case .dashboard: return "Dashboard"
        case .canvass: return "Canvass"
        case .opportunities: return "Opportunities"
        case .measure: return "Measure"
        }
    }

    var systemImage: String {
        switch self {
        case .dashboard: return "chart.bar.fill"
        case .canvass: return "map.fill"
        case .opportunities: return "briefcase.fill"
        case .measure: return "ruler.fill"
        }
    }
}

struct TabBarConfig: Codable, Equatable {
    struct Entry: Codable, Equatable {
        var tab: String
        var visible: Bool
    }
    var order: [Entry]

    static let `default` = TabBarConfig(order: [
        .init(tab: AppTab.dashboard.rawValue, visible: true),
        .init(tab: AppTab.canvass.rawValue, visible: true),
        .init(tab: AppTab.opportunities.rawValue, visible: true),
        .init(tab: AppTab.measure.rawValue, visible: true),
    ])

    static func load(from raw: String) -> TabBarConfig {
        guard let data = raw.data(using: .utf8),
              let decoded = try? JSONDecoder().decode(TabBarConfig.self, from: data) else {
            return .default
        }
        return decoded.sanitized()
    }

    /// Drop unknown tabs and re-insert required tabs — survives partial @AppStorage corruption.
    func sanitized() -> TabBarConfig {
        var seen = Set<String>()
        var cleaned: [Entry] = []
        for entry in order {
            guard AppTab(rawValue: entry.tab) != nil, !seen.contains(entry.tab) else { continue }
            seen.insert(entry.tab)
            cleaned.append(entry)
        }
        for required in [AppTab.dashboard, .canvass] {
            if !seen.contains(required.rawValue) {
                cleaned.insert(.init(tab: required.rawValue, visible: true), at: required == .dashboard ? 0 : min(1, cleaned.count))
                seen.insert(required.rawValue)
            }
        }
        return TabBarConfig(order: cleaned.isEmpty ? Self.default.order : cleaned)
    }

    func saveRaw() -> String {
        guard let data = try? JSONEncoder().encode(self),
              let str = String(data: data, encoding: .utf8) else { return "" }
        return str
    }

    func resolvedTabs(capabilities: MobileAppCapabilities?) -> [AppTab] {
        var result: [AppTab] = []
        for entry in order where entry.visible {
            guard let tab = AppTab(rawValue: entry.tab) else { continue }
            switch tab {
            case .dashboard, .canvass:
                result.append(tab)
            case .opportunities:
                if capabilities?.opportunitiesTab == true { result.append(tab) }
            case .measure:
                if capabilities?.measureTab == true { result.append(tab) }
            }
        }
        if !result.contains(.dashboard) { result.insert(.dashboard, at: 0) }
        if !result.contains(.canvass) { result.insert(.canvass, at: min(1, result.count)) }
        return result
    }
}

struct FloatingTabBar: View {
    @Binding var selectedTab: AppTab
    let tabs: [AppTab]
    var onSearch: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: 4) {
            ForEach(tabs) { tab in
                tabButton(tab)
            }
            if let onSearch {
                searchButton(action: onSearch)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background {
            Capsule()
                .fill(.ultraThinMaterial)
                .overlay(Capsule().fill(Color.black.opacity(0.55)))
                .shadow(color: .black.opacity(0.28), radius: 12, y: 4)
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 12)
    }

    private func tabButton(_ tab: AppTab) -> some View {
        let isSelected = selectedTab == tab
        return Button {
            guard selectedTab != tab else { return }
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            withAnimation(.easeInOut(duration: 0.2)) { selectedTab = tab }
        } label: {
            VStack(spacing: 3) {
                Image(systemName: tab.systemImage)
                    .font(.system(size: 18, weight: .semibold))
                Text(tab.title)
                    .font(.system(size: 10, weight: .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .foregroundColor(isSelected ? AppSettings.brandBlue : Color.white.opacity(0.78))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
            .padding(.horizontal, 4)
            .background {
                if isSelected { Capsule().fill(Color.white.opacity(0.14)) }
            }
        }
        .buttonStyle(.plain)
    }

    private func searchButton(action: @escaping () -> Void) -> some View {
        Button {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            action()
        } label: {
            VStack(spacing: 3) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 18, weight: .semibold))
                Text("Search")
                    .font(.system(size: 10, weight: .semibold))
            }
            .foregroundColor(Color.white.opacity(0.78))
            .frame(width: 56)
            .padding(.vertical, 6)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Search address")
    }
}
