import "@scottjgilbert/lexical-blog-editor/styles/ViewerTheme.css";
import "@blog/content/styles.css";
import "./post-prose.css";
import KatexStyles from "./KatexStyles";
import { hasEquations, prepareContentHtml } from "./prepare-html";

/**
 * The post body: server-rendered HTML from the API (`contentHtml`), zero client JavaScript. The HTML is produced and
 * escaped by @blog/content (URL-scheme allowlist, iframe host allowlist, allowlisted inline styles).
 */
export function PostContent({ html }: { html: string }) {
  return (
    <>
      {hasEquations(html) && <KatexStyles />}
      <div className="post-prose" dangerouslySetInnerHTML={{ __html: prepareContentHtml(html) }} />
    </>
  );
}
