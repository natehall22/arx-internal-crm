//
//  ContentView.swift
//  ARX Sales
//
//  Created by Nathan Hall on 5/16/26.
//

import SwiftUI
import Supabase

// Setter-like roles don't need the measure tool — they knock doors.
private let setterRoles: Set<String> = ["canvasser", "setter", "setter_manager"]

struct ContentView: View {
    // nil = role not yet loaded; hide Measure until we know who this is
    @State private var userRole: String? = nil

    var showMeasure: Bool {
        guard let role = userRole else { return false }   // hidden until confirmed
        return !setterRoles.contains(role)
    }

    var body: some View {
        TabView {
            DashboardView(onRoleLoaded: { role in userRole = role })
                .tabItem {
                    Label("Dashboard", systemImage: "chart.bar.fill")
                }

            CanvassView()
                .tabItem {
                    Label("Canvass", systemImage: "map.fill")
                }

            if showMeasure {
                MeasureView()
                    .tabItem {
                        Label("Measure", systemImage: "ruler.fill")
                    }
            }
        }
    }
}

#Preview {
    ContentView()
}
