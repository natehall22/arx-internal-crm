import SwiftUI

extension View {
    /// `presentationDetents` / drag indicator are iOS 16+; keep full-height sheet on iOS 15.
    @ViewBuilder
    func canvassSheetPresentation() -> some View {
        if #available(iOS 16.0, *) {
            self
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        } else {
            self
        }
    }

    @ViewBuilder
    func mediumSheetPresentation() -> some View {
        if #available(iOS 16.0, *) {
            self.presentationDetents([.medium])
        } else {
            self
        }
    }
}
