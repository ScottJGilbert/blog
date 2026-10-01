import type { ReactNode } from "react";
import type { IconType } from "react-icons";
import Link from "next/link";
import { clsx } from "clsx";
import {
  LuArrowRight,
  LuCpu,
  LuHeartHandshake,
  LuPenLine,
} from "react-icons/lu";
import { PageContainer } from "@/components/layout/PageContainer";
import { buttonStyles } from "@/components/ui/Button";
import { SmartLink } from "@/components/ui/SmartLink";
import { Tag } from "@/components/ui/Tag";
import type { SectionId } from "@/lib/site";

interface HubCardProps {
  /** Card is painted with this section's theme (a preview of the destination). */
  section: SectionId;
  eyebrow: string;
  title: string;
  description: string;
  watermark: IconType;
  className?: string;
  children: ReactNode;
}

/**
 * Whole-card link pattern: the CTA anchor stretches over the card with ::after,
 * so there is exactly one link per card (no nested interactive content).
 * Don't make any ancestor of the CTA `relative` or the stretch breaks.
 */
function HubCard({
  section,
  eyebrow,
  title,
  description,
  watermark: Watermark,
  className,
  children,
}: HubCardProps) {
  return (
    <article
      data-section={section}
      className={clsx(
        "group section-motif card-lift relative flex min-h-80 flex-col justify-between overflow-hidden rounded-panel border border-border bg-surface p-6 text-fg shadow-card sm:p-8 lg:p-10",
        "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring",
        className,
      )}
    >
      <Watermark
        aria-hidden
        className="pointer-events-none absolute -right-4 -bottom-6 -z-10 size-40 text-accent opacity-10 motion-safe:transition-opacity motion-safe:duration-500 group-hover:opacity-20 sm:size-48"
      />
      <div className="relative z-10">
        <Tag>{eyebrow}</Tag>
        <h2 className="mt-6 mb-3 text-2xl sm:text-3xl">{title}</h2>
        <p className="max-w-md text-muted">{description}</p>
      </div>
      <div className="mt-8">{children}</div>
    </article>
  );
}

const stretched =
  "after:absolute after:inset-0 after:content-[''] focus-visible:outline-none";

export default function WritingHub() {
  return (
    <PageContainer size="wide" className="pb-8">
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-12">
        <HubCard
          section="personal"
          eyebrow="Reflections"
          title="Personal Growth & Life Logs"
          description="Life updates, philosophical reflections, and what I’m currently learning beyond the screen. An organic record of a digital life."
          watermark={LuPenLine}
          className="lg:col-span-8"
        >
          <Link
            prefetch={false}
            href="/personal"
            className={clsx(buttonStyles({ size: "lg" }), stretched)}
          >
            Read updates
            <LuArrowRight aria-hidden className="size-4" />
          </Link>
        </HubCard>

        <HubCard
          section="engineering"
          eyebrow="Technical"
          title="Engineering & CAD"
          description="Deep dives into software architecture, industrial CAD workflows, and systemic problem-solving."
          watermark={LuCpu}
          className="lg:col-span-4"
        >
          <Link
            prefetch={false}
            href="/engineering"
            className={clsx(buttonStyles({ size: "lg" }), stretched)}
          >
            View work
            <LuArrowRight aria-hidden className="size-4" />
          </Link>
        </HubCard>

        <HubCard
          section="home"
          eyebrow="Impact"
          title="Miracle Makers Blog (External)"
          description="Dedicated service projects and volunteer work focused on creating tangible miracles for those who need them most. Building bridges between technology and charity."
          watermark={LuHeartHandshake}
          className="md:col-span-2 lg:col-span-12"
        >
          <SmartLink
            href="https://miracles.scottgilbert.dev"
            className={clsx(buttonStyles({ size: "lg" }), stretched)}
          >
            Get involved
          </SmartLink>
        </HubCard>
      </div>
    </PageContainer>
  );
}
