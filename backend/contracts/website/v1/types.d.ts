// Generated from site.schema.json by typegen.cjs; checked by check-contracts.mjs.
export type PlainText = string;

export type Id = string;

export type Slug = string;

export type RoutePath = string;

export type AssetPath = string;

export type HttpsUrl = string;

export type LinkHref = string;

export type Email = string;

export type Phone = string;

export type UtcTimestamp = string;

export type Sha256 = string;

export type StateCode = "AL" | "AK" | "AZ" | "AR" | "CA" | "CO" | "CT" | "DE" | "DC" | "FL" | "GA" | "HI" | "ID" | "IL" | "IN" | "IA" | "KS" | "KY" | "LA" | "ME" | "MD" | "MA" | "MI" | "MN" | "MS" | "MO" | "MT" | "NE" | "NV" | "NH" | "NJ" | "NM" | "NY" | "NC" | "ND" | "OH" | "OK" | "OR" | "PA" | "RI" | "SC" | "SD" | "TN" | "TX" | "UT" | "VT" | "VA" | "WA" | "WV" | "WI" | "WY" | "AS" | "GU" | "MP" | "PR" | "VI";

export type PublicLink = {
  "label": PlainText;
  "href": LinkHref;
};

export type InlineText = ({
  "type": "text";
  "text": PlainText;
}) | ({
  "type": "strong" | "emphasis";
  "text": PlainText;
}) | ({
  "type": "link";
  "text": PlainText;
  "href": LinkHref;
});

export type ProseBlock = ({
  "type": "paragraph" | "heading";
  "content": Array<InlineText>;
}) | ({
  "type": "list";
  "ordered": boolean;
  "items": Array<Array<InlineText>>;
});

export type PostalAddress = {
  "@type": "PostalAddress";
  "streetAddress": PlainText;
  "addressLocality": PlainText;
  "addressRegion": StateCode;
  "postalCode": string;
  "addressCountry": "US";
};

export type StructuredData = ({
  "@context": "https://schema.org";
  "@type": "Organization" | "FinancialService" | "MortgageBroker";
  "name": PlainText;
  "url": HttpsUrl;
  "logo"?: HttpsUrl;
  "description"?: PlainText;
  "telephone"?: Phone;
  "email"?: Email;
  "address"?: PostalAddress;
}) | ({
  "@context": "https://schema.org";
  "@type": "FAQPage";
  "mainEntity": Array<{
  "@type": "Question";
  "name": PlainText;
  "acceptedAnswer": {
  "@type": "Answer";
  "text": PlainText;
};
}>;
}) | ({
  "@context": "https://schema.org";
  "@type": "BreadcrumbList";
  "itemListElement": Array<{
  "@type": "ListItem";
  "position": number;
  "name": PlainText;
  "item": HttpsUrl;
}>;
});

export type PageSeo = {
  "title"?: PlainText;
  "description"?: PlainText;
  "canonical"?: CanonicalReference;
  "ogTitle"?: PlainText;
  "ogDescription"?: PlainText;
  "ogImage"?: SeoImageReference;
  "robots"?: string;
  "jsonLd"?: StructuredData;
  "include": boolean;
  "priority"?: number;
  "changefreq"?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
};

export type ImageReference = {
  "kind": "image";
  "desktopAsset": AssetPath;
  "mobileAsset": AssetPath;
};

export type HeroMedia = (ImageReference) | ({
  "kind": "video";
  "name": Slug;
});

export type HeroVariant = {
  "id": Id;
  "active": boolean;
  "headline": PlainText;
  "description": PlainText;
  "desktopAlign": "left" | "center" | "right";
  "mobileAlign": "left" | "center" | "right";
  "overlayOpacity": number;
  "media": HeroMedia;
  "artworkAsset"?: AssetPath;
  "primary"?: PublicLink;
  "secondary"?: PublicLink;
};

export type MediaFile = {
  "path": AssetPath;
  "sha256": Sha256;
  "bytes": number;
  "contentType": "image/jpeg" | "image/png" | "image/webp" | "image/avif" | "image/svg+xml" | "video/mp4";
};

export type MediaSet = {
  "name": Slug;
  "kind": "image" | "hero-video";
  "files": Array<MediaFile>;
};

export type PublicOfficer = {
  "id": Id;
  "slug": Slug;
  "name": PlainText;
  "nmls": string;
  "phone": Phone;
  "email": Email;
  "photoAsset": AssetPath;
  "biography": PlainText;
  "specialties": Array<PlainText>;
  "licensedStates": Array<StateCode>;
};

export type PublicTestimonial = {
  "id": Id;
  "text": PlainText;
  "displayName": PlainText;
  "sourceUrl": HttpsUrl;
};

export type IntroSection = {
  "id": Id;
  "type": "intro";
  "heading": PlainText;
  "body": Array<ProseBlock>;
};

