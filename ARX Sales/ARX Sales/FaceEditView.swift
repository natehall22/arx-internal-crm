import SwiftUI

// MARK: - Face Edit View
// Allows manual correction of auto-detected faces:
// - Override pitch (roof)
// - Add/remove openings (siding)
// - Delete the face if it's a false detection

struct FaceEditView: View {
    // One of these will be set
    var roofFace: RoofFace? = nil
    var wallFace: WallFace? = nil

    var onSaveRoof: ((RoofFace) -> Void)? = nil
    var onSaveWall: ((WallFace) -> Void)? = nil

    @State private var editedRoof: RoofFace?
    @State private var editedWall: WallFace?
    @State private var showAddOpening = false
    @State private var newOpeningType: OpeningType = .window
    @State private var newOpeningWidth: Double = 3.0
    @State private var newOpeningHeight: Double = 4.0
    @Environment(\.dismiss) private var dismiss

    init(roofFace: RoofFace, onSave: @escaping (RoofFace) -> Void) {
        self.roofFace = roofFace
        self.onSaveRoof = onSave
        _editedRoof = State(initialValue: roofFace)
    }

    init(wallFace: WallFace, onSave: @escaping (WallFace) -> Void) {
        self.wallFace = wallFace
        self.onSaveWall = onSave
        _editedWall = State(initialValue: wallFace)
    }

    var body: some View {
        NavigationView {
            Group {
                if editedRoof != nil {
                    roofEditForm
                } else if editedWall != nil {
                    wallEditForm
                }
            }
            .navigationTitle("Edit Face")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { save() }
                        .fontWeight(.semibold)
                }
            }
        }
    }

    // MARK: - Roof Edit

    private var roofEditForm: some View {
        Form {
            Section("Face Info") {
                if let face = editedRoof {
                    LabeledContent("Detected Area", value: "\(Int(face.areaSqFt)) ft²")
                    LabeledContent("Auto-detected Pitch", value: "\(face.pitchRise)/12")
                    LabeledContent("Facing", value: face.label)
                }
            }

            Section("Override Pitch") {
                Text("If the detected pitch doesn't match the actual roof, select the correct value below.")
                    .font(.caption).foregroundColor(.secondary)
                Picker("Pitch", selection: Binding(
                    get: { editedRoof?.pitchRise ?? 6 },
                    set: { newVal in editedRoof?.pitchRise = newVal }
                )) {
                    ForEach(Array(0...18), id: \.self) { rise in
                        Text("\(rise)/12 — \(pitchDescription(rise))").tag(rise)
                    }
                }
                .pickerStyle(.wheel)
            }

            Section("Face Label") {
                TextField("Label", text: Binding(
                    get: { editedRoof?.label ?? "" },
                    set: { editedRoof?.label = $0 }
                ))
            }

            Section {
                Button(role: .destructive) {
                    // Mark for deletion — caller handles removal
                    dismiss()
                } label: {
                    Label("Remove This Face", systemImage: "trash")
                }
            }
        }
    }

    // MARK: - Wall Edit

    private var wallEditForm: some View {
        Form {
            Section("Face Info") {
                if let face = editedWall {
                    LabeledContent("Gross Area",  value: "\(Int(face.areaSqFt)) ft²")
                    LabeledContent("Net Area",    value: "\(Int(face.netAreaSqFt)) ft²")
                    LabeledContent("Facing",      value: face.label)
                }
            }

            // Openings list
            Section {
                if let wall = editedWall, wall.openings.isEmpty {
                    Text("No openings added yet.")
                        .foregroundColor(.secondary).font(.subheadline)
                } else if let wall = editedWall {
                    ForEach(wall.openings) { opening in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(opening.type.rawValue).font(.subheadline)
                                Text(String(format: "%.1f ft × %.1f ft = %.1f ft²",
                                            opening.widthFt, opening.heightFt, opening.areaSqFt))
                                    .font(.caption).foregroundColor(.secondary)
                            }
                            Spacer()
                            Text("−\(Int(opening.areaSqFt)) ft²")
                                .font(.caption).foregroundColor(.red)
                        }
                    }
                    .onDelete { indices in
                        editedWall?.openings.remove(atOffsets: indices)
                        editedWall?.recalcNet()
                    }
                }
                Button {
                    newOpeningType = .window
                    newOpeningWidth  = OpeningType.window.defaultSize.width
                    newOpeningHeight = OpeningType.window.defaultSize.height
                    showAddOpening = true
                } label: {
                    Label("Add Opening", systemImage: "plus")
                }
            } header: {
                Text("Openings (windows, doors)")
            } footer: {
                if let wall = editedWall, !wall.openings.isEmpty {
                    Text("Total deducted: \(Int(wall.areaSqFt - wall.netAreaSqFt)) ft²")
                }
            }

            Section("Face Label") {
                TextField("Label", text: Binding(
                    get: { editedWall?.label ?? "" },
                    set: { editedWall?.label = $0 }
                ))
            }

            Section {
                Button(role: .destructive) { dismiss() } label: {
                    Label("Remove This Face", systemImage: "trash")
                }
            }
        }
        .sheet(isPresented: $showAddOpening) {
            AddOpeningSheet(
                type: $newOpeningType,
                width: $newOpeningWidth,
                height: $newOpeningHeight
            ) {
                let opening = Opening(type: newOpeningType, widthFt: newOpeningWidth, heightFt: newOpeningHeight)
                editedWall?.openings.append(opening)
                editedWall?.recalcNet()
            }
            .presentationDetents([.medium])
        }
    }

    // MARK: - Save

    private func save() {
        if let face = editedRoof { onSaveRoof?(face) }
        if let face = editedWall { onSaveWall?(face) }
        dismiss()
    }

    private func pitchDescription(_ rise: Int) -> String {
        switch rise {
        case 0...2:   return "Flat"
        case 3...5:   return "Low"
        case 6...9:   return "Standard"
        case 10...12: return "Steep"
        default:      return "Very Steep"
        }
    }
}

// MARK: - Add Opening Sheet

struct AddOpeningSheet: View {
    @Binding var type: OpeningType
    @Binding var width: Double
    @Binding var height: Double
    let onAdd: () -> Void
    @Environment(\.dismiss) private var dismiss

    var area: Double { width * height }

    var body: some View {
        NavigationView {
            Form {
                Section("Type") {
                    Picker("Opening Type", selection: $type) {
                        ForEach([OpeningType.window, .door, .garage, .other], id: \.self) { t in
                            Text(t.rawValue).tag(t)
                        }
                    }
                    .pickerStyle(.segmented)
                    .onChange(of: type) { t in
                        width  = t.defaultSize.width
                        height = t.defaultSize.height
                    }
                }

                Section("Dimensions") {
                    HStack {
                        Text("Width")
                        Spacer()
                        Text(String(format: "%.1f ft", width))
                            .foregroundColor(.secondary)
                    }
                    Slider(value: $width, in: 1...20, step: 0.5)

                    HStack {
                        Text("Height")
                        Spacer()
                        Text(String(format: "%.1f ft", height))
                            .foregroundColor(.secondary)
                    }
                    Slider(value: $height, in: 1...12, step: 0.5)

                    LabeledContent("Area", value: String(format: "%.1f ft²", area))
                        .fontWeight(.semibold)
                }

                Section {
                    Button {
                        onAdd()
                        dismiss()
                    } label: {
                        Text("Add Opening")
                            .fontWeight(.semibold).frame(maxWidth: .infinity).foregroundColor(.white)
                    }
                    .listRowBackground(Color.blue)
                }
            }
            .navigationTitle("Add Opening").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }
}
