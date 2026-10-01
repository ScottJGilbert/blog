import { isApiError } from "@/lib/api-error";

/** Reader-facing message for a failed comment action. */
export function commentErrorMessage(err: unknown, action: "post" | "edit" | "delete" | "report" = "post"): string {
  if (isApiError(err)) {
    if (err.status === 401) return "Your session has expired. Please sign in again.";
    if (err.status === 403) {
      return action === "edit"
        ? "The 15-minute edit window has closed."
        : "You can't do that right now. Make sure your email address is verified.";
    }
    if (err.status === 404) return "That comment no longer exists.";
    if (err.status === 409) return "You've already reported this comment.";
    if (err.status === 429) return "You're doing that too quickly. Please wait a minute and try again.";
    if (err.code === "validation_error") {
      return action === "report" ? "Please give a reason of 3 to 500 characters." : "Comments must be between 1 and 4000 characters.";
    }
    if (err.code === "network_error" || err.code === "timeout") return "Can't reach the server. Check your connection and try again.";
  }
  return "Something went wrong. Please try again.";
}
