//
//  ContentView.swift
//  ARX Sales
//

import SwiftUI
import Supabase

struct ContentView: View {
    @ObservedObject private var pushManager = PushManager.shared
    @State private var mobileCaps: MobileAppCapabilities?
    @State private var selectedTab: AppTab = .canvass
    @State private var showSettings = false
    @State private var showSearch = false
    @State private var currentUserId: String?
    /// Cached last-known `app_access` for this user (nil = never resolved, fails open).
    @State private var cachedAppAccess: Bool?
    @AppStorage(AppSettings.Keys.tabBarConfig) private var tabBarConfigRaw = ""
    @AppStorage(AppSettings.Keys.homeScreen) private var homeScreenRaw = HomeScreenSetting.canvass.rawValue
    /// Previous home setting — `homeScreenRaw` is already updated when `onChange` runs (iOS 15).
    @State private var previousHomeScreenRaw = UserDefaults.standard.string(
        forKey: AppSettings.Keys.homeScreen
    ) ?? HomeScreenSetting.canvass.rawValue

    /// Seed the initial tab from the persisted home-screen preference (Canvass by default) so the
    /// app lands there on launch — not just after the first tab-bar resolution pass.
    init() {
        let raw = UserDefaults.standard.string(forKey: AppSettings.Keys.homeScreen) ?? HomeScreenSetting.canvass.rawValue
        let home = HomeScreenSetting(rawValue: raw) ?? .canvass
        _selectedTab = State(initialValue: home.tab)
    }

    private var homeScreen: HomeScreenSetting { HomeScreenSetting(rawValue: homeScreenRaw) ?? .canvass }

    private var availableTabs: [AppTab] {
        let config = TabBarConfig.load(from: tabBarConfigRaw)
        return config.resolvedTabs(capabilities: mobileCaps, homeScreen: homeScreen)
    }

    /// Server value once loaded; otherwise the cached last-known value for this user
    /// (covers offline launches on a device previously denied); unknown fails open so an
    /// offline field rep is never stranded on first-ever launch.
    private var appAccessDenied: Bool {
        if let caps = mobileCaps { return caps.appAccess == false }
        return cachedAppAccess == false
    }

    var body: some View {
        Group {
            if appAccessDenied {
                AppAccessDeniedView()
            } else {
                mainTabs
            }
        }
        .task {
            currentUserId = try? await supabase.auth.session.user.id.uuidString.lowercased()
            if let currentUserId {
                cachedAppAccess = UserDefaults.standard.object(forKey: AppSettings.Keys.cachedAppAccessKey(userId: currentUserId)) as? Bool
            }
            if let caps = try? await APIClient.mobileCapabilities() {
                mobileCaps = caps
                if let currentUserId {
                    UserDefaults.standard.set(caps.appAccess, forKey: AppSettings.Keys.cachedAppAccessKey(userId: currentUserId))
                }
                ensureValidSelection()
            }
        }
    }

    private var mainTabs: some View {
        ZStack(alignment: .bottom) {
            ZStack {
                tabRoot(.dashboard) { DashboardView(onOpenSettings: { showSettings = true }) }
                tabRoot(.sisu) { SisuView(onOpenSettings: { showSettings = true }) }
                tabRoot(.canvass) {
                    CanvassView(
                        onOpenSettings: { showSettings = true },
                        weatherOverlayAvailable: mobileCaps?.weatherOverlay == true
                    )
                }
                if mobileCaps?.opportunitiesTab == true {
                    tabRoot(.opportunities) { OpportunitiesView() }
                }
                if mobileCaps?.measureTab == true {
                    tabRoot(.measure) { MeasureView() }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            FloatingTabBar(
                selectedTab: $selectedTab,
                tabs: availableTabs,
                onSearch: selectedTab == .canvass ? { showSearch = true } : nil
            )
        }
        .ignoresSafeArea(.keyboard)
        .sheet(isPresented: $showSettings) { SettingsView() }
        .sheet(isPresented: $showSearch) {
            AddressSearchSheet(region: CanvassMapCoordinator.shared.lastRegion) { coord in
                CanvassMapCoordinator.shared.flyToCoordinate?(coord)
            }
            .mediumSheetPresentation()
        }
        .onChange(of: tabBarConfigRaw) { _ in ensureValidSelection() }
        .onChange(of: mobileCaps?.opportunitiesTab) { _ in ensureValidSelection() }
        .onChange(of: mobileCaps?.measureTab) { _ in ensureValidSelection() }
        .onChange(of: homeScreenRaw) { newRaw in
            let oldHome = HomeScreenSetting(rawValue: previousHomeScreenRaw) ?? .canvass
            let shouldJump: Bool = {
                switch selectedTab {
                case .dashboard, .sisu:
                    return true
                case .canvass:
                    return oldHome.tab == .canvass
                case .opportunities, .measure:
                    return false
                }
            }()
            if shouldJump {
                selectedTab = homeScreen.tab
            }
            previousHomeScreenRaw = newRaw
            ensureValidSelection()
        }
        .onChange(of: pushManager.pendingTab) { _ in
            applyPendingPushTab()
        }
        .onAppear {
            applyPendingPushTab()
        }
    }

    private func applyPendingPushTab() {
        guard let tab = pushManager.pendingTab else { return }
        if availableTabs.contains(tab) {
            selectedTab = tab
        } else if tab == .sisu {
            // SPIFF push but Sisu not visible — land on home instead.
            selectedTab = homeScreen.tab
        }
        pushManager.pendingTab = nil
    }

    private func ensureValidSelection() {
        if !availableTabs.contains(selectedTab) { selectedTab = .canvass }
    }

    @ViewBuilder
    private func tabRoot<Content: View>(_ tab: AppTab, @ViewBuilder content: () -> Content) -> some View {
        content()
            .opacity(selectedTab == tab ? 1 : 0)
            .allowsHitTesting(selectedTab == tab)
            .accessibilityHidden(selectedTab != tab)
    }
}

import MapKit
