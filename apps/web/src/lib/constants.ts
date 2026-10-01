// Mirrors of @blog/shared constants (packages/shared/src/schemas/common.ts). Duplicated on purpose: importing the
// shared package in browser code drags zod into every page's JavaScript.
export const COMMENT_MAX_LENGTH = 4000;
export const COMMENT_EDIT_WINDOW_MINUTES = 15;
