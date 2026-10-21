// swift-tools-version:5.9
// Builds DoseDay's platform-independent logic (DoseDay/Core) so its tests can
// run with `swift test` on macOS or Linux, without Xcode or a simulator.
// The iOS app itself is built from DoseDay.xcodeproj.
import PackageDescription

let package = Package(
    name: "DoseCore",
    platforms: [.macOS(.v13), .iOS(.v17)],
    targets: [
        .target(name: "DoseCore", path: "DoseDay/Core"),
        .testTarget(name: "DoseCoreTests", dependencies: ["DoseCore"], path: "DoseDayTests"),
    ]
)
