{
  "targets": [
    {
      "target_name": "tree_sitter_agentscript_binding",
      "dependencies": [
        "<!(node -p \"require('node-addon-api').targets\"):node_addon_api_except",
      ],
      "include_dirs": [
        "src",
      ],
      "sources": [
        "bindings/node/binding.cc",
        "src/parser.c",
      ],
      "variables": {
        "has_scanner": "<!(node -p \"fs.existsSync('src/scanner.c')\")"
      },
      "cflags_cc": ["-std=c++20"],
      "xcode_settings": {
        "OTHER_CPLUSPLUSFLAGS": ["-std=c++20", "-stdlib=libc++"],
      },
      "msvs_settings": {
        "VCCLCompilerTool": {
          "AdditionalOptions": ["/std:c++20"],
        },
      },
      "conditions": [
        ["has_scanner=='true'", {
          "sources+": ["src/scanner.c"],
        }],
        ["OS!='win'", {
          "cflags_c": [
            "-std=c11",
          ],
        }, { # OS == "win"
          "cflags_c": [
            "/std:c11",
            "/utf-8",
          ],
        }],
      ],
    }
  ]
}
