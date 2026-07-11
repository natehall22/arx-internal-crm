import SwiftUI

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss

    @AppStorage(AppSettings.Keys.mapStyle) private var mapStyleRaw = MapStyleSetting.hybrid.rawValue
    @AppStorage(AppSettings.Keys.colorScheme) private var colorSchemeRaw = ColorSchemeSetting.system.rawValue
    @AppStorage(AppSettings.Keys.navigationApp) private var navigationAppRaw = NavigationAppSetting.appleMaps.rawValue
    @AppStorage(AppSettings.Keys.enable3DBuildings) private var enable3DBuildings = true
    @AppStorage(AppSettings.Keys.focusMode) private var focusMode = false

    private var appVersion: String {
        let short = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
        return "\(short) (\(build))"
    }

    var body: some View {
        NavigationView {
            List {
                Section("Canvass") {
                    Picker("Navigation App", selection: $navigationAppRaw) {
                        ForEach(NavigationAppSetting.allCases) { app in
                            Text(app.label).tag(app.rawValue)
                        }
                    }
                    Picker("Map Style", selection: $mapStyleRaw) {
                        ForEach(MapStyleSetting.allCases) { style in
                            Text(style.label).tag(style.rawValue)
                        }
                    }
                    Toggle("3D Buildings", isOn: $enable3DBuildings)
                }

                Section("Workflow") {
                    Toggle("Focus Mode (my activity only)", isOn: $focusMode)
                    NavigationLink("Customize Nav Bar") {
                        NavBarSettingsView()
                    }
                }

                Section("General") {
                    Picker("Color Scheme", selection: $colorSchemeRaw) {
                        ForEach(ColorSchemeSetting.allCases) { scheme in
                            Text(scheme.label).tag(scheme.rawValue)
                        }
                    }
                }

                Section("About") {
                    HStack {
                        Text("Version").foregroundColor(AppSettings.darkText)
                        Spacer()
                        Text(appVersion).foregroundColor(AppSettings.darkText.opacity(0.75))
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button { dismiss() } label: {
                        Text("Done").font(.body.weight(.semibold))
                    }
                }
            }
        }
    }
}
