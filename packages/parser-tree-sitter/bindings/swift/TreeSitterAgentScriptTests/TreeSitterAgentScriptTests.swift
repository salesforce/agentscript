import XCTest
import SwiftTreeSitter
import TreeSitterAgentScript

final class TreeSitterAgentScriptTests: XCTestCase {
    func testCanLoadGrammar() throws {
        let parser = Parser()
        let language = Language(language: tree_sitter_agentscript())
        XCTAssertNoThrow(try parser.setLanguage(language),
                         "Error loading AgentScript grammar")
    }
}
