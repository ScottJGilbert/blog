import { ListingSkeleton } from "@/components/blog/ListingSkeleton";
import { RecipeCardSkeleton } from "@/components/cookbook/RecipeCard";

export default function Loading() {
  return <ListingSkeleton Card={RecipeCardSkeleton} />;
}
