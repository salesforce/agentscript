package tree_sitter_agentscript_test

import (
	"testing"

	tree_sitter "github.com/tree-sitter/go-tree-sitter"
	tree_sitter_agentscript "github.com/tree-sitter/tree-sitter-agent_script_awl/bindings/go"
)

func TestCanLoadGrammar(t *testing.T) {
	language := tree_sitter.NewLanguage(tree_sitter_agentscript.Language())
	if language == nil {
		t.Errorf("Error loading AgentScript grammar")
	}
}
