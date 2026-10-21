import SwiftUI

enum MedColor: String, CaseIterable, Identifiable {
    case blue, teal, green, yellow, orange, red, pink, purple, indigo

    var id: String { rawValue }

    var color: Color {
        switch self {
        case .blue: return .blue
        case .teal: return .teal
        case .green: return .green
        case .yellow: return .yellow
        case .orange: return .orange
        case .red: return .red
        case .pink: return .pink
        case .purple: return .purple
        case .indigo: return .indigo
        }
    }

    var name: String { rawValue.capitalized }
}

enum MedSymbol: String, CaseIterable, Identifiable {
    case pills = "pills.fill"
    case pill = "pill.fill"
    case vial = "cross.vial.fill"
    case syringe = "syringe.fill"
    case drop = "drop.fill"
    case bandage = "bandage.fill"
    case heart = "heart.fill"
    case leaf = "leaf.fill"

    var id: String { rawValue }

    var name: String {
        switch self {
        case .pills: return "Pills"
        case .pill: return "Capsule"
        case .vial: return "Vial"
        case .syringe: return "Injection"
        case .drop: return "Drops"
        case .bandage: return "Patch"
        case .heart: return "Heart"
        case .leaf: return "Supplement"
        }
    }
}
