export default function LoginPage({
    searchParams,
  }: {
    searchParams: { next?: string; error?: string }
  }) {
    const nextPath = searchParams?.next || '/dashboard'
    const error = searchParams?.error
  
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-xl border bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-semibold">ARX CRM Login</h1>
          <p className="mt-1 text-sm text-gray-600">Sign in to your account.</p>
  
          <form method="POST" action="/login" className="mt-6 space-y-3">
            <input type="hidden" name="next" value={nextPath} />
  
            <div>
              <label className="text-sm font-medium">Email</label>
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2"
                type="email"
                name="email"
                autoComplete="email"
                required
              />
            </div>
  
            <div>
              <label className="text-sm font-medium">Password</label>
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2"
                type="password"
                name="password"
                autoComplete="current-password"
                required
              />
            </div>
  
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}
  
            <button
              type="submit"
              className="w-full rounded-lg bg-black px-4 py-2 text-white"
            >
              Login
            </button>
          </form>
        </div>
      </div>
    )
  }
  