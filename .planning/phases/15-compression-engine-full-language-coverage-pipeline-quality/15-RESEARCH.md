# Phase 15 Research: Compression Engine — Full Language Coverage + Pipeline Quality

**Researched:** 2026-04-16
**Status:** Complete

---

## Package Availability

The project currently pins `tree-sitter ^0.21.1`. All new grammar packages have a `0.21.x` release available — the pinning strategy is compatible without upgrading the core binding.

| Grammar Package | 0.21.x version | Notes |
|---|---|---|
| `tree-sitter-rust` | 0.21.0 | Available, stable |
| `tree-sitter-cpp` | 0.22.x only (0.22.3) | No 0.21 release — needs `^0.22` or upgrade core to 0.22 |
| `tree-sitter-c-sharp` | 0.21.3 | Available, stable |
| `tree-sitter-java` | 0.21.0 | Available, stable |
| `tree-sitter-ruby` | 0.21.0 | Available, stable |
| `tree-sitter-php` | 0.22.x only (0.22.8) | No 0.21 release — needs `^0.22` or upgrade core |
| `tree-sitter-kotlin` | 0.3.8 (independent versioning) | Community grammar, may have compatibility risk |
| `tree-sitter-swift` | 0.7.1 (independent versioning) | Community grammar, may have compatibility risk |

**Resolution:**
- The tree-sitter Node.js binding uses native addons (node-gyp). Minor version mismatches (0.21 vs 0.22) between the core binding and grammar packages have historically been compatible because the ABI is versioned separately from the npm package version — but this must be verified at install time.
- **Safest approach:** Upgrade `tree-sitter` core to `^0.22.x` in `mesh-core/package.json` (already at 0.25 latest; 0.22 is a good middle ground). This unblocks cpp and php. All 0.21.x grammars will still work under 0.22.x binding.
- **Kotlin and Swift:** Use `safeRequire()` pattern already in place. If they fail to load at runtime, they gracefully fall back to the heuristic path. Test at install time.
- **WASM vs native:** All listed packages use native Node.js bindings (node-gyp), same as the existing grammars. No WASM path needed.

---

## Architecture: Two Files Must Stay In Sync

`tree-sitter-worker.cjs` has its **own hardcoded `require()` calls** for each grammar (lines 15–22). Worker threads do NOT share module scope with the main thread — they are separate V8 isolates. So `treeSitterLanguages` in `compression-core.cjs` is NOT accessible in the worker.

**What this means:** Adding a new grammar requires updating **both** files:
1. `mesh-core/src/compression-core.cjs` — `CODE_LANGUAGE_MAP`, `treeSitterLanguages`, extension entries
2. `mesh-core/src/tree-sitter-worker.cjs` — `safeRequire()` calls, `treeSitterLanguages` object

