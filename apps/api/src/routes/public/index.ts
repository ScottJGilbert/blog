import { Router } from "express";
import type { Deps } from "../../deps";
import { createCommentsService } from "../../services/comments";
import { createPostsService } from "../../services/posts";
import { createSubscribersService } from "../../services/subscribers";
import { commentsRouter } from "./comments";
import { feedRouter } from "./feed";
import { newsletterRouter } from "./newsletter";
import { postsRouter } from "./posts";

/**
 * Public (reader-facing) routes, mounted at the API root: posts, search, tags, related, sitemap, RSS feed (`/feed.xml`),
 * comments, newsletter flows, `/me/subscription` and the listmonk webhook. (`/me`, `/me` PATCH/DELETE live in `routes/me.ts`.)
 */
export function publicRouter(deps: Deps): Router {
  const router = Router();
  const posts = createPostsService(deps);
  router.use(postsRouter(deps, posts));
  router.use(feedRouter(deps, posts));
  router.use(commentsRouter(deps, createCommentsService(deps)));
  router.use(newsletterRouter(deps, createSubscribersService(deps)));
  return router;
}
