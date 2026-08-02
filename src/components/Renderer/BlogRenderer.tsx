import Viewer from "@scottjgilbert/lexical-blog-editor/viewer";
import type { ViewerProps } from "@scottjgilbert/lexical-blog-editor/viewer";
import "@scottjgilbert/lexical-blog-editor/styles/ViewerTheme.css";
import "./blog-renderer.css";

export default function BlogRenderer(props: ViewerProps) {
  return (
    <div className="blog-renderer">
      <Viewer {...props} />
    </div>
  );
}