export type ServiceCardsSection = {
  "id": Id;
  "type": "service-cards";
  "heading": PlainText;
  "cards": Array<{
  "title": PlainText;
  "description": PlainText;
  "link": PublicLink;
  "subtitle"?: PlainText;
  "imageAsset"?: AssetPath;
}>;
};

export type ProgramCardsSection = {
  "id": Id;
  "type": "program-cards";
  "heading": PlainText;
  "cards": Array<{
  "title": PlainText;
  "description": PlainText;
  "link": PublicLink;
  "subtitle"?: PlainText;
  "imageAsset"?: AssetPath;
}>;
};

export type BenefitsSection = {
  "id": Id;
  "type": "benefits";
  "heading": PlainText;
  "items": Array<{
  "title": PlainText;
  "description": PlainText;
}>;
};

export type ProcessSection = {
  "id": Id;
  "type": "process";
  "heading": PlainText;
  "steps": Array<{
  "title": PlainText;
  "description": PlainText;
}>;
};

export type OfficerIntroductionSection = {
  "id": Id;
  "type": "officer-introduction";
  "heading": PlainText;
  "description": PlainText;
  "officerIds": Array<Id>;
  "link": PublicLink;
};

export type TestimonialsSection = {
  "id": Id;
  "type": "testimonials";
  "heading": PlainText;
  "testimonialIds": Array<Id>;
};

export type FaqSection = {
  "id": Id;
  "type": "faq";
  "heading": PlainText;
  "items": Array<{
  "question": PlainText;
  "answer": Array<ProseBlock>;
}>;
};

export type DisclosureSection = {
  "id": Id;
  "type": "disclosure";
  "body": Array<ProseBlock>;
};

export type EstimatorSection = {
  "id": Id;
  "type": "estimator-reference";
  "estimator": "purchase" | "refinance" | "va" | "investment" | "equity";
  "heading": PlainText;
  "disclosure": PlainText;
};

export type CtaSection = {
  "id": Id;
  "type": "cta";
  "heading": PlainText;
  "description": PlainText;
  "primary": PublicLink;
  "secondary"?: PublicLink;
};

export type LegalProseSection = {
  "id": Id;
  "type": "legal-prose";
  "heading": PlainText;
  "effectiveDate": string;
  "body": Array<ProseBlock>;
};

export type PublicSection = (IntroSection) | (ServiceCardsSection) | (ProgramCardsSection) | (BenefitsSection) | (ProcessSection) | (OfficerIntroductionSection) | (TestimonialsSection) | (FaqSection) | (DisclosureSection) | (EstimatorSection) | (CtaSection) | (LegalProseSection);

export type PublicPage = {
  "id": Id;
  "path": RoutePath;
  "template": "home" | "division" | "product" | "standard" | "legal" | "officer-directory" | "officer-profile" | "faq" | "glossary" | "program" | "rates" | "sitemap";
  "title": PlainText;
  "description": PlainText;
  "heroVariants": Array<HeroVariant>;
  "fallbackImage": ImageReference;
  "sections": Array<PublicSection>;
  "seo": PageSeo;
  "officerId"?: Id;
};

export type PublicBrand = {
  "shortName": PlainText;
  "legalName": PlainText;
  "foundedYear": number;
  "assistantName": string;
  "logos": {
  "horizontal": AssetPath;
  "white": AssetPath;
  "mark": AssetPath;
};
};

export type PublicContact = {
  "phoneDisplay": Phone;
  "phoneHref": string;
  "email": Email;
  "nmls": string;
  "nmlsConsumerAccessUrl": HttpsUrl;
};

export type StateLicense = {
  "code": StateCode;
  "name": PlainText;
  "licenseNumber"?: PlainText;
};

export type TenantLegal = {
  "states": Array<StateLicense>;
  "texasNotice": PlainText;
  "ratesDisclaimer": PlainText;
  "address"?: PlainText;
  "privacyEmail"?: Email;
  "effectiveDates"?: {
  "licensing"?: string;
  "privacy-notice"?: string;
  "privacy-policy"?: string;
  "terms"?: string;
  "accessibility"?: string;
  "texas-required-notice"?: string;
  "nmls-consumer-access"?: string;
};
  "calculatorDisclaimer": PlainText;
  "exampleRateNote": PlainText;
};

export type PublicTheme = {
  "green900": string;
  "green850": string;
  "green800": string;
  "green700": string;
  "green600": string;
  "greenGlow": string;
  "spring": string;
  "spring2": string;
  "spring3": string;
  "springSoft": string;
  "mint": string;
  "ink": string;
  "paper": string;
  "paper2": string;
  "muted": string;
  "line": string;
  "onDark": string;
  "onDark2": string;
  "onDark3": string;
  "hairDark": string;
  "lip": string;
  "radiusSm": string;
  "radiusMd": string;
  "radiusLg": string;
  "radiusXl": string;
  "fontFamily": "var(--font-hanken), system-ui, -apple-system, \"Segoe UI\", sans-serif";
};

