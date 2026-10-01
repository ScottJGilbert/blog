import { describe, expect, it } from "vitest";
import { extractToc, renderHtml, toExcerpt, toPlainText } from "../src/index";
import { editorSample, kitchenSink } from "./fixtures";

/**
 * Snapshot-style tests. The files under test/__snapshots__ are the reviewed, expected HTML for the fixtures;
 * a diff in review shows exactly what changed in rendered output. Update with `vitest -u`.
 */
const pretty = (html: string) => html.replace(/></g, ">\n<");

describe("rendered output snapshots", () => {
  for (const target of ["web", "email", "rss"] as const) {
    it(`kitchen sink (${target})`, async () => {
      const html = renderHtml(kitchenSink, { target, baseUrl: "https://blog.example.com" });
      await expect(pretty(html)).toMatchFileSnapshot(`./__snapshots__/kitchen-sink.${target}.html`);
    });
  }

  it("kitchen sink input (the conformance corpus input)", async () => {
    await expect(JSON.stringify(kitchenSink, null, 2) + "\n").toMatchFileSnapshot("./__snapshots__/kitchen-sink.json");
  });

  it("real editor export (web)", async () => {
    await expect(pretty(renderHtml(editorSample, { target: "web" }))).toMatchFileSnapshot("./__snapshots__/editor-sample.web.html");
  });

  it("plain text of the kitchen sink", async () => {
    await expect(toPlainText(kitchenSink)).toMatchFileSnapshot("./__snapshots__/kitchen-sink.txt");
  });

  it("excerpt and toc of the kitchen sink", async () => {
    expect(toExcerpt(kitchenSink, 60)).toBe("An intro with bold, italic, both and code. under strike…");
    await expect(JSON.stringify(extractToc(kitchenSink), null, 2)).toMatchFileSnapshot("./__snapshots__/kitchen-sink.toc.json");
  });
});
