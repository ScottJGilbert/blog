/** Builds a document with the REAL editor package (headless) covering every node type it can emit. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { EditorKit } from "./editor-kit";

export function buildEditorDocument(kit: EditorKit): { json: { root: Record<string, any> }; html: string } {
  const { L, m } = kit;
  return kit.run((root: any) => {
    const para = (...kids: any[]) => {
      const node = L.$createParagraphNode();
      node.append(...kids);
      return node;
    };
    const txt = (s: string, ...formats: string[]) => {
      const n = L.$createTextNode(s);
      for (const f of formats) n.toggleFormat(f);
      return n;
    };

    const h1 = m.richText.$createHeadingNode("h1");
    h1.append(txt("Real editor document"));
    const h2 = m.richText.$createHeadingNode("h2");
    h2.append(txt("Second level"));
    h2.setFormat("center");
    const h4 = m.richText.$createHeadingNode("h4");
    h4.append(txt("Fourth level"));
    root.append(h1, h2, h4);

    const styled = txt("styled text");
    styled.setStyle("color: #ff0000; font-size: 20px; background-color: #ffff00;");
    const formatted = para(
      txt("bold italic", "bold", "italic"),
      txt(" underline strike", "underline", "strikethrough"),
      txt(" code", "code"),
      txt(" sub", "subscript"),
      txt(" sup", "superscript"),
      txt(" highlight", "highlight"),
      styled,
      L.$createLineBreakNode(),
      L.$createTabNode(),
      txt("after tab"),
    );
    formatted.setFormat("right");
    formatted.setIndent(2);
    root.append(formatted);

    const quote = m.richText.$createQuoteNode();
    quote.append(txt("a quote"));
    root.append(quote);

    const bullets = m.list.$createListNode("bullet");
    const b1 = m.list.$createListItemNode();
    b1.append(txt("one"));
    const b2 = m.list.$createListItemNode();
    const numbered = m.list.$createListNode("number");
    const n1 = m.list.$createListItemNode();
    n1.append(txt("nested number"));
    numbered.append(n1);
    b2.append(numbered);
    bullets.append(b1, b2);
    root.append(bullets);

    const checks = m.list.$createListNode("check");
    const c1 = m.list.$createListItemNode(true);
    c1.append(txt("done"));
    const c2 = m.list.$createListItemNode(false);
    c2.append(txt("todo"));
    checks.append(c1, c2);
    root.append(checks);

    const link = m.link.$createLinkNode("https://example.com/page", { target: "_blank", rel: "noopener", title: "Title" });
    link.append(txt("link"));
    const autolink = m.link.$createAutoLinkNode("https://auto.example.com");
    autolink.append(txt("https://auto.example.com"));
    const markNode = m.mark.$createMarkNode(["thread"]);
    markNode.append(txt("marked"));
    root.append(
      para(
        link,
        txt(" "),
        autolink,
        txt(" "),
        m.hashtag.$createHashtagNode("#tag"),
        m.emoji.$createEmojiNode("emoji happysmile", "🙂"),
        m.mention.$createMentionNode("Bob"),
        m.keyword.$createKeywordNode("congrats"),
        m.special.$createSpecialTextNode("[special]"),
        m.dateTime.$createDateTimeNode(new Date("2024-05-06T07:08:00Z")),
        m.equation.$createEquationNode("E=mc^2", true),
        markNode,
      ),
    );

    const code = m.code.$createCodeNode("js");
    code.append(
      m.codeHl.$createCodeHighlightNode("const", "keyword"),
      m.codeHl.$createCodeHighlightNode(" x "),
      m.codeHl.$createCodeHighlightNode("=", "operator"),
      L.$createLineBreakNode(),
      L.$createTabNode(),
      m.codeHl.$createCodeHighlightNode("1", "number"),
    );
    root.append(code, m.extension.$createHorizontalRuleNode(), m.equation.$createEquationNode("\\frac{a}{b}", false));

    const img = m.image.$createImageNode({ src: "https://img.example.com/a.png", altText: "alt text", width: 100, height: 50, maxWidth: 500, showCaption: true });
    img.__caption.update(
      () => {
        const r = L.$getRoot();
        r.clear();
        r.append(para(txt("image caption")));
      },
      { discrete: true },
    );
    const plainImg = m.image.$createImageNode({ src: "https://img.example.com/b.png", altText: "plain", width: 0, height: 0, maxWidth: 500 });
    root.append(para(img), para(plainImg));
    root.append(m.youtube.$createYouTubeNode("dQw4w9WgXcQ"), m.tweet.$createTweetNode("1234567890"), m.figma.$createFigmaNode("AbCdEfGhIjKlMnOpQrStUv"));

    const layout = m.layoutC.$createLayoutContainerNode("1fr 1fr");
    for (const label of ["left", "right"]) {
      const item = m.layoutI.$createLayoutItemNode();
      item.append(para(txt(label)));
      layout.append(item);
    }
    root.append(layout);

    const coll = m.collC.$createCollapsibleContainerNode(true);
    const title = m.collT.$createCollapsibleTitleNode();
    title.append(txt("Collapsible title"));
    const body = m.collB.$createCollapsibleContentNode();
    body.append(para(txt("collapsible body")));
    coll.append(title, body);
    root.append(coll);

    root.append(m.table.$createTableNodeWithDimensions(2, 3, true));
  });
}
