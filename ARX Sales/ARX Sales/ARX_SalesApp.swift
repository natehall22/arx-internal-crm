//
//  ARX_SalesApp.swift
//  ARX Sales
//
//  Created by Nathan Hall on 5/16/26.
//

import SwiftUI
import Supabase

@main
struct ARX_SalesApp: App {
    @State private var isAuthenticated = false

    var body: some Scene {
        WindowGroup {
            Group {
                if isAuthenticated {
                    ContentView()
                } else {
                    AuthView()
                }
            }
            .task {
                // Listen for auth state changes (sign in / sign out / token refresh)
                for await state in await supabase.auth.authStateChanges {
                    isAuthenticated = [.signedIn, .tokenRefreshed].contains(state.event)
                }
            }
        }
    }
}
