import { describe, expect, it } from "vitest";
import { sanitizeCommentBody } from "../../src/services/comments/sanitize";

describe("sanitizeCommentBody", () => {
  it.each([
    ["  a  ", "a"],
    ["a\r\nb\rc", "a\nb\nc"],
    ["a\n\n\n\n\nb", "a\n\nb"],
    ["a \t\nb", "a\nb"],
    ["a\u0000b\u0007c\u007Fd", "abcd"],
    ["tab\tkept", "tab\tkept"],
    ["​zero‮width﻿", "zerowidth"],
    ["é", "é"],
  ])("%j → %j", (input, out) => expect(sanitizeCommentBody(input)).toBe(out));
});
