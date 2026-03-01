'use client'

export default function PrintButton() {
  return (
    <button
      className="print-btn no-print"
      onClick={() => window.print()}
      style={{
        position: 'fixed',
        top: '20px',
        right: '20px',
        padding: '12px 24px',
        background: '#4f46e5',
        color: 'white',
        border: 'none',
        borderRadius: '8px',
        cursor: 'pointer',
        fontSize: '14px',
      }}
    >
      Print / Save PDF
    </button>
  )
}
