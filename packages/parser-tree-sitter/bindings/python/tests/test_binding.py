# Copyright (c) 2026, Salesforce, Inc.
# All rights reserved.
# SPDX-License-Identifier: Apache-2.0
# For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0

from unittest import TestCase

from unittest import TestCase

from tree_sitter import Language, Parser
import tree_sitter_agentscript


class TestLanguage(TestCase):
    def test_can_load_grammar(self):
        try:
            Parser(Language(tree_sitter_agentscript.language()))
        except Exception:
            self.fail("Error loading AgentScript grammar")
