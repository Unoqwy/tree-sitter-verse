// swift-tools-version:5.3
import PackageDescription

let package = Package(
    name: "TreeSitterVerse",
    products: [
        .library(name: "TreeSitterVerse", targets: ["TreeSitterVerse"]),
    ],
    dependencies: [
        .package(url: "https://github.com/ChimeHQ/SwiftTreeSitter", from: "0.8.0"),
    ],
    targets: [
        .target(
            name: "TreeSitterVerse",
            dependencies: [],
            path: ".",
            sources: [
                "src/parser.c",
                // NOTE: if your language has an external scanner, add it here.
            ],
            resources: [
                .copy("queries")
            ],
            publicHeadersPath: "bindings/swift",
            cSettings: [.headerSearchPath("src")]
        ),
        .testTarget(
            name: "TreeSitterVerseTests",
            dependencies: [
                "SwiftTreeSitter",
                "TreeSitterVerse",
            ],
            path: "bindings/swift/TreeSitterVerseTests"
        )
    ],
    cLanguageStandard: .c11
)
