# Blog Content Format (BCF) v1

| | |
| --- | --- |
| Status | Normative. Implemented by `@blog/content` (this package). |
| Format version | `1` (this document). There is no version field inside the stored JSON; see [Versioning](#9-versioning-and-forward-compatibility). |
| Storage encoding | UTF-8 JSON (`application/json`), Postgres `jsonb` in `post.content` / `newsletter.content`. |
| Producer | `@scottjgilbert/lexical-blog-editor` 1.1.x on Lexical 0.40 (`JSON.stringify(editorState.toJSON())`). |
| Reference implementation | `packages/content/src` (TypeScript), tests in `packages/content/test`. |

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are used as in RFC 2119.

---

## 1. Overview

BCF is **Lexical's `SerializedEditorState`**, exactly as written by the blog editor, plus rules that make it safe and portable:

* what every node type looks like on the wire and which attributes are required (§3, §4),
* where each node may appear (§5),
* how each node renders to HTML (web), plain text, RSS and e-mail (§6),
* which parts of the content are untrusted and how renderers MUST treat them (§7),
* limits (§8) and forward-compatibility behaviour (§9),
* a guide for implementers in other languages (§11) and the gaps between the standard and the editor package (§12).

Design goals: (1) the editor output is stored untouched and is the single source of truth; (2) rendering never needs a DOM, JavaScript on the client, or the editor package; (3) any renderer, in any language, produces equivalent output; (4) hostile or future content can never crash a renderer or inject markup.

### Conformance classes

| Class | MUST |
| --- | --- |
| **Producer** (editor, importer, seed script) | emit a document that passes strict validation (§2.3). |
| **Store** (API) | run strict validation before saving, reject on *errors*, accept *warnings* (unknown node types), and store the submitted JSON (not a re-serialised tree) so unknown data survives. |
| **Renderer** (web, e-mail, RSS, other) | follow §6 and §7 and never fail on valid or invalid input (§9.3). |

---

## 2. Storage format

### 2.1 Envelope

```json
{ "root": { "type": "root", "version": 1, "children": [ /* nodes */ ], "direction": "ltr", "format": "", "indent": 0 } }
```

* The document is a JSON object with exactly one significant key, `root`. Other top-level keys MUST be ignored (and SHOULD be preserved).
* `root` is a node of type `root` (§4.1). `root.children` is an array of **block** nodes (§5).
* Text encoding is UTF-8. Any Unicode scalar value is allowed in strings. Control characters other than TAB/LF/CR are removed at render time.
* An *empty* document is one root with a single empty paragraph (`emptyContent()`); a root with no children is also valid.
* Storage MAY be a JSON string (the editor's `JSON.stringify` output) or an object. Libraries MUST accept both; stores SHOULD persist the object (`jsonb`).
* `undefined` object properties (a by-product of `editorState.toJSON()` before `JSON.stringify`) are treated as absent. `null` is a value and is only allowed where a node says so.

### 2.2 JSON value rules

* Only JSON types. No `NaN`/`Infinity` (non-finite numbers), functions, symbols, `BigInt`, `Date` or class instances in an in-memory document.
* The key `__proto__` MUST NOT appear anywhere. Parsers MUST NOT use deep-merge/assign on untrusted nodes.
* Documents are trees: a cyclic structure is invalid.

### 2.3 Strict validation vs. tolerant parsing

| | `validateContent` (strict) | `parseContent` (tolerant) |
| --- | --- | --- |
| Use | before **storing** | before **rendering/analysing** |
| Root not `{root:{type:"root",children:[…]}}` | error | warning; result is an empty document, `valid:false` |
| Node not an object / no string `type` | error | node dropped, warning |
| Known node with invalid *required* attribute | error | element: unwrapped (children kept); leaf: dropped; warning |
| Known node with invalid *optional* attribute | error | attribute defaulted, warning-free repair |
| Unknown `type` | **warning** (`unknown-node-type`) | node kept verbatim, warning |
| Misplaced node (§5) | warning (`misplaced-node`) | kept (renderers cope) |
| Newer `version` than known | warning | kept |
| Limit exceeded (§8) | error | subtree dropped / traversal stops, warning |
| Non-finite number, non-JSON value, `__proto__` | error | warning |
| Link/image URL with a *dangerous* scheme (`javascript:`, `vbscript:`, `data:` for links, `file:`, `blob:`) | error | warning; never rendered |
| Link/image URL with any other non-allowlisted scheme (`sms:`, `ftp:`, `about:`…) | warning | warning; never rendered |

Both functions are total: they never throw.

---

## 3. Common fields and data types

### 3.1 Node envelope

Every node is a JSON object:

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| `type` | string | yes | Node type, case-sensitive (§4). |
| `version` | integer ≥ 1 | yes (strict) | Serialisation version of *that node type*. All v1 types are `1`. Tolerant parsing defaults a missing value to `1`. |
| *(type specific)* | | | See §4. Unknown extra properties MUST be preserved and ignored. |

### 3.2 Element nodes (nodes with `children`)

Element nodes add:

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `children` | array of nodes | `[]` | Required array. |
| `direction` | `"ltr"` \| `"rtl"` \| `null` | `null` | Text direction. The editor writes `null` outside a browser and `ltr`/`rtl` inside. Renderers emit `dir="rtl"` only for `"rtl"`. |
| `format` | `""`, `"left"`, `"start"`, `"center"`, `"right"`, `"end"`, `"justify"` (legacy: number) | `""` | Block alignment. `""`, `left`, `start` render as the default; numbers are ignored. |
| `indent` | integer 0…1000 | `0` | Indentation level. Rendered as `indent × 40px` start padding (capped at 20 levels). Ignored for list items (nesting is structural). |

`paragraph` additionally carries `textFormat` (integer) and `textStyle` (string): the formatting of an *empty* paragraph's caret. They are only written when the paragraph has no text children and MUST be ignored for rendering.

### 3.3 Text format bitmask (`text.format`)

`format` is an integer; each bit enables one style. Bits not listed MUST be ignored.

| Bit (value) | Name | HTML (web) | Theme class | E-mail |
| --- | --- | --- | --- | --- |
| 1 | bold | `<strong>` | `ViewerTheme__textBold` | `<strong>` |
| 2 | italic | `<em>` | `ViewerTheme__textItalic` | `<em>` |
| 4 | strikethrough | `<s>` | `ViewerTheme__textStrikethrough` | `<s>` |
| 8 | underline | `<u>` | `ViewerTheme__textUnderline` | `<u>` |
| 4 + 8 | underline + strikethrough | `<s><u>` | `ViewerTheme__textUnderlineStrikethrough` (replaces both single classes) | `<s><u>` |
| 16 | code | `<code>` | `ViewerTheme__textCode` | `<code style="monospace, background, padding">` |
| 32 | subscript | `<sub>` | `ViewerTheme__textSubscript` | `<sub>` |
| 64 | superscript | `<sup>` | `ViewerTheme__textSuperscript` | `<sup>` |
| 128 | highlight | `<mark>` | `ViewerTheme__textHighlight` | `<mark style="background-color:#fff3b0">` |
| 256 | lowercase | `class` only | `ViewerTheme__textLowercase` | `text-transform:lowercase` |
| 512 | uppercase | `class` only | `ViewerTheme__textUppercase` | `text-transform:uppercase` |
| 1024 | capitalize | `class` only | `ViewerTheme__textCapitalize` | `text-transform:capitalize` |

Examples: `3` = bold+italic, `12` = underline+strikethrough, `17` = bold+code.
`code-highlight` nodes ignore `format` (the editor refuses to format code tokens).

**Nesting order (normative, so output is stable and diffable).** Wrapper elements are emitted outermost → innermost in this order: `mark`, `sup`, `sub`, `s`, `u`, `em`, `strong`, `code`. Web: the theme classes and the sanitised style go on the **innermost** element. If no wrapper applies (only a transform bit or only a style), a single `<span>` carries class/style.

### 3.4 Inline style strings (`text.style`, `code-highlight.style`)

`style` is CSS declarations text (`"color: #d0021b; font-size: 18px;"`). It is **untrusted**. Renderers MUST NOT copy it through; they parse it and keep only allowlisted declarations with validated values:

| Property | Accepted values | Notes |
| --- | --- | --- |
| `color`, `background-color` | `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()/rgba()` and `hsl()/hsla()` with plain numeric arguments, `transparent`, `currentcolor`, a bare colour keyword (`[a-z]{3,24}`, excluding `inherit initial unset revert expression url var env`) | ≤ 64 chars |
| `font-size` | `<number>px|pt|em|rem|%`, `0 < n ≤ 400` (px/pt), `≤ 20` (em/rem), `≤ 500` (%) | normalised to lowercase unit |
| `font-family` | ≤ 8 comma separated names matching `[A-Za-z0-9 _.-]{1,60}`, optionally quoted; generic families (`serif`, `sans-serif`, `monospace`, …) | re-emitted with single quotes around non-generic names |
| `text-align` | `left right center justify start end` | the editor stores alignment on elements; accepted for hand-written content |

For `code-highlight` tokens the allowlist is `color`, `background-color`, `font-style` (`normal|italic|oblique`), `font-weight` (`normal|bold|100…900`), `text-decoration` (`none|underline|line-through`).

Any value containing `\ < > { } @ /* */ url( expression( javascript: var( env( calc( attr( image( !important` or a control character is rejected regardless of property. Later declarations of the same property win. Output order is the allowlist order above.

The editor produces: `color: …`, `background-color: …`, `font-size: Npx` (10–20), `font-family: <one of Arial, Courier New, Georgia, Times New Roman, Trebuchet MS, Verdana>`, and for Shiki code tokens `color: #…` (see §12).

---

## 4. Node reference

Notation: **R** = required, **O** = optional. "Produced by" says whether the current editor package can emit the node (§12 has details). HTML shown is the **web** target; other targets are summarised in §6.3.

Index:
[root](#41-root) · [paragraph](#42-paragraph) · [text](#43-text) · [linebreak](#44-linebreak) · [tab](#45-tab) · [heading](#46-heading) · [quote](#47-quote) · [list](#48-list) · [listitem](#49-listitem) · [link](#410-link) · [autolink](#411-autolink) · [code](#412-code) · [code-highlight](#413-code-highlight) · [horizontalrule](#414-horizontalrule) · [table](#415-table) · [tablerow](#416-tablerow) · [tablecell](#417-tablecell) · [hashtag](#418-hashtag) · [mark](#419-mark) · [overflow](#420-overflow) · [image](#421-image) · [equation](#422-equation) · [emoji](#423-emoji) · [mention](#424-mention) · [keyword](#425-keyword) · [specialText](#426-specialtext) · [youtube](#427-youtube) · [tweet](#428-tweet) · [figma](#429-figma) · [layout-container / layout-item](#430-layout-container-and-layout-item) · [collapsible-container / -title / -content](#431-collapsible-container-collapsible-title-collapsible-content) · [datetime](#432-datetime) · [page-break](#433-page-break-extension)

### 4.1 `root`

Produced by: Lexical core. Element. Fields: §3.2 only. Parents: none. Children: block nodes (stray inline nodes are tolerated: renderers wrap consecutive inline nodes in an implicit paragraph).
Renders: its children, no wrapper. Plain text: blocks separated by a blank line.

### 4.2 `paragraph`

Produced by: Lexical core. Element, fields §3.2 + `textFormat`, `textStyle` (ignored). Children: inline nodes. Parents: root, tablecell, layout-item, collapsible-content.

* HTML: `<p class="ViewerTheme__paragraph" [dir] [style="text-align:…;padding-inline-start:…"]>…</p>`. An empty paragraph renders `<br>` inside the `<p>` (the editor's empty line).
* If a paragraph contains a **block-level** child (an image with caption → `<figure>`, a block equation, an embed), it is rendered as `<div role="paragraph" class="ViewerTheme__paragraph">` because `<figure>`/`<div>` inside `<p>` is invalid HTML. This is what the editor's own HTML export does.
* E-mail: `<p style="margin:0 0 16px 0;line-height:1.6">` (`margin:0 0 4px` inside table cells).

```json
{ "type": "paragraph", "version": 1, "children": [ { "type": "text", "version": 1, "text": "Hello", "format": 0, "style": "", "mode": "normal", "detail": 0 } ],
  "direction": "ltr", "format": "center", "indent": 0, "textFormat": 0, "textStyle": "" }
```

### 4.3 `text`

Produced by: Lexical core. Leaf.

| Field | Type | Req | Default | Notes |
| --- | --- | --- | --- | --- |
| `text` | string ≤ 100 000 | **R** | | Never contains newlines for editor content; a renderer converts `\n` to `<br>` if present. |
| `format` | integer ≥ 0 | O | `0` | Bitmask, §3.3. |
| `style` | string ≤ 2000 | O | `""` | §3.4. |
| `mode` | `normal`\|`token`\|`segmented` | O | `normal` | Editing behaviour only; ignored. |
| `detail` | integer | O | `0` | Editing behaviour only; ignored. |

HTML: escaped text; formatting per §3.3. Runs of two or more spaces are emitted as alternating `&nbsp;` + space so whitespace survives without `white-space: pre-wrap`. Plain text: the text verbatim.

### 4.4 `linebreak`

Leaf, no fields. HTML `<br>`. Plain text `\n`.

### 4.5 `tab`

Produced by: Lexical core (Tab key). Leaf: `text` is `"\t"`, `detail: 2`, `mode: "normal"`. HTML: `<span class="ViewerTheme__tabNode" style="white-space:pre">⇥</span>` (web), `&emsp;` (e-mail/RSS). Inside `code`: a literal TAB. Plain text: `\t`.

### 4.6 `heading`

Produced by: `@lexical/rich-text`. Element. **R** `tag`: `h1`…`h6`. Children: inline. Fields §3.2.

* HTML: `<hN id="<slug>" class="ViewerTheme__hN" …>…</hN>`; the `id` rule is normative in §6.6 and MUST equal the TOC entry id.
* E-mail: no `id`; inline size/weight per level (28/24/20/18/16/14 px). RSS: bare `<hN>`.
* An invalid `tag` makes the node invalid: it is unwrapped (children inline) in tolerant mode.

### 4.7 `quote`

Produced by: `@lexical/rich-text`. Element, children inline (the editor does not nest blocks in a quote). HTML `<blockquote class="ViewerTheme__quote">…</blockquote>`; e-mail: left border + muted colour.

### 4.8 `list`

Produced by: `@lexical/list`. Element. Children: `listitem` (only).

| Field | Type | Req | Default | Notes |
| --- | --- | --- | --- | --- |
| `listType` | `bullet`\|`number`\|`check` | O | `bullet` | Authoritative. |
| `start` | integer ≥ 0 | O | `1` | First number of an ordered list. |
| `tag` | `ul`\|`ol` | O | derived | Informational. Renderers derive it from `listType` (`number` → `ol`, else `ul`) and ignore the stored value. |

* HTML: bullet `<ul class="ViewerTheme__ul">`; number `<ol class="ViewerTheme__olN">` where `N = min(listNestingDepth, 5)` (1 for a top-level list; **nesting depth counts `ul` and `ol` alike**, matching the editor); check `<ul class="ViewerTheme__ul ViewerTheme__checklist">`. `start != 1` → `start="n"`.
* Ordered lists give each content item an explicit `value="n"` (counting only items that carry content) because nested-list wrapper items would otherwise consume numbers.

### 4.9 `listitem`

Element. Children: inline nodes and/or `list` (nested).

| Field | Type | Req | Default | Notes |
| --- | --- | --- | --- | --- |
| `value` | integer | O | `1` | Position hint. Ignored by renderers (they count). |
| `checked` | boolean | O | | Only meaningful when the parent `list` has `listType: "check"`. |

**Nested lists.** The editor expresses nesting as a sibling `listitem` whose only child is a `list` (and `indent: n`). Renderers detect "all children are lists" and emit `<li class="ViewerTheme__listItem ViewerTheme__nestedListItem">` wrapping the child list; that item is not numbered. A `listitem` mixing text and a list renders both in order.

* HTML: `<li class="ViewerTheme__listItem">…</li>`; in a checklist additionally `ViewerTheme__listItemChecked` / `ViewerTheme__listItemUnchecked` and a visually hidden `<span class="bcf-sr-only">Completed: </span>` / `Not completed: ` prefix. Renderers MUST NOT add `role="checkbox"` to `<li>` (it breaks list semantics); the visual box comes from the theme's CSS.
* E-mail / RSS: `☑ ` / `☐ ` (`&#9745;`/`&#9744;`) prefix and `list-style-type:none`.
* Plain text: one line per item (nested items on their own lines); markers `- `, `1. `, `[x] `, `[ ] ` only when requested.

### 4.10 `link`

Produced by: `@lexical/link`. Element, children inline.

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| `url` | string ≤ 4096 | **R** | Untrusted; §7.2. |
| `rel`, `target`, `title` | string \| null | O | `rel` and `target` are **ignored** (the renderer decides, below). `title` ≤ 500 chars is emitted. |

* Allowed after sanitising: `http`, `https`, `mailto`, `tel`, same-site relative references (`/x`, `x/y`, `./x`, `../x`, `?q`, `#frag`), `//host` (upgraded to `https://host`), and bare `www.host…` (upgraded to `https://www.host…`).
* **External** = absolute `http(s)` URL whose origin differs from `baseUrl` (every absolute URL when no `baseUrl` is given). Web: `target="_blank" rel="noopener noreferrer nofollow"`. RSS: `rel="noopener noreferrer nofollow"`. E-mail: neither. Internal/relative/`mailto`/`tel`: neither.
* HTML: `<a href="…" [title] [target rel] class="ViewerTheme__link">…</a>`; e-mail `style="color:#216fdb;text-decoration:underline"`.
* If the URL is rejected the **children are rendered as plain text** (the link wrapper is dropped) and a warning is raised. A link with no visible children renders nothing.
* RSS/e-mail with `baseUrl`: relative URLs become absolute.

### 4.11 `autolink`

Produced by: `@lexical/link` (URLs typed in the editor). Same as `link` plus `isUnlinked: boolean` (default `false`). `isUnlinked: true` means the author removed the link: render the children as plain text.

### 4.12 `code`

Produced by: the editor package's own `CodeNode` (Shiki based). Element. Children: `code-highlight`, `text`, `tab`, `linebreak`. A code block is a **flat** list of tokens; lines are separated by `linebreak` nodes.

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| `language` | string ≤ 64 \| null | O | Emitted as `data-language` only if it matches `[A-Za-z0-9_+#.-]{1,32}`. |
| `theme` | string \| null | O | Shiki theme the token colours were computed for (`one-light` by default). Informational. |

HTML (web): `<pre class="ViewerTheme__code" spellcheck="false" tabindex="0" data-language="ts" data-gutter="1&#10;2&#10;3">…tokens… <br> …tokens…</pre>`.
`data-gutter` is the line-number column that `ViewerTheme.css` renders with `content: attr(data-gutter)`: the numbers `1…n` (n = number of `linebreak` + 1) joined by newlines (encode as `&#10;`). `tabindex="0"` makes the scrollable block keyboard reachable. Line breaks are `<br>` (as in the editor's export) and `tab` is a literal TAB.
E-mail: `<pre data-language style="…monospace, background, white-space:pre-wrap…">`. RSS: `<pre data-language="ts">` with plain escaped text and no token spans.
Server-side syntax highlighting is **not** performed: the stored tokens already carry colours/types. Content without tokens (plain `text` children, e.g. from `markdownToContent`) renders as unhighlighted code.

### 4.13 `code-highlight`

Leaf token inside `code`. Fields: `text` (R string), `highlightType` (O string; Prism-style type such as `keyword`, `string`, `comment`, `number`, `operator`, `punctuation`, `function`…; absent for Shiki tokens), `style` (O, §3.4 code-token allowlist; Shiki puts the token colour here, e.g. `color: #4078f2;`), `format`/`mode`/`detail` (ignored).
HTML: `<span class="ViewerTheme__token…" [style]>text</span>` using the theme's `codeHighlight` map (`keyword`→`tokenAttr`, `string`→`tokenSelector`, `number`→`tokenProperty`, `comment`→`tokenComment`, `operator`→`tokenOperator`, `function`→`tokenFunction`, `punctuation`→`tokenPunctuation`, `variable`→`tokenVariable`, …; the full map is `VIEWER_THEME_CLASSES.codeHighlight`). Unknown types get no class. A token without class or style is emitted as bare escaped text. Outside a `code` parent it renders as ordinary text.

### 4.14 `horizontalrule`

Produced by: `@lexical/extension`. Leaf. HTML `<hr class="ViewerTheme__hr">` (the editor's own export forgets the class, §12). E-mail `<hr style="border:none;border-top:1px solid #ccc;margin:24px 0">`. RSS `<hr>`. Plain text: nothing.

### 4.15 `table`

Produced by: `@lexical/table`. Element. Children: `tablerow`.

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| `colWidths` | array of positive numbers (px) | O | One per column. **All-or-nothing**: if any entry is invalid the whole array is ignored (a partial list would shift columns). |
| `rowStriping` | boolean | O | Adds `ViewerTheme__tableRowStriping`. |
| `frozenRowCount`, `frozenColumnCount` | integer | O | **Not rendered** (sticky headers inside a scroll wrapper are not reliable). Preserved. |
| `format` | `center`\|`right` | O | Table alignment: `ViewerTheme__tableAlignmentCenter` / `…Right` on the `<table>`. |

HTML (web):

```html
<div class="ViewerTheme__tableScrollableWrapper" tabindex="0">
  <table class="ViewerTheme__table [ViewerTheme__tableRowStriping]">
    <colgroup><col style="width:120px">…</colgroup>
    <tbody><tr>…</tr></tbody>
  </table>
</div>
```

The scroll wrapper is mandatory on web (320 px reflow); the editor's own export omits it. A table without rows renders nothing. E-mail: `<table style="border-collapse:collapse;width:100%">`, no wrapper/colgroup. RSS: bare table.

### 4.16 `tablerow`

Element. Children: `tablecell`. Optional `height` (positive number, px) → `style="height:Npx"` (web/e-mail).

### 4.17 `tablecell`

Element. Children: **blocks** (paragraphs, lists, images…).

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `headerState` | bitmask 0–3 | `0` | `1` = header **row** cell (labels its column), `2` = header **column** cell (labels its row), `3` = both. Non-zero → `<th>`, else `<td>`. `scope="row"` iff the value is exactly `2`, otherwise `scope="col"`. |
| `colSpan`, `rowSpan` | integer 1–1000 | `1` | Emitted as `colspan`/`rowspan` when > 1. |
| `width` | positive number (px) \| null | | `width:Npx`. |
| `backgroundColor` | string \| null | | Emitted as `background-color` only if it passes the colour validator (§3.4). |
| `verticalAlign` | `top`\|`middle`\|`bottom` \| null | `top` | `vertical-align` emitted for `middle`/`bottom`. |

HTML: `<td class="ViewerTheme__tableCell" …>` / `<th class="ViewerTheme__tableCell ViewerTheme__tableCellHeader" scope="col" …>`; empty cells contain `<br>`. E-mail: inline border/padding/background (header: `#f2f3f5` + bold).

### 4.18 `hashtag`

Produced by: `@lexical/hashtag` (any `#word` typed). Text-like leaf (`text`, optional `format`/`style`). HTML `<span class="ViewerTheme__hashtag">#tag</span>`. E-mail/RSS: plain text. There is no tag page; the node is presentational.

### 4.19 `mark`

Produced by: `@lexical/mark` (comment/annotation anchors). Element, children inline, `ids: string[]`. **Transparent**: renders its children only. Never emitted by the current editor UI.

### 4.20 `overflow`

Produced by: `@lexical/overflow` (character-limit overflow marker). Element, children inline. **Transparent**. Never emitted by the current editor UI.

### 4.21 `image`

Produced by: the editor package (`ImageNode`). Decorator, **inline** (the editor wraps it in a paragraph).

| Field | Type | Req | Default | Notes |
| --- | --- | --- | --- | --- |
| `src` | string | **R** | | `http(s)` URL, relative URL, or an inline raster `data:image/{png,jpeg,gif,webp,avif};base64,…` (web only). SVG/other `data:` types are rejected. |
| `altText` | string ≤ 2000 | O | `""` | `alt` attribute. Empty alt marks the image decorative. |
| `width`, `height` | number ≥ 0 | O | `0` | Pixels; `0` = natural size. Emitted as `width`/`height` attributes (rounded) only when > 0. |
| `maxWidth` | number | O | `500` | Editing hint. Ignored. |
| `showCaption` | boolean | O | `false` | Caption is rendered only when `true` **and** the caption has text. |
| `caption` | `{ "editorState": { "root": <root> } }` | O | | A nested serialised editor (root → paragraphs; nodes limited to text, linebreak, paragraph, link, emoji, hashtag, keyword). Parsed recursively and counted toward the depth/node limits. |

HTML (web): `<img src alt [width height] loading="lazy" decoding="async" style="max-width:100%;height:auto" class="bcf-image">`. With a caption: `<figure class="bcf-figure"><img …><figcaption>…</figcaption></figure>`, and a parent `paragraph` becomes `<div role="paragraph">` (§4.2). A single caption paragraph is unwrapped to its inline children.
E-mail: `<img … style="display:inline-block;max-width:100%;height:auto;border:0">` (no `loading`); caption as `<div style="…">` under it (no `<figure>`). RSS: `<img>`/`<figure>`.
A rejected `src` renders the alt text only. `data:` images are dropped for e-mail and RSS (clients block them). Plain text: alt text, then the caption text.

### 4.22 `equation`

Produced by: the editor package (`EquationNode`). Decorator.

| Field | Type | Req | Default | Notes |
| --- | --- | --- | --- | --- |
| `equation` | string ≤ 10 000 | **R** | | LaTeX source (KaTeX subset). |
| `inline` | boolean | O | `false` | `false` = display equation, a block node at root level. |

HTML (web): server-side `katex.renderToString(equation, { displayMode: !inline, throwOnError: false, trust: false, strict: "ignore", output: "htmlAndMathml", maxSize: 50, maxExpand: 1000 })` wrapped in `<span class="bcf-equation">` (inline) or `<div class="bcf-equation bcf-equation--block">`. Requires `katex/dist/katex.min.css` on the page. Output includes MathML (accessible) plus `aria-hidden` HTML.
E-mail / RSS: the LaTeX source in `<code>` (block: in a paragraph). KaTeX failure also falls back to `<code>`. Plain text: the LaTeX source.

### 4.23 `emoji`

Produced by: the editor package (`:)`, `:D`, `:(`, `<3` shortcuts and the emoji picker). Text-like leaf (`text` is the emoji glyph, `mode: "token"`) plus `className` (string; editor values like `"emoji happysmile"`). **`className` is never emitted** (the editor's CSS for it is not part of the viewer theme and would hide the glyph). HTML: `<span class="bcf-emoji">🙂</span>`; e-mail/RSS: the glyph as text.

### 4.24 `mention`

Text-like leaf, `mentionName` (string). HTML: `<span class="bcf-mention" data-mention="name">text</span>`; elsewhere plain text. Never emitted by the current editor UI.

### 4.25 `keyword`

Text-like leaf. The editor highlights a few keywords (e.g. "congrats"). HTML: `<span class="keyword">…</span>`; elsewhere plain text.

### 4.26 `specialText`

Text-like leaf (`[text]` highlighter). HTML: `<span class="ViewerTheme__specialText">…</span>`; elsewhere plain text. Never emitted by the current editor UI.

### 4.27 `youtube`

Produced by: the editor package (paste/insert a YouTube URL). Decorator **block**.

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| `videoID` | string | **R** | MUST match `^[A-Za-z0-9_-]{6,32}$` (the editor only emits 11-character ids). |
| `format` | alignment string | O | Block alignment → `text-align` on the wrapper. |

Web (`embeds: "iframe"`, default): `<div class="bcf-embed bcf-embed--youtube"><iframe src="https://www.youtube-nocookie.com/embed/<id>" title="YouTube video player" width="560" height="315" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen allow="…" sandbox="…" style="width:100%;max-width:560px;aspect-ratio:16/9;height:auto;border:0"></iframe></div>`. The `src` is built by the renderer from the validated id, never copied from content, and verified against the host allowlist (§7.3).
Web with `embeds: "link"`, RSS: `<p><a href="https://www.youtube.com/watch?v=<id>">Watch on YouTube</a></p>`. E-mail: the same link wrapping the thumbnail `https://img.youtube.com/vi/<id>/hqdefault.jpg`. Plain text: nothing (or the watch URL when `embedUrls` is set).

### 4.28 `tweet`

Decorator **block**. **R** `id` (string, `^\d{1,25}$`), O `format`. Web iframe: `https://platform.twitter.com/embed/Tweet.html?dnt=true&id=<id>`, title `Embedded post on X`, fixed 550×500 box (no layout shift). Link fallback `https://x.com/i/web/status/<id>` ("View post on X").

### 4.29 `figma`

Decorator **block**. **R** `documentID` (string, `^[A-Za-z0-9_-]{6,64}$`; the editor only emits 22–128 alphanumerics), O `format`. Web iframe: `https://www.figma.com/embed?embed_host=bcf&url=<urlencoded https://www.figma.com/file/<id>>`, title `Figma embed`, 16:9. Link fallback `https://www.figma.com/file/<id>` ("View the Figma file").

### 4.30 `layout-container` and `layout-item`

Produced by: the editor package (column layouts). `layout-container` element, **R-ish** `templateColumns` (string ≤ 200, e.g. `"1fr 1fr"`, `"1fr 3fr"`, `"1fr 2fr 1fr"`, `"1fr 1fr 1fr 1fr"`; default `""`). Children: `layout-item` only. `layout-item` element, children: blocks. Both are shadow roots in the editor (each column is an independent block container).

* `templateColumns` is validated: after removing the tokens `fr px em rem vw auto min-content max-content minmax repeat fit-content` only digits, whitespace, `.`, `,`, `(`, `)`, `%`, `-` may remain, parentheses must balance, ≤ 120 chars. Invalid/empty → `repeat(<itemCount>, 1fr)`.
* Web: `<div class="ViewerTheme__layoutContainer" style="grid-template-columns:1fr 2fr" data-lexical-layout-container="true"><div class="ViewerTheme__layoutItem" data-lexical-layout-item="true">…blocks…</div>…</div>`. `bcf.css` stacks the columns below 640 px.
* E-mail: `<table role="presentation" width="100%">` with one `<td valign="top">` per item; widths are percentages derived from `fr` ratios (equal when not all tracks are `fr`). RSS: one `<div>` per item, sequential.
* Plain text: items in order, blocks separated by blank lines.

### 4.31 `collapsible-container`, `collapsible-title`, `collapsible-content`

Produced by: the editor package (collapsible sections). `collapsible-container` element, `open` boolean (default `true`), children: exactly one `collapsible-title` then one `collapsible-content`. `collapsible-title`: element, children inline. `collapsible-content`: element, children blocks.

* Web: `<details class="Collapsible__container" [open]><summary class="Collapsible__title">…</summary><div class="Collapsible__content" data-lexical-collapsible-content="true">…blocks…</div></details>`. A missing title renders `<summary>Details</summary>`; unexpected extra children are rendered inside the content area. `bcf.css` supplies the `Collapsible__*` rules (they are not part of `ViewerTheme.css`).
* E-mail/RSS: `<details>` is not reliable in mail clients: the title becomes a bold line and the content is **always shown expanded** (`<div style="border:1px solid #e5e7eb;border-radius:8px;padding:8px 12px">` in e-mail).
* Plain text: title, then content.

### 4.32 `datetime`

Produced by: the editor package (date/time picker). Decorator **inline**. Note the type string is `datetime` (no hyphen).

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| `dateTime` | string | **R** | ISO-8601 instant as produced by `Date#toISOString()` (`2024-05-06T07:08:00.000Z`). The editor stores this *flat* on the node (Lexical node state, `flat: true`). Must be parseable by `Date.parse`. |

HTML: `<time class="bcf-datetime" datetime="2024-05-06T07:08:00.000Z">May 6, 2024 07:08 UTC</time>`. The label is deterministic and locale-free: `Mon D, YYYY`, plus ` HH:MM UTC` when the UTC time is not 00:00. (The author's timezone is not stored; the editor only keeps the instant.) Unparseable values are dropped with a warning. E-mail/RSS: `<time datetime>` without class. Plain text: the same label.

### 4.33 `page-break` (extension)

Defined by BCF, **not emitted by the editor package** (Lexical Playground's `PageBreakNode` type name). Leaf, no fields. Web: `<hr class="bcf-page-break" aria-hidden="true">` (dashed on screen, `break-after: page` in print). E-mail/RSS: `<hr>`. Plain text: nothing.

---

## 5. Content model

Classification used for placement checks and for the implicit paragraph rule:

| Class | Types |
| --- | --- |
| **Block** | paragraph, heading, quote, list, code, horizontalrule, page-break, table, equation (`inline:false`), youtube, tweet, figma, layout-container, collapsible-container |
| **Inline** | text, linebreak, tab, hashtag, keyword, specialText, mention, emoji, code-highlight, link, autolink, mark, overflow, image, datetime, equation (`inline:true`) |
| **Structural** | root, listitem, tablerow, tablecell, layout-item, collapsible-title, collapsible-content |

Allowed children:

| Parent | Children |
| --- | --- |
| root | block |
| paragraph, heading, quote, link, autolink, mark, overflow, collapsible-title | inline |
| code | code-highlight, text, tab, linebreak |
| list | listitem |
| listitem | inline, list |
| table → tablerow → tablecell | tablerow → tablecell → block |
| layout-container → layout-item | layout-item → block |
| collapsible-container | collapsible-title, collapsible-content |
| collapsible-content | block |
| image caption root | paragraph (limited inline set) |

Violations are *warnings* (`misplaced-node`), not errors. Renderers MUST still render the content: inline nodes in block position are grouped into an implicit `<p>`; block nodes in inline position are rendered as blocks; stray structural nodes render their children.

---

## 6. Rendering

### 6.1 Targets

| Target | For | Output |
| --- | --- | --- |
| `web` | public site, admin preview | Class names of the editor's `ViewerTheme.css`, allowlisted inline styles, `<details>`, lazy iframes, KaTeX. Zero client JavaScript. |
| `email` | newsletters (listmonk campaign HTML) | **No dependence on classes or `<style>`**: every element carries the inline styles it needs; layout via tables; no iframes/details/scripts/KaTeX; URLs absolute; wrap in a 600 px table (`wrapEmailHtml`). |
| `rss` | `feed.xml`, full-content `<content:encoded>` | Semantic HTML, no classes, no `id`s, no inline styles (except `max-width` on images), absolute URLs, no scripts/iframes. |

Output is an HTML **fragment** (no `<html>`/`<body>`). For `web`, wrap it in a container of your choice; the class names are global.

### 6.2 General rules (all targets)

1. **Escape everything.** All text and attribute values go through HTML escaping of `& < > " ' \`` and control-character stripping.
2. **Never trust URLs, styles, class names or ids from content** (§7). URLs: §4.10. Styles: §3.4. No class name or id comes from content; the only content-derived id is a slug of heading text (§6.6).
3. **Unknown nodes are skipped** (with a warning); `unknown: "unwrap"` is an opt-in that renders their children/text.
4. **No target ever emits** `<script>`, `<style>`, `<link>`, `<object>`, `<embed>`, `<form>`, event-handler attributes or `javascript:`/`data:` (except raster image data URIs on web).
5. Renderers MUST be pure functions of (document, options).

### 6.3 Per-node target matrix

| Node | web | email | rss | plain text |
| --- | --- | --- | --- | --- |
| paragraph | `<p class>` | `<p style>` | `<p>` | block |
| heading | `<hN id class>` | `<hN style>` | `<hN>` | block |
| quote | `<blockquote class>` | `<blockquote style>` | `<blockquote>` | block |
| list / listitem | `ul/ol/li` + classes | `ul/ol/li` + styles, check glyphs | `ul/ol/li`, check glyphs | one line per item |
| link / autolink | `<a>` (+ `target`/`rel` if external) | `<a style>` | `<a rel>` | link text |
| code | `<pre class data-gutter>` + token spans | `<pre style>` + token spans | `<pre>` text | verbatim |
| table | scroll wrapper + `<table class>` | `<table style>` | `<table>` | rows `a \| b` |
| image | `<img>` / `<figure>` | `<img style>` / `<div>` caption | `<img>` / `<figure>` | alt + caption |
| equation | KaTeX | `<code>` LaTeX | `<code>` LaTeX | LaTeX |
| youtube / tweet / figma | lazy iframe (or link) | link (YouTube: thumbnail) | link | – |
| layout | CSS grid | presentation table | sequential `<div>`s | in order |
| collapsible | `<details>` | expanded block | expanded block | title + content |
| datetime | `<time class>` | `<time>` | `<time>` | label |
| hr / page-break | `<hr class>` | `<hr style>` | `<hr>` | – |
| hashtag / keyword / specialText / mention / emoji | `<span class>` | text | text | text |
| mark / overflow | transparent | transparent | transparent | transparent |
| unknown | skipped | skipped | skipped | skipped |

### 6.4 Class names and required CSS (web)

Web output uses exactly the class names the editor package defines in its theme object (`build/themes/ViewerTheme.js`), so the package's stylesheet styles it:

```ts
import "@scottjgilbert/lexical-blog-editor/styles/ViewerTheme.css"; // paragraph, headings h1-h3, lists, quote, code, tables, links, layout, …
import "@blog/content/styles.css";                                   // companion rules for everything ViewerTheme.css lacks
import "katex/dist/katex.min.css";                                   // only needed on pages that contain equations
```

`@blog/content/styles.css` (this package, `styles/bcf.css`) styles: `bcf-sr-only`, `bcf-image`/`bcf-figure`, `bcf-embed*`, `Collapsible__*`, `bcf-equation*`, `bcf-datetime`, `bcf-mention`, `keyword`, `bcf-emoji`, `bcf-page-break`, `h4`–`h6`, responsive stacking of layout columns, focus rings, dark-mode variables (`--bcf-muted`, `--bcf-border`, `--bcf-surface`, `--bcf-pill`, `--bcf-accent`, `--bcf-focus`).
`ViewerThemeComplete.css` (a heavier editorial theme in the package) also works with this output; it defines the same selectors.
The site's CSP must allow `frame-src https://www.youtube-nocookie.com https://www.figma.com https://platform.twitter.com`, and `img-src data:` only if inline images are tolerated.

Theme classes used: `ViewerTheme__` + `paragraph`, `quote`, `h1`…`h6`, `textBold/Italic/Underline/Strikethrough/UnderlineStrikethrough/Code/Highlight/Subscript/Superscript/Lowercase/Uppercase/Capitalize`, `tabNode`, `link`, `hashtag`, `specialText`, `hr`, `code`, `token*`, `ul`, `ol1…ol5`, `checklist`, `listItem`, `listItemChecked`, `listItemUnchecked`, `nestedListItem`, `table`, `tableScrollableWrapper`, `tableCell`, `tableCellHeader`, `tableRowStriping`, `tableAlignmentCenter/Right`, `layoutContainer`, `layoutItem`.

### 6.5 Plain text (`toPlainText`)

Normative algorithm (so search indexes, excerpts and reading time agree across implementations):

1. Walk the root's children in order. Each block yields one entry; blocks are joined with `"\n\n"`.
2. `paragraph`, `quote`, `heading`: inline text (text, hashtag, keyword, specialText, mention, emoji, tab → `\t`, linebreak → `\n`, equation → LaTeX, datetime → label, link/autolink/mark/overflow → their children). Entries that are blank after trimming are dropped.
3. `image` (inline or block): `altText`, then, if `showCaption`, the caption text as a following entry.
4. `code`: the tokens verbatim, `linebreak` → `\n`.
5. `list`: one line per item with content (nested items on their own lines, in order), lines of one list joined by `"\n"`. Optional markers `- `, `N. `, `[x] `/`[ ] ` (two-space indent per level).
6. `table`: one line per non-empty row, cell texts (whitespace-collapsed) joined by `" | "`; rows joined by `"\n"`.
7. `layout-*`, `collapsible-*`: children in order (title before content).
8. `equation` (block): LaTeX. `horizontalrule`, `page-break`, `youtube`, `tweet`, `figma` (unless `embedUrls`), unknown nodes: nothing.

`toExcerpt(max=200)`: plain text **without headings** (falls back to all text if there is none), whitespace collapsed to single spaces, trimmed. If longer than `max` code points: cut at `max-1` code points; if the cut falls inside a word, back up to the previous whitespace when that keeps more than 50 % of the budget; strip trailing whitespace and `, ; : - – — ( [ { " ' “ ‘`; append `…` (U+2026). The result is ≤ `max` code points. Never splits surrogate pairs.

`readingMinutes(wpm=220)`: `max(1, ceil(words / wpm))` where words are matches of `[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*` in the plain text, plus `ceil(cjkChars / 2)` for Han/Kana/Hangul characters (which are not counted as latin words).

### 6.6 Heading ids and the table of contents

* Walk **all** headings in document order (including headings inside layouts, collapsibles and table cells; **not** inside image captions).
* `text` = plain text of the heading's inline children with whitespace collapsed to single spaces and trimmed.
* `slugify(text)`: Unicode NFKD → drop combining marks (U+0300–U+036F) → lowercase → `&` becomes ` and ` → drop `'`, `’`, `` ` `` → every run of characters outside `[a-z0-9]` becomes `-` → trim leading/trailing `-` → cut to 80 characters → trim trailing `-` → if empty use `section`.
* Ids are unique per document: allocate in document order, `prefix + slug`; on collision append `-2`, `-3`, … to the *prefixed* slug (`intro`, `intro-2`, `intro-3`). **Headings with empty text still consume an id** (so ids never depend on whether you render the TOC).
* The TOC lists every heading with non-empty text: `[{ id, text, level }]` (`level` = 1…6). The web target writes the same `id` on the element. E-mail/RSS omit ids.
* An optional `idPrefix` (`headingIdPrefix` when rendering) namespaces ids to avoid clashes with page ids such as `comments`.

---

## 7. Security considerations

The document is **untrusted input** (authors are trusted, but content arrives via APIs, imports and AI tools; treat it as hostile).

1. **No HTML passthrough.** There is no node that carries raw HTML, and no renderer may add one.
2. **URL policy** (`sanitizeUrl`): strip tab/newline/CR; reject any string containing other control or invisible characters (C0, DEL–C1, soft hyphen, zero-width characters, U+2028/2029, BOM); reject backslashes before `?`/`#`; allow only the schemes `http`, `https`, `mailto`, `tel` (http(s) must have an authority; `tel:` must match `^tel:[+\d\s().;=a-z-]{1,64}$`) and scheme-less relative references (a scheme-less value with a `:` before the first `/`, `?` or `#` is rejected); length ≤ 4096. Images additionally allow inline raster data URIs on web (`data:image/(png|jpeg|gif|webp|avif);base64,…`, ≤ 2 MiB); SVG is never allowed as `data:`.
3. **Iframe host allowlist.** The renderer constructs every iframe `src` itself from a validated id and verifies it (https, no credentials, exact host) against: `www.youtube-nocookie.com`, `www.youtube.com` (YouTube), `www.figma.com` (Figma), `platform.twitter.com` (tweets). Anything else is dropped with a `blocked-embed` warning. Iframes carry `loading="lazy"`, `title`, `referrerpolicy="strict-origin-when-cross-origin"` and a `sandbox` (`allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation`).
4. **CSS policy**: §3.4. Table cell `backgroundColor`, `colWidths`, `width`, `height`, layout `templateColumns` are validated individually; no CSS from content is concatenated unvalidated.
5. **Ids and classes** are never taken from content (headings get slugs of text, restricted to `[a-z0-9-]`).
6. **Math**: KaTeX with `trust: false` (no `\href`, `\url`, `\includegraphics`, `\htmlClass/Id/Style/Data`), `maxExpand` and `maxSize` bounds, source ≤ 10 000 chars.
7. **Resource limits** (§8) bound CPU/memory; renderers use iterative scans or bounded recursion (≤ 64 element levels + the JSON pre-scan guards against cycles and 100 000-level nesting without stack overflow).
8. **External links** carry `rel="noopener noreferrer nofollow"` and `target="_blank"` (web).
9. **Inline images** (editor uploads become `data:` URIs, §12) MUST be replaced with stored media by the API before saving; the renderer accepts them on web only as a convenience.
10. Plain-text derivations (`content_text`, embeddings, excerpts) are inert strings; escape them when placing them in HTML.

---

## 8. Limits

| Limit | Value | Enforced by |
| --- | --- | --- |
| Element nesting depth below root | 64 | strict: error; tolerant: subtree dropped |
| Total nodes (incl. image-caption nodes) | 50 000 | strict: error; tolerant: traversal stops |
| Serialized size (`JSON.stringify` length) | 2 MiB (the API's request limit may be lower: SPEC §9 says 1 MB) | error / warning |
| `text` length | 100 000 | invalid attribute |
| URL (`link.url`, `image.src` non-data) | 4096 | invalid → not rendered |
| Inline `data:image` source | 2 MiB | |
| `equation` | 10 000 | invalid attribute (node dropped) |
| `templateColumns` | 200 stored / 120 accepted | falls back to equal columns |
| Raw JSON nesting accepted by the pre-scan | 400 | fatal error (document unusable) |
| `colSpan`/`rowSpan`, `colWidths` entries | 1000 / 500 | invalid |
| Excerpt default | 200 chars | |

All limits are exported as `CONTENT_LIMITS`; `validateContent(json, { maxDepth, maxNodes, maxBytes })` can tighten them.

---

## 9. Versioning and forward compatibility

### 9.1 Two version levels

* **Node `version`** (Lexical's per-node integer): all v1 node types are `1`. A node with a higher version than the renderer knows is *rendered best-effort* using the fields it understands, with a `newer-node-version` warning.
* **BCF version** (this document): `1`. Documents carry no BCF version marker; compatibility is defined by node types and their fields. A future BCF v2 would add new node types and/or fields, never change the meaning of v1 fields. If a breaking change ever becomes necessary it will use a new top-level key (e.g. `bcf: 2`) so v1 readers fail soft (they would still find `root`).

### 9.2 Rules

1. **Unknown node types** (anything not in `SUPPORTED_NODE_TYPES`) MUST be **preserved on storage** (stores save the submitted JSON verbatim), **skipped when rendering** with a warning, and MUST NOT make validation fail (they are warnings) or rendering crash. Unknown elements keep their `children` in the parsed tree.
2. **Unknown properties** on known or unknown nodes MUST be preserved and ignored.
3. **Unknown enum values / invalid optional attributes**: tolerant parsing repairs them to defaults; strict validation reports them.
4. **Third-party / experimental node types** SHOULD use a namespaced `type` (`vendor:name`) to avoid collisions with future BCF types.
5. Renderers MUST NOT assume a closed set of `type` strings (no exhaustive `switch` without a default).
6. Additions in later BCF minor revisions are limited to: new node types, new optional fields, new allowed enum values, new classes. Removing or repurposing a v1 field is out of scope.

### 9.3 Never crash

Both parsing and rendering are total functions: any input (including `null`, strings, cyclic objects, 100 000-level nesting, 1 M nodes) yields an empty-or-partial document plus warnings; no exception escapes the public API. A failure inside one block is isolated (that block renders empty, a `render-error` warning is produced).

### 9.4 Migration from older Lexical output

Numeric element `format` values (Lexical < 0.18), missing `version`, and missing `textFormat`/`textStyle` are tolerated. Lexical `tag` on lists is ignored. Anything else that does not parse is repaired or dropped by tolerant parsing.

---

## 10. Library API (`@blog/content`)

```ts
parseContent(json: unknown, limits?): ParseResult                 // tolerant; never throws
validateContent(json: unknown, limits?): ValidationResult          // strict; { ok, errors, warnings, stats }
emptyContent(): Content                                            // one empty paragraph
toPlainText(content, { markers?, embedUrls? }): string
toExcerpt(content, maxChars = 200): string
readingMinutes(content, wpm = 220): number                         // >= 1
countWords(text): number
extractToc(content, { idPrefix? }): { id, text, level }[]
renderHtml(content, { target?: "web"|"email"|"rss", baseUrl?, embeds?: "iframe"|"link",
                      unknown?: "skip"|"unwrap", headingIdPrefix?, onWarning? }): string
renderContent(content, options): { html, warnings }
renderEmailDocument(content, { …options, title?, preheader?, maxWidth?, footerHtml? }) // full 600px document
wrapEmailHtml(fragment, opts): string
markdownToContent(md): Content                                     // seeds/tests
isContentEmpty(content), extractImages(content)
slugify(text), escapeHtml(text), sanitizeUrl(url, opts), sanitizeStyle(style), isAllowedEmbedUrl(url)
SUPPORTED_NODE_TYPES, CONTENT_LIMITS, TEXT_FORMAT, TABLE_HEADER, EMBED_HOSTS, ALLOWED_LINK_SCHEMES, VIEWER_THEME_CLASSES, BCF_CLASS
```

`content` arguments accept a parsed `Content`, raw JSON, or a JSON string. Parsed trees must be treated as immutable (they may share sub-objects with the input).

---

## 11. Cross-platform implementation guide

This section is for implementers of readers/renderers in other runtimes (Python, Go, Swift, Kotlin, PHP, Rust…). The reference implementation is ~1.5k lines of TypeScript; `packages/content/test/__snapshots__/*` are conformance fixtures: `kitchen-sink.json` (input) → `kitchen-sink.web.html`, `.email.html`, `.rss.html`, `.txt` (plain text) and `.toc.json`; `editor-sample.web.html` is the output for a real editor export (`test/fixtures/editor-sample.json`).

### 11.1 Pipeline

```
bytes ──UTF-8 decode──▶ JSON ──(1) prescan──▶ (2) normalise/validate ──▶ tree
                                                                  ├─▶ toc / plain text / excerpt / reading time
                                                                  └─▶ render(target)
```

1. **Prescan** (iterative, not recursive): reject cycles/over-deep JSON (> 400 levels), non-finite numbers, `__proto__`. Use a depth counter; in languages with native cycle-free JSON decoders this is only the depth check.
2. **Normalise** each node:
   * must be a JSON object with a non-empty string `type`, else drop;
   * depth > 64 → drop subtree; count nodes, stop at 50 000;
   * `type` unknown → keep verbatim, warn once per type;
   * known → read attributes with defaults from §4 (coerce wrong-typed optional attributes to the default; invalid *required* attribute ⇒ elements are replaced by their children, leaves are dropped);
   * derive: `list.tag` from `listType`; for `image`, parse `caption.editorState.root.children` as a child list (count toward limits).
3. Keep unknown properties; never evaluate or merge them.

### 11.2 Render skeleton (pseudocode)

```text
render_blocks(nodes):                      # block context
  out = ""; run = []
  for n in nodes:
    if is_inline(n): run.append(n); continue          # inline at block position
    flush(run) as implicit <p>; out += render_block(n)
  flush(run); return out

render_block(n): switch n.type {
  paragraph  → (contains block child ? '<div role="paragraph">' : '<p>') + render_inline(children or '<br>') + close
  heading    → '<h{N} id="{id}">' + inline + '</h{N}>'                     # id from §6.6
  list       → depth+=1; '<ul|ol class=…>' + items + close; depth-=1       # §4.8/4.9
  code       → '<pre … data-gutter="1&#10;2…">' + tokens + '</pre>'
  table      → wrapper + table; rows; cells (th/td, spans, validated bg)    # §4.15–4.17
  layout-container → grid div; collapsible-container → details              # §4.30/4.31
  youtube|tweet|figma|equation(block)|horizontalrule|page-break → §4.x
  default    → skip + warn (unknown) }

render_inline(nodes): concat render_inline_node(n)
render_inline_node(n): text → apply_format(n.text, n.format, n.style);  link → sanitize(url) ? <a> : plain children; image, datetime, equation(inline), linebreak, tab, hashtag, …
```

### 11.3 Text formatting algorithm

```text
bits = n.format & 2047
decls = sanitize_style(n.style)                          # §3.4
if bits == 0 and decls empty: return escape(text)
tags = []                                                # outermost → innermost
if bits&128: tags += mark ; if bits&64: tags += sup ; if bits&32: tags += sub
if bits&4: tags += s ; if bits&8: tags += u ; if bits&2: tags += em ; if bits&1: tags += strong ; if bits&16: tags += code
classes = [textBold if 1, textItalic if 2, (underline&strike ? textUnderlineStrikethrough : textUnderline if 8 | textStrikethrough if 4),
           textCode if 16, textHighlight if 128, textSubscript if 32, textSuperscript if 64, textLowercase 256, textUppercase 512, textCapitalize 1024]
innermost element = last(tags) or a <span>; put class="…" and style="…" on it; wrap outward.
```

### 11.4 URL sanitiser

```text
sanitize_url(s, base?, absolute?, allow_data_image?):
  s = trim(s); if empty → null
  if s contains [\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\xAD​-‏  ﻿] → null
  c = remove [\t\n\r] from s
  if c matches /^data:/i → allow only if allow_data_image and /^data:image\/(png|jpe?g|gif|webp|avif);base64,[A-Za-z0-9+\/]+=*$/ and len ≤ 2 MiB
  if len(c) > 4096 → null
  if "\" in (c up to first ? or #) → null
  if c matches /^([a-z][a-z0-9+.-]*):/i → scheme ∈ {http, https, mailto, tel} else null
        http(s): must match /^https?:\/\/[^\/\s?#]+/i ; external = origin(c) != origin(base) (or no base)
        mailto : length > 7 ; tel : matches /^tel:[+\d\s().;=a-z-]{1,64}$/i
  if c matches /^www\.[^\s\/?#]+\.[a-z]{2,}([\/?#]|$)/i → sanitize("https://" + c)
  if c starts with "//" → "https:" + c (external)
  if the part before the first [/?#] contains ":" → null
  relative → (absolute && base) ? resolve(c, base) : c         # encode spaces as %20
```

### 11.5 Per-node recipe cheat-sheet

| Node | Read | Write (web) |
| --- | --- | --- |
| `heading` | `tag` | `<hN id class="ViewerTheme__hN">` |
| `list` | `listType`, `start` | `ul.ViewerTheme__ul` / `ol.ViewerTheme__ol{min(depth,5)}` / checklist |
| `listitem` | `checked`, children | `li.ViewerTheme__listItem[ Checked|Unchecked| nestedListItem]` |
| `link` | `url`, `title` | sanitised `<a>`; external → `target _blank` + rel |
| `code` | `language`, tokens | `pre.ViewerTheme__code[data-language][data-gutter]` |
| `table*` | `colWidths`, `headerState`, spans, `backgroundColor`, `width`, `verticalAlign` | wrapper + `table.ViewerTheme__table` + `th/td.ViewerTheme__tableCell` |
| `image` | `src`, `altText`, `width`, `height`, `showCaption`, `caption` | `<img … loading=lazy>` (+ `figure`) |
| `equation` | `equation`, `inline` | KaTeX (or `<code>`) |
| `youtube/tweet/figma` | id | allowlisted iframe built from the id |
| `layout-*` | `templateColumns` | grid div |
| `collapsible-*` | `open` | `details/summary` |
| `datetime` | `dateTime` | `<time datetime>` + UTC label |
| `hashtag` etc. | `text` | span with class |

### 11.6 Test vectors

`slugify`: `"Hello World"→hello-world`, `"Café déjà vu"→cafe-deja-vu`, `"C++ & Rust: friends?"→c-and-rust-friends`, `"What's new in v2.0"→whats-new-in-v2-0`, `"日本語"→section`, `""→section`.
Duplicates: `Intro, Intro, Intro, Intro 2, Intro → intro, intro-2, intro-3, intro-2-2, intro-4`.
Format bits: `3` → `<em><strong class="ViewerTheme__textBold ViewerTheme__textItalic">x</strong></em>`; `12` → `<s><u class="ViewerTheme__textUnderlineStrikethrough">x</u></s>`; `0` + `style:"color: red"` → `<span style="color:red">x</span>`.
URLs: `javascript:alert(1)`, `java\tscript:…`, `data:text/html,…`, `\\evil`, `https://a\@b` → rejected; `/a`, `a/b`, `#x`, `?q`, `mailto:a@b.c`, `tel:+123`, `www.x.com/p` → accepted.
Excerpt: `("The quick brown fox jumps over the lazy dog.", 20)` → `The quick brown fox…`.
The repository's `test/__snapshots__` directory is the authoritative corpus.

### 11.7 Language notes

* **Escaping**: use a dedicated HTML escaper; never string-format attribute values.
* **Unicode**: slugify needs NFKD + combining-mark removal; excerpts count code points (not UTF-16 units, not grapheme clusters).
* **Regex flavour**: `\p{L}`/`\p{N}` word counting needs Unicode property support (PCRE `/u`, Go `\p{L}` with `regexp`, Python `regex` module).
* **Dates**: parse ISO-8601, format in UTC with English month abbreviations (no locale).
* **KaTeX**: native implementations should call KaTeX (JS) or a compatible renderer; if none is available render the LaTeX in `<code>` (the e-mail fallback) — that is conforming.
* **Immutability**: do not mutate the parsed tree while rendering; render twice → identical output.

---

## 12. Editor package gap analysis (`@scottjgilbert/lexical-blog-editor` 1.1.0)

Verified by reading `build/` and by round-tripping documents through a headless editor (`packages/content/test/compat-editor.test.ts`, skipped when the package is absent).

### 12.1 What the editor emits

`ServerPlaygroundNodes` registers 30 node classes. With Lexical's `root`, `paragraph`, `text`, `linebreak`, `tab` the complete set of node `type` strings is exactly the list in §4 (excluding `page-break`). The compat test asserts that the set registered by the editor and `SUPPORTED_NODE_TYPES` differ only by `page-break`.

Serialization: `JSON.stringify(editorState.toJSON())`. The `Editor` component calls `onChange(editorState, html)`; **store the JSON, ignore the html argument**.

### 12.2 Supported by BCF but not emitted by the current editor UI

| Node | Why it never appears |
| --- | --- |
| `mention` | `MentionNode` is registered but the package ships no mentions plugin/typeahead. |
| `specialText` | Registered; no plugin creates it. |
| `mark` | Registered (`@lexical/mark`); no comment/mark plugin. |
| `overflow` | Registered; there is no character-limit plugin. |
| `page-break` | Not a node of the package at all; BCF extension for hand-written/imported content. |
| `autolink` with `isUnlinked: true` | Produced when a user undoes an automatic link; rare. |
| `emoji` beyond `:) :D :( <3` | Only those four shortcuts plus the picker; other `className` values are tolerated and ignored. |

### 12.3 Emitted by the editor but problematic (BCF behaviour in bold)

| Editor behaviour | Impact | BCF handling / required action |
| --- | --- | --- |
| **Image upload stores a `data:` URI** in `image.src` (`FileReader.readAsDataURL`); only "insert by URL" yields http(s). | Posts balloon past the 1 MB API limit and leak into jsonb/FTS. | The **API MUST upload data URIs to the storage service and rewrite `src` before saving** (validate with `extractImages`). Renderer accepts raster data URIs on web, drops them for e-mail/RSS. |
| Package `Viewer` **removes YouTube embeds**: it exports `youtube-nocookie.com/embed/…` but its allowlist only has `https://www.youtube.com/embed`. | Videos vanish in the package's viewer. | BCF allowlists both hosts. |
| Package export of **Figma is an empty `<div>`** (`ServerFigmaNode` has no `exportDOM`). | Figma embeds disappear. | BCF renders the iframe. |
| Package export of **layout containers has no class** (its `exportDOM` overrides `createDOM`) and `<hr>` has none. | No grid/line in the package viewer. | BCF emits `ViewerTheme__layoutContainer` and `ViewerTheme__hr`. |
| Tweets are rendered by `react-tweet` on the client. | Needs client JS. | BCF uses a lazy iframe or a link. |
| Package viewer needs **jsdom** (assigns `global.window`) and DOMPurify. | Heavy, server globals polluted. | BCF is a pure string renderer. |
| Tables are exported without a scroll wrapper and with `border:1px solid black; width:75px` inline. | Overflow on mobile. | BCF wraps in `ViewerTheme__tableScrollableWrapper` and uses theme classes. |
| `ImageNode` exports `width="inherit"` for never-resized images. | Invalid attribute. | JSON stores `0`; BCF omits the attribute. |
| **Link URLs** are only sanitised for the scheme when `new URL()` succeeds; `example.com` is stored as typed; `sms:` is permitted; invalid schemes become `about:blank`. | Broken relative links; `sms:` unsupported by BCF. | `www.` hosts are upgraded to `https://`; other scheme-less values are treated as relative; `about:blank`/`sms:` links render as plain text with a warning. |
| Shiki tokens carry **light-theme colours** (`one-light`) in `style`. | Low contrast on dark code backgrounds (`ViewerTheme.css` darkens `.ViewerTheme__code` under `prefers-color-scheme: dark`). | Colours are passed through (allowlisted). The site SHOULD override `.ViewerTheme__code` background to a light surface or accept the contrast trade-off; documented for the web implementers. |
| `ViewerTheme.css` **defines no rules for `h4`–`h6` or `ViewerTheme__checklist`** although the theme maps them. | Unstyled headings. | `bcf.css` adds `h4`–`h6`. |
| `Collapsible__*` styles are in the editor's own CSS bundle, **not** in `ViewerTheme.css`. | `<details>` unstyled. | `bcf.css` provides them. |
| Fresh `Editor` without `initialState` pre-fills "Welcome to the rich blog editor!". | New posts start with junk text. | Admin MUST pass `initialState` (`emptyContent()` converted via `editor.parseEditorState`). |
| `direction` is `null` when serialised headlessly and `ltr`/`rtl` in the browser. | Diff noise. | Treated identically. |
| Date/time stores a UTC instant; the author's timezone is lost. | Dates near midnight can shift. | BCF displays UTC explicitly (` UTC` suffix when a time is present). |
| Image caption is a **nested editor state** inside the node (`caption.editorState`). | Hidden text; deep structure. | Parsed recursively, counted in limits, included in plain text/search. |
| `emoji` nodes carry `className` that the editor CSS turns into a background image and hides the glyph. | Glyph invisible without editor CSS. | BCF ignores `className`, renders the glyph. |

### 12.4 Features BCF supports that the editor package does not expose

* The `page-break` extension.
* `embeds: "link"` mode (privacy-preserving, no third-party frames), `unknown: "unwrap"`, `headingIdPrefix`.
* E-mail and RSS targets with fallbacks (the editor package has no such notion).
* Heading ids / TOC, plain text, excerpts, reading time.

### 12.5 Features of the editor not representable / not rendered

* Table **frozen rows/columns** (the table context menu can freeze them; `frozenRowCount`/`frozenColumnCount` are preserved but not rendered: sticky cells inside the horizontal scroll wrapper are unreliable). Column resizing UI state (only `colWidths` persists).
* Editor-only UI state (selection, history, collaboration/Yjs data) — never part of `toJSON()`.
* Floating link editor "target/rel" choices: BCF decides `target`/`rel` itself.

### 12.6 Recommendations to the integration code

1. Admin: save `JSON.stringify(editorState.toJSON())`; call `validateContent` server-side; replace `data:` images; reject on errors, keep warnings.
2. API: derive `content_text = toPlainText(content)`, `reading_minutes = readingMinutes(content)`, excerpt = `toExcerpt(content)` when empty, `toc = extractToc(content)`, `contentHtml = renderHtml(content, { target: "web" })`; newsletters `renderEmailDocument`; RSS `renderHtml(content, { target: "rss", baseUrl: SITE_URL })`.
3. Web: render `contentHtml` as-is inside the post container; import the three stylesheets of §6.4; render the TOC from `toc` (ids already exist in the HTML).

---

## Appendix A. Complete example

```json
{
  "root": {
    "type": "root", "version": 1, "direction": "ltr", "format": "", "indent": 0,
    "children": [
      { "type": "heading", "version": 1, "tag": "h1", "direction": "ltr", "format": "", "indent": 0,
        "children": [ { "type": "text", "version": 1, "text": "Hello", "format": 0, "style": "", "mode": "normal", "detail": 0 } ] },
      { "type": "paragraph", "version": 1, "direction": "ltr", "format": "", "indent": 0, "textFormat": 0, "textStyle": "",
        "children": [
          { "type": "text", "version": 1, "text": "Some ", "format": 0, "style": "", "mode": "normal", "detail": 0 },
          { "type": "text", "version": 1, "text": "bold red", "format": 1, "style": "color: #d0021b;", "mode": "normal", "detail": 0 },
          { "type": "text", "version": 1, "text": " and a ", "format": 0, "style": "", "mode": "normal", "detail": 0 },
          { "type": "link", "version": 1, "url": "https://example.org/", "rel": null, "target": null, "title": null, "direction": "ltr", "format": "", "indent": 0,
            "children": [ { "type": "text", "version": 1, "text": "link", "format": 0, "style": "", "mode": "normal", "detail": 0 } ] }
        ] },
      { "type": "youtube", "version": 1, "format": "", "videoID": "dQw4w9WgXcQ" },
      { "type": "future-widget", "version": 1, "anything": { "goes": true } }
    ]
  }
}
```

Web HTML (`renderHtml`):

```html
<h1 id="hello" class="ViewerTheme__h1">Hello</h1>
<p class="ViewerTheme__paragraph">Some <strong class="ViewerTheme__textBold" style="color:#d0021b">bold red</strong> and a <a href="https://example.org/" target="_blank" rel="noopener noreferrer nofollow" class="ViewerTheme__link">link</a></p>
<div class="bcf-embed bcf-embed--youtube"><iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" … loading="lazy"></iframe></div>
<!-- future-widget: skipped, warning "unknown node type" -->
```

Validation result: `ok: true`, one warning `unknown-node-type` (`future-widget`), `stats.unknownTypes = ["future-widget"]`.

## Appendix B. Change log

* **v1 (2026-10)** — initial standard: node set derived from `@scottjgilbert/lexical-blog-editor` 1.1.0 / Lexical 0.40.0.
