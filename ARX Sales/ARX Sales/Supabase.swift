import Foundation
import Supabase

// Shared Supabase client — import this file anywhere you need DB or auth access.
// The anon key is safe to ship in the app; Row Level Security enforces data access.
let supabase = SupabaseClient(
    supabaseURL: URL(string: "https://anzqkklwcgaoeunzpqjh.supabase.co")!,
    supabaseKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFuenFra2x3Y2dhb2V1bnpwcWpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAwODIxNTcsImV4cCI6MjA4NTY1ODE1N30.AFURlQrFsBB9Dya65sUXaCn_xV_ZTqNyx8ThKrnfphA"
)
