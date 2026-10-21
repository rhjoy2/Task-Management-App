import Foundation
import SwiftData

/// A record that one scheduled dose was taken or skipped.
@Model
final class DoseLog {
    /// The time the dose was scheduled for (not when it was logged).
    var scheduledDate: Date = Date.now
    var loggedAt: Date = Date.now
    var statusRaw: String = DoseStatus.taken.rawValue
    var medication: Medication?

    init(scheduledDate: Date, status: DoseStatus, loggedAt: Date = .now) {
        self.scheduledDate = scheduledDate
        self.statusRaw = status.rawValue
        self.loggedAt = loggedAt
    }

    var status: DoseStatus {
        get { DoseStatus(rawValue: statusRaw) ?? .taken }
        set { statusRaw = newValue.rawValue }
    }
}
