import type { Metadata } from "next";

export const SITE_NAME = "SIMKA";
export const SITE_ORIGIN = (process.env.NEXT_PUBLIC_SITE_URL || "https://simka-store.onrender.com").replace(/\/$/, "");
export const DEFAULT_DESCRIPTION = "SIM и eSIM для путешествий: сравните страну, оператора, объём интернета и срок действия, затем оформите заказ онлайн.";

export function absoluteUrl(value = "/") {
  try {
    const url = new URL(value, `${SITE_ORIGIN}/`);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : `${SITE_ORIGIN}/`;
  } catch {
    return `${SITE_ORIGIN}/`;
  }
}

function brandedTitle(title: string) {
  return title.toLocaleUpperCase("ru-RU").includes(SITE_NAME) ? title : `${title} — ${SITE_NAME}`;
}

export function pageMetadata({
  title,
  description,
  path,
  canonical,
  image,
  imageAlt,
  socialTitle,
  socialDescription,
  noindex = false,
  type = "website",
}: {
  title: string;
  description: string;
  path: string;
  canonical?: string | null;
  image?: string | null;
  imageAlt?: string;
  socialTitle?: string | null;
  socialDescription?: string | null;
  noindex?: boolean;
  type?: "website" | "article";
}): Metadata {
  const resolvedTitle = brandedTitle(title);
  const resolvedCanonical = absoluteUrl(canonical || path);
  const resolvedImage = absoluteUrl(image || "/opengraph-image");
  const openGraphImage = { url: resolvedImage, alt: imageAlt || resolvedTitle, ...(!image ? { width: 1200, height: 630 } : {}) };
  const resolvedSocialTitle = socialTitle || resolvedTitle;
  const resolvedSocialDescription = socialDescription || description;

  return {
    title: resolvedTitle,
    description,
    alternates: { canonical: resolvedCanonical },
    robots: {
      index: !noindex,
      follow: true,
      googleBot: {
        index: !noindex,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
    },
    openGraph: {
      type,
      locale: "ru_RU",
      siteName: SITE_NAME,
      url: resolvedCanonical,
      title: resolvedSocialTitle,
      description: resolvedSocialDescription,
      images: [openGraphImage],
    },
    twitter: {
      card: "summary_large_image",
      title: resolvedSocialTitle,
      description: resolvedSocialDescription,
      images: [resolvedImage],
    },
  };
}

export function jsonLd(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function breadcrumbJsonLd(items: Array<{ name: string; path: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

export function itemListJsonLd(items: Array<{ name: string; path: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    numberOfItems: items.length,
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      url: absoluteUrl(item.path),
    })),
  };
}
