import { describe, expect, it } from "vitest";
import { markdownToContent, renderHtml, toPlainText, validateContent } from "../src/index";
import { checkWellFormed } from "./helpers/html";

const html = (md: string) => renderHtml(markdownToContent(md), { target: "web" });
const types = (md: string) => markdownToContent(md).root.children.map((c) => c.type);

describe("markdownToContent", () => {
  it("always produces valid BCF", () => {
    const md = [
      "# Title", "", "Paragraph with **bold**, *italic*, ~~strike~~, `code` and a [link](https://e.org \"T\").", "",
      "- a", "  - nested", "- b", "", "1. one", "2. two", "", "- [x] done", "- [ ] todo", "", "> quote", "", "```ts", "const x = 1;", "```", "", "---", "", "![alt](https://i.example/x.png)",
    ].join("\n");
    const c = markdownToContent(md);
    const v = validateContent(c);
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual([]);
    expect(checkWellFormed(renderHtml(c))).toEqual([]);
  });

  it("returns a single empty paragraph for blank input", () => {
    expect(types("")).toEqual(["paragraph"]);
    expect(types("\n\n  \n")).toEqual(["paragraph"]);
  });

  it("headings: ATX levels, trailing #s and setext", () => {
    expect(html("# One\n## Two ##\n###### Six")).toBe(
      '<h1 id="one" class="ViewerTheme__h1">One</h1><h2 id="two" class="ViewerTheme__h2">Two</h2><h6 id="six" class="ViewerTheme__h6">Six</h6>',
    );
    expect(html("Setext One\n===\n\nSetext Two\n---")).toContain('<h1 id="setext-one"');
    expect(html("Setext One\n===\n\nSetext Two\n---")).toContain('<h2 id="setext-two"');
  });

  it("paragraphs: soft breaks join with a space, hard breaks become <br>", () => {
    expect(html("line one\nline two")).toBe('<p class="ViewerTheme__paragraph">line one line two</p>');
    expect(html("line one  \nline two")).toBe('<p class="ViewerTheme__paragraph">line one<br>line two</p>');
    expect(html("line one\\\nline two")).toBe('<p class="ViewerTheme__paragraph">line one<br>line two</p>');
    expect(types("a\n\nb")).toEqual(["paragraph", "paragraph"]);
  });

  it("inline formatting: bold, italic, strike, code, nesting", () => {
    expect(html("**b** *i* _i2_ __b2__ ~~s~~ `c`")).toBe(
      '<p class="ViewerTheme__paragraph"><strong class="ViewerTheme__textBold">b</strong> <em class="ViewerTheme__textItalic">i</em> <em class="ViewerTheme__textItalic">i2</em> <strong class="ViewerTheme__textBold">b2</strong> <s class="ViewerTheme__textStrikethrough">s</s> <code class="ViewerTheme__textCode">c</code></p>',
    );
    expect(html("***both***")).toContain('<em><strong class="ViewerTheme__textBold ViewerTheme__textItalic">both</strong></em>');
    expect(html("**bold *and italic* bold**")).toContain('<strong class="ViewerTheme__textBold">bold </strong><em><strong class="ViewerTheme__textBold ViewerTheme__textItalic">and italic</strong></em><strong class="ViewerTheme__textBold"> bold</strong>');
    expect(html("*italic **bold** italic*")).toContain('<em><strong class="ViewerTheme__textBold ViewerTheme__textItalic">bold</strong></em>');
  });

  it("does not treat snake_case or lone asterisks as emphasis", () => {
    expect(toPlainText(markdownToContent("snake_case_name and 2 * 3 * 4"))).toBe("snake_case_name and 2 * 3 * 4");
    expect(html("snake_case_name")).not.toContain("<em");
  });

  it("code spans protect their content; escapes produce literals", () => {
    expect(html("`**not bold**` and \\*not italic\\*")).toBe(
      '<p class="ViewerTheme__paragraph"><code class="ViewerTheme__textCode">**not bold**</code> and *not italic*</p>',
    );
    expect(html("`` a`b ``")).toContain(">a&#96;b<");
  });

  it("links, images, autolinks, bare URLs", () => {
    expect(html("[text](https://e.org/a)")).toContain('<a href="https://e.org/a" target="_blank" rel="noopener noreferrer nofollow" class="ViewerTheme__link">text</a>');
    expect(html("[**bold link**](/internal)")).toContain('<a href="/internal" class="ViewerTheme__link"><strong class="ViewerTheme__textBold">bold link</strong></a>');
    expect(html("<https://auto.example.com>")).toContain('href="https://auto.example.com"');
    expect(html("see https://bare.example.com/x, ok")).toContain('<a href="https://bare.example.com/x"');
    expect(html("see https://bare.example.com/x, ok")).toContain("</a>, ok");
    expect(html("![A cat](https://i.example/cat.png)")).toContain('<img src="https://i.example/cat.png" alt="A cat"');
    expect(html("text ![inline](/i.png) more")).toContain('<img src="/i.png" alt="inline"');
    // a title turns an image into a captioned figure
    expect(html('![Chart](https://i.example/c.png "Figure 1")')).toContain("<figcaption>Figure 1</figcaption>");
    expect(html("[with (parens) in](https://e.org/a_(b)) done")).toContain('href="https://e.org/a_(b)"');
  });

  it("unsafe link URLs survive conversion but never render as links", () => {
    expect(html("[x](javascript:alert(1))")).toBe('<p class="ViewerTheme__paragraph">x</p>');
  });

  it("lists: bullets, ordered (with start), nesting, loose items, continuation lines", () => {
    expect(html("- a\n- b")).toBe(
      '<ul class="ViewerTheme__ul"><li class="ViewerTheme__listItem">a</li><li class="ViewerTheme__listItem">b</li></ul>',
    );
    const ordered = html("3. c\n4. d");
    expect(ordered).toContain('<ol class="ViewerTheme__ol1" start="3">');
    expect(ordered).toContain('value="3">c</li>');
    expect(ordered).toContain('value="4">d</li>');
    const nested = html("- a\n  - b\n    - c\n- d");
    expect(nested.match(/<ul /g)).toHaveLength(3);
    expect(nested).toContain("ViewerTheme__nestedListItem");
    expect(toPlainText(markdownToContent("- a\n  - b\n    - c\n- d"))).toBe("a\nb\nc\nd");
    expect(html("- a\n\n- b")).toContain("<li");
    expect(toPlainText(markdownToContent("- one\n  continues here\n- two"))).toBe("one continues here\ntwo");
    // ordered list nested under bullets
    expect(html("- a\n  1. x\n  2. y")).toContain("<ol");
  });

  it("task lists become checklists", () => {
    const out = html("- [x] done\n- [ ] todo");
    expect(out).toContain("ViewerTheme__checklist");
    expect(out).toContain("ViewerTheme__listItemChecked");
    expect(out).toContain("ViewerTheme__listItemUnchecked");
  });

  it("blockquotes: one quote per paragraph", () => {
    expect(html("> a\n> b\n>\n> c")).toBe('<blockquote class="ViewerTheme__quote">a b</blockquote><blockquote class="ViewerTheme__quote">c</blockquote>');
  });

  it("fenced code blocks keep content verbatim, language and tabs", () => {
    const out = html("```python\ndef f():\n\treturn <b>1</b>\n\n```\n");
    expect(out).toContain('data-language="python"');
    expect(out).toContain("def f():");
    expect(out).toContain("&lt;b&gt;1&lt;/b&gt;");
    expect(out).toContain("\t");
    expect(out).toContain('data-gutter="1&#10;2&#10;3"');
    expect(html("~~~\nplain\n~~~")).toContain("plain");
    expect(html("````\n```\ninner\n```\n````")).toContain("&#96;&#96;&#96;");
    // unterminated fence swallows the rest, as in CommonMark
    expect(html("```\nnever closed")).toContain("never closed");
  });

  it("horizontal rules", () => {
    expect(types("a\n\n---\n\nb")).toEqual(["paragraph", "horizontalrule", "paragraph"]);
    expect(types("***")).toEqual(["horizontalrule"]);
    expect(types("- - -")).toEqual(["horizontalrule"]);
  });

  it("handles CRLF input and mixed documents", () => {
    expect(types("# A\r\n\r\ntext\r\n\r\n- x\r\n- y\r\n")).toEqual(["heading", "paragraph", "list"]);
  });

  it("escapes HTML in markdown text (it is data, not markup)", () => {
    const out = html("<script>alert(1)</script> & <b>x</b>");
    expect(out).not.toContain("<script");
    expect(out).toContain("&lt;script&gt;");
  });

  it("round-trips through plain text sensibly", () => {
    const md = "# Hello\n\nSome *text* here.\n\n- one\n- two\n\n> quote\n\n```\ncode\n```";
    expect(toPlainText(markdownToContent(md))).toBe("Hello\n\nSome text here.\n\none\ntwo\n\nquote\n\ncode");
  });
});
