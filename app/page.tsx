import Storefront from "./storefront";
import { getPublicCategories } from "@/lib/categories";

export const dynamic = "force-dynamic";

export default async function Home() {
  const categories = await getPublicCategories();
  return <Storefront categories={categories} />;
}
