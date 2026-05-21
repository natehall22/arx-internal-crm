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
                // Listen for auth state changes (sign in / sign out / token refresh).
                // `initialSession` is always emitted first — required for restored sessions on cold start.
                for await state in supabase.auth.authStateChanges {
                    switch state.event {
                    case .initialSession, .signedIn, .tokenRefreshed:
                        if let session = state.session {
                            isAuthenticated = !session.isExpired
                        } else {
                            isAuthenticated = false
                        }
                    case .userUpdated:
                        if let session = state.session {
                            isAuthenticated = !session.isExpired
                        } else {
                            isAuthenticated = false
                        }
                    case .signedOut, .userDeleted:
                        isAuthenticated = false
                    case .passwordRecovery, .mfaChallengeVerified:
                        break
                    }
                }
            }
        }
    }
}
