import SwiftUI

/// Label + value row for Forms and Lists. Use this instead of `LabeledContent` so we can target iOS 15.
struct FormValueRow: View {
    let label: String
    let value: String
    var valueForeground: Color = .secondary
    var valueWeight: Font.Weight = .regular

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
            Spacer()
            Text(value)
                .foregroundColor(valueForeground)
                .fontWeight(valueWeight)
                .multilineTextAlignment(.trailing)
        }
    }
}
