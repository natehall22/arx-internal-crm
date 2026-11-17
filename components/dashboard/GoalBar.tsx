/**
 * The dashboard's goal progress bar — ONE component for the classic "Progress vs goals" and every card goal
 * (app/dashboard/DashboardClient.tsx and CardDashboard both draw it). Markup is unchanged from the classic bar;
 * `format` only changes how the two numbers are written (money, percent).
 */
export default function GoalBar({
  label,
  current,
  goal,
  color,
  format,
}: {
  label: string
  current: number
  goal: number
  color: string
  format?: (n: number) => string
}) {
  const percentage = Math.min((current / goal) * 100, 100)
  const isComplete = current >= goal
  const show = format ?? ((n: number) => n)

  return (
    <div className="mb-4">
      <div className="flex justify-between items-center mb-1">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        <span className={`text-sm font-bold ${isComplete ? 'text-green-600' : 'text-gray-600'}`}>
          {show(current)} / {show(goal)}
          {isComplete && ' ✓'}
        </span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color} ${
            isComplete ? 'ring-2 ring-green-400/80 ring-offset-1 ring-offset-white' : ''
          }`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <p className="text-xs text-gray-700 mt-1">
        {percentage.toFixed(0)}% of weekly goal
      </p>
    </div>
  )
}
