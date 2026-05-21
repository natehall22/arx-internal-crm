//
//  ContentView.swift
//  ARX Sales
//
//  Created by Nathan Hall on 5/16/26.
//

import SwiftUI
import Supabase

struct ContentView: View {
    /// From `/api/mobile/capabilities` — driven by Admin → Roles (`opportunities:view`) and user overrides.
    @State private var mobileCaps: MobileAppCapabilities?

    var body: some View {
        TabView {
            DashboardView()
                .tabItem {
                    Label("Dashboard", systemImage: "chart.bar.fill")
                }

            CanvassView()
                .tabItem {
                    Label("Canvass", systemImage: "map.fill")
                }

            if mobileCaps?.opportunitiesTab == true {
                OpportunitiesView()
                    .tabItem {
                        Label("Opportunities", systemImage: "briefcase.fill")
                    }
            }

            if mobileCaps?.measureTab == true {
                MeasureView()
                    .tabItem {
                        Label("Measure", systemImage: "ruler.fill")
                    }
            }
        }
        .task {
            if let caps = try? await APIClient.mobileCapabilities() {
                mobileCaps = caps
            }
        }
    }
}

#Preview {
    ContentView()
}