export type TenantSeo = {
  "titleDefault": PlainText;
  "titleTemplate": PlainText;
  "description": PlainText;
  "ogTitle": PlainText;
  "ogDescription": PlainText;
  "siteName": PlainText;
  "orgDescription": PlainText;
  "knowsLanguage": Array<PlainText>;
  "keywords"?: Array<PlainText>;
  "ogImage"?: SeoImageReference;
};

export type TenantMarketing = {
  "tagline": PlainText;
  "stats": Array<{
  "num": PlainText;
  "label": PlainText;
}>;
  "familyOfCompanies": Array<{
  "rest": PlainText;
  "href": LinkHref;
  "desc": PlainText;
}>;
  "footerFamily": Array<{
  "rest": PlainText;
  "desc": PlainText;
}>;
  "testimonials": Array<{
  "names": PlainText;
  "rating": number;
}>;
};

export type TenantFeatures = {
  "showFamily": boolean;
  "ghlChat": false;
  "aiAssistant": false;
  "heroAiMode": false;
  "askAiChat": false;
  "ratesNavigation": boolean;
};

export type ApplyOffRamp = {
  "channels": Array<"call" | "text" | "email">;
  "slaCopy": PlainText;
  "finishScreen": "rendered" | "autoRedirect";
};

export type CalculatorSettings = {
  "disabled": Array<"mortgage" | "buydown" | "blended-rate" | "refinance-breakeven" | "rent-vs-buy" | "budget" | "apr" | "investment">;
  "exampleRatePct": number;
};

export type PublicTenantConfig = {
  "brand": PublicBrand;
  "theme": PublicTheme;
  "contact": PublicContact;
  "legal": TenantLegal;
  "seo": TenantSeo;
  "marketing"?: TenantMarketing;
  "features": TenantFeatures;
  "applyOffRamp": ApplyOffRamp;
  "calculators": CalculatorSettings;
};

export type CalculatorCompatibility = {
  "config": PublicTenantConfig;
  "origin": HttpsUrl;
  "pageSeo": Record<string, PageSeo>;
};

export type NavigationItem = (PublicLink) | ({
  "label": PlainText;
  "children": Array<PublicLink>;
});

export type SiteSettings = {
  "company": {
  "shortName": PlainText;
  "legalName": PlainText;
  "foundedYear": number;
  "logos": {
  "horizontal": AssetPath;
  "white": AssetPath;
  "mark": AssetPath;
};
};
  "contact": PublicContact;
  "navigation": {
  "primary": Array<NavigationItem>;
  "footer": Array<PublicLink>;
  "application": PublicLink;
  "signIn": PublicLink;
};
  "legal": {
  "states": Array<StateLicense>;
  "address": PlainText;
  "privacyEmail": Email;
  "equalHousingText": PlainText;
  "equalHousingAsset": AssetPath;
  "disclosure": PlainText;
  "links": Array<PublicLink>;
};
  "origin": HttpsUrl;
};

export type PublicationId = Id;

export type RevisionId = Id;

export type PublicOfficerId = Id;

export type EntityRef = {
  "kind": "page" | "site" | "officer" | "testimonial";
  "id": Id;
};

export type SelectedRevision = {
  "kind": "page" | "site" | "officer" | "testimonial";
  "id": Id;
  "revisionId": Id;
  "action": "replace" | "remove";
};

export type PublishRequest = {
  "requestId": Id;
  "basePublicationId": Id;
  "selections": Array<SelectedRevision>;
};

export type PublicationResult = {
  "publicationId": Id;
  "generation": number;
  "status": "candidate" | "active" | "adopted" | "failed";
};

export type ActivePointer = {
  "generation": number;
  "publicationId": Id;
  "manifestKey": string;
  "sha256": Sha256;
  "schemaVersion": 1;
  "activatedAt": UtcTimestamp;
};

export type OfficerRevocations = {
  "schemaVersion": 1;
  "version": number;
  "updatedAt": UtcTimestamp;
  "revokedOfficerIds": Array<Id>;
};

export type SiteSnapshot = {
  "schemaVersion": 1;
  "publicationId": Id;
  "createdAt": UtcTimestamp;
  "revisions": Array<{
  "entity": EntityRef;
  "revisionId": Id;
}>;
  "site": SiteSettings;
  "pages": Array<PublicPage>;
  "officers": Array<PublicOfficer>;
  "testimonials": Array<PublicTestimonial>;
  "media": Array<MediaSet>;
  "calculatorCompatibility": CalculatorCompatibility;
};

export type CanonicalReference = (HttpsUrl) | (string);

export type SeoImageReference = (AssetPath) | (HttpsUrl);

export declare class ContractValidationError extends Error { readonly code: "invalid_public_contract"; }
export declare function parseSiteSnapshot(value: unknown): SiteSnapshot;
export declare function parseRevocations(value: unknown): OfficerRevocations;
export declare function parsePublishRequest(value: unknown): PublishRequest;
export declare function parseActivePointer(value: unknown): ActivePointer;
export declare function parsePublicationResult(value: unknown): PublicationResult;
export declare function parsePageSeo(value: unknown): PageSeo;
