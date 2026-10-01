import {
  F, a, auto, br, cell, checklist, code, collapsible, datetime, doc, el, emoji, equation, figma, h, hashtag, hr, image, keyword, layout,
  li, mark, mention, ol, overflow, p, pageBreak, quote, special, t, tab, table, tok, tr, tweet, ul, youtube,
} from "../helpers/build";

/** A realistic document that uses every node type BCF v1 supports. */
export const kitchenSink = doc(
  h("h1", "Building a Blog Platform"),
  p(t("An intro with "), t("bold", F.bold), t(", "), t("italic", F.italic), t(", "), t("both", F.bold | F.italic), t(" and "), t("code", F.code), t(".")),
  h("h2", "Formatting"),
  p(
    t("under", F.underline), t(" "), t("strike", F.strike), t(" "), t("both", F.underline | F.strike), t(" H"), t("2", F.sub), t("O x"), t("2", F.sup),
    t(" "), t("highlight", F.highlight), t(" "), t("UPPER", F.upper), br(), tab(), t("after tab and break"),
  ),
  p(t("Colored", 0, "color: #d0021b; font-size: 18px; font-family: Georgia, serif; background-color: #ffff00;")),
  el("paragraph", [t("Centered and indented")], { format: "center", indent: 1, textFormat: 0, textStyle: "" }),
  quote(t("A wise quote.")),
  h("h2", "Lists"),
  ul(el("listitem", [t("one")], { value: 1 }), el("listitem", [ul(el("listitem", [t("nested bullet")], { value: 1, indent: 1 }))], { value: 2, indent: 1 }), li([t("two")], { value: 2 })),
  ol(li([t("first")], { value: 1 }), li([ol(li([t("nested number")], { value: 1, indent: 1 }))], { value: 2, indent: 1 }), li([t("second")], { value: 2 })),
  checklist(li([t("done")], { value: 1, checked: true }), li([t("todo")], { value: 2, checked: false })),
  h("h2", "Inline extras"),
  p(
    a("https://external.example.org/page?x=1&y=2", t("external link")), t(" "), a("/about", t("internal link")), t(" "), auto("https://auto.example.com"),
    t(" "), hashtag("#lexical"), t(" "), emoji("🙂"), t(" "), mention("Scott"), t(" "), keyword("congrats"), t(" "), special("[special]"), t(" "),
    datetime("2024-05-06T07:08:00.000Z"), t(" "), equation("E=mc^2", true), t(" "), mark(["thread-1"], t("marked text")), t(" "), overflow(t("overflowing")),
  ),
  h("h2", "Code"),
  code("ts", tok("const", "keyword"), tok(" answer "), tok("=", "operator"), tok(" "), tok("42", "number", "color: #905;"), tok(";", "punctuation"), br(), tab(), tok("// done", "comment")),
  hr(),
  h("h3", "Math"),
  equation("\\int_0^1 x^2\\,dx = \\frac{1}{3}", false),
  h("h2", "Media"),
  p(image("https://img.example.com/photo.jpg", "A photo", { width: 640, height: 480 })),
  p(image("https://img.example.com/captioned.png", "Captioned chart", { width: 400, height: 300 }, "Figure 1: a chart")),
  youtube("dQw4w9WgXcQ"),
  tweet("1234567890123456789"),
  figma("AbCdEfGhIjKlMnOpQrStUv"),
  h("h2", "Tables"),
  table(
    [
      tr(cell([p(t("Name"))], { headerState: 3 }), cell([p(t("Value"))], { headerState: 1, colSpan: 2 })),
      tr(cell([p(t("alpha"))], { headerState: 2 }), cell([p(t("1"))], { backgroundColor: "#ffeeee" }), cell([p(t("one"))])),
    ],
    { colWidths: [120, 80, 80], rowStriping: true },
  ),
  h("h2", "Layout and collapsible"),
  layout("1fr 2fr", [p(t("left column"))], [p(t("right column")), ul(li([t("item")], { value: 1 }))]),
  collapsible("More details", [p(t("Hidden until opened.")), p(t("Second paragraph."))]),
  pageBreak(),
  p(),
);
