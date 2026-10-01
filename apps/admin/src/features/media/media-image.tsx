import Image from "next/image";
import type { Media } from "@blog/shared";
import { cn } from "@/components/ui/cn";

/** Thumbnail with a fixed aspect ratio (no layout shift). `unoptimized`: files are already served by the API/CDN. */
export function MediaImage({
  media,
  className,
  sizes = "200px",
}: {
  media: Pick<Media, "url" | "alt" | "width" | "height">;
  className?: string;
  sizes?: string;
}) {
  return (
    <Image
      src={media.url}
      alt={media.alt ?? ""}
      width={media.width ?? 400}
      height={media.height ?? 300}
      sizes={sizes}
      unoptimized
      loading="lazy"
      className={cn("size-full object-cover", className)}
    />
  );
}