The worker currently re-implements the entire `buildCodeCapsule` function inline (it's self-contained by design). Adding new grammars only requires adding the `require()` and map entry — the capsule extraction logic is shared via the `parserKey` string passed in the message.

---

## AST Node Types Per Language

These are the tree-sitter node type names to use in the walk for symbol extraction. The existing `buildCodeCapsule` function in the worker walks the tree looking for specific node types — the same patterns apply.

| Language | Function nodes | Class nodes | Method nodes | Other notable |
|---|---|---|---|---|
| **Rust** | `function_item` | `struct_item`, `enum_item`, `trait_item`, `impl_item` | `function_item` (inside impl) | `use_declaration`, `mod_item`, `const_item`, `type_item` |
| **C++** | `function_definition` | `class_specifier`, `struct_specifier` | `function_definition` (inside class) | `namespace_definition`, `template_declaration` |
| **C#** | `method_declaration` | `class_declaration`, `interface_declaration`, `struct_declaration` | `method_declaration` | `namespace_declaration`, `property_declaration`, `constructor_declaration` |
| **Java** | `method_declaration` | `class_declaration`, `interface_declaration`, `enum_declaration` | `method_declaration` | `package_declaration`, `import_declaration`, `constructor_declaration` |
| **Ruby** | `method`, `singleton_method` | `class`, `module` | `method` (inside class) | `constant`, `require`, `attr_accessor` |
| **PHP** | `function_definition` | `class_declaration`, `interface_declaration`, `trait_declaration` | `method_declaration` | `namespace_definition`, `use_declaration` |
| **Kotlin** | `function_declaration` | `class_declaration`, `object_declaration`, `interface_declaration` | `function_declaration` | `property_declaration` |
| **Swift** | `function_declaration` | `class_declaration`, `struct_declaration`, `protocol_declaration`, `extension_declaration` | `function_declaration` | `computed_property`, `init_declaration` |

The existing `buildCodeCapsule` in the worker handles generic node walking — the node type matching is done via string comparison against a known-types set. A single `CODE_NODE_TYPES` set in the worker that covers all languages is the right approach (union of all types across languages). The capsule sections (imports, classes, functions, exports) are populated by matching against this set.

---

## Heuristic Fallback Improvement

The current `buildTextFallbackCapsule` returns a plain-text line-based outline — no symbol extraction. For languages without a tree-sitter grammar (e.g., Fortran, COBOL, assembly, or future additions), the fallback should extract symbol signatures via regex.

**Improved heuristic (`buildHeuristicCodeCapsule`):**

```js
// Matches the most common function/method/class patterns across C-family, scripting, and FP languages
const HEURISTIC_SYMBOL_PATTERNS = [
  // C-family: type name(...) {
  /^[\t ]*(public|private|protected|static|async|export|override|virtual|inline)?\s*([\w:<>*&[\]]+\s+)+(\w+)\s*\([^)]{0,120}\)\s*(\{|;|throws)?/,
  // Python/Ruby/Kotlin: def/fun name(
  /^[\t ]*(def|fun|func)\s+(\w+)\s*\(/,
  // Class declarations
  /^[\t ]*(public|private|abstract|sealed|data|open|final)?\s*(class|struct|interface|trait|enum|protocol|impl|object)\s+(\w+)/,
  // Rust fn
  /^[\t ]*(pub(\(crate\))?\s+)?(async\s+)?fn\s+(\w+)\s*[<(]/,
];
```

For each line matching a pattern, extract: name, line number, type (function/class/method). Cap at `MAX_SYMBOL_DISCOVERY`. This produces a symbol list comparable to (though less precise than) tree-sitter output.

---

## Skip Extension Fix

`src/core/index.js` line 301 — current regex:
```js
const LOCAL_WORKSPACE_SKIP_EXTENSIONS = /\.(png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|eot|mp4|mp3|zip|gz|tar|lock)$/i;
```

**Add:**
- `.wasm` — binary WebAssembly, will corrupt compression pipeline
- Pattern for minified: `*.min.js`, `*.min.css` — not an extension, must use a combined path test

**New regex:**
```js
const LOCAL_WORKSPACE_SKIP_EXTENSIONS = /\.(png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|eot|mp4|mp3|wav|ogg|zip|gz|tar|wasm|map)$/i;
```

**Separate minified check** (in `isWorkspaceIndexablePath`):
```js
if (/\.(min)\.(js|css)$/.test(normalized)) return false;
```

Note: `.map` (source maps) should also be excluded — they are large JSON files with no LLM value.

---

## Test Strategy

**Pattern already in use:** Inline source snippets as multiline strings, assertions on `record.fileType`, `record.capsuleCache.capsule`, symbol presence. No external fixture files.

**Recommended approach for new languages:** Same inline pattern. Each language gets one test:
```js
test("buildWorkspaceFileRecord — Rust: extracts struct and fn symbols", async () => {
  const source = `
pub struct Config { pub name: String }
pub fn load_config(path: &str) -> Config { ... }
  `.trim();
  const record = await buildWorkspaceFileRecord("src/config.rs", source);
  assert.equal(record.fileType, "code/rust");
  assert.equal(record.capsuleCache.capsule.capsuleType, "structure");
  // assert at least one symbol extracted
  const capsuleText = JSON.stringify(record.capsuleCache.capsule);
  assert.ok(capsuleText.includes("load_config") || capsuleText.includes("Config"));
});
```

**Why not fixture files:** The test file already uses inline strings; consistency is more valuable than file organization for test fixtures at this scale. Fixture files add file I/O and path resolution complexity with no real benefit.

---

## Implementation Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| tree-sitter 0.21 binding rejects 0.22 grammar ABI | Medium | Upgrade core binding to ^0.22 first; test install in CI |
| Kotlin/Swift community grammars have parsing bugs | Medium | safeRequire + fallback to heuristic — already the pattern |
| Worker thread memory growth with 15 parsers loaded | Low | Parsers are cached in Map — initialization is one-time, ~2MB per grammar |
| min.js files currently indexed waste capsule budget | Confirmed bug | Fixed by path check in isWorkspaceIndexablePath |
| .wasm files corrupt brotli pipeline | Confirmed bug | Fixed by adding to skip regex |
| C++ parser slow on large template-heavy headers | Low | MAX_TREE_SITTER_SOURCE_BYTES limit (2.5MB) already guards this |

---

## Validation Architecture

Post-implementation checks (all grep-verifiable):

```bash
# 1. New grammars registered in compression-core.cjs
grep -c "tree-sitter-rust\|tree-sitter-cpp\|tree-sitter-c-sharp\|tree-sitter-java\|tree-sitter-ruby\|tree-sitter-php" mesh-core/src/compression-core.cjs
# expect: 12+ (2 occurrences each: require + map entry)

# 2. Same grammars in worker
grep -c "tree-sitter-rust\|tree-sitter-cpp\|tree-sitter-c-sharp" mesh-core/src/tree-sitter-worker.cjs
# expect: 6+

# 3. Skip regex includes wasm
grep "wasm" src/core/index.js
# expect: match

# 4. Min.js check present
grep "min\.\(js\|css\)" src/core/index.js
# expect: match

# 5. Tests pass
node --test test/compression-core.test.js
# expect: all pass, no failures

# 6. New extensions in CODE_LANGUAGE_MAP
node -e "const c=require('./mesh-core/src/compression-core.cjs'); console.log(['rs','cpp','cs','java','rb','php','kt','swift'].map(e=>e+':'+!!c.CODE_LANGUAGE_MAP))"
# (requires exports — or test via buildWorkspaceFileRecord)
```

---

## Implementation Order

1. Upgrade `tree-sitter` core binding in `mesh-core/package.json` to `^0.22`
2. Add grammar packages to `mesh-core/package.json`
3. Run `npm install` in `mesh-core/`
4. Update `compression-core.cjs`: add `safeRequire` calls, extend `CODE_LANGUAGE_MAP`, extend `treeSitterLanguages`
5. Update `tree-sitter-worker.cjs`: mirror same `safeRequire` calls and `treeSitterLanguages` entries
6. Fix `src/core/index.js` skip regex (`.wasm`, `.map`, `.min.js/.css`)
7. Improve heuristic fallback in `compression-core.cjs`
8. Add tests to `test/compression-core.test.js`
9. Run full test suite

## RESEARCH COMPLETE
