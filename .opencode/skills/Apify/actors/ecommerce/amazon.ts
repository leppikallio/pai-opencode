/**
 * Amazon Scraper
 *
 * Top Actors:
 * - junglee/free-amazon-product-scraper (8,898 users, 4.97 rating)
 * - axesso_data/amazon-reviews-scraper (1,647 users, 4.62 rating, $0.75/1k reviews)
 *
 * Extract Amazon product data, reviews, pricing without API.
 */

import { Apify } from '../../index'
import type {
  PaginationOptions,
  ActorRunOptions
} from '../../types'

/* ============================================================================
 * TYPES
 * ========================================================================= */

export interface AmazonProductInput {
  /** Amazon product URL or ASIN */
  productUrl: string
  /** Include reviews */
  includeReviews?: boolean
  /** Maximum reviews to scrape */
  maxReviews?: number
}

export interface AmazonProduct {
  asin: string
  title: string
  url: string
  price?: number
  currency?: string
  priceString?: string
  originalPrice?: number
  discount?: string
  rating?: number
  reviewsCount?: number
  stars?: number
  description?: string
  features?: string[]
  images?: string[]
  variants?: ProductVariant[]
  availability?: string
  inStock?: boolean
  seller?: string
  brand?: string
  category?: string
  reviews?: AmazonReview[]
}

export interface ProductVariant {
  asin: string
  title: string
  price?: number
  imageUrl?: string
}

export interface AmazonReviewsInput extends PaginationOptions {
  /** Amazon product URL or ASIN */
  productUrl: string
  /** Maximum reviews to scrape */
  maxResults?: number
  /** Star rating filter (1-5) */
  starRating?: number
  /** Verified purchases only */
  verifiedOnly?: boolean
}

export interface AmazonReview {
  id: string
  title: string
  text: string
  rating: number
  date: string
  verifiedPurchase?: boolean
  helpful?: number
  reviewerName?: string
  reviewerUrl?: string
  images?: string[]
}

type AmazonReviewRaw = {
  id?: string
  reviewId?: string
  title?: string
  text?: string
  body?: string
  stars?: number
  rating?: number
  date?: string
  verified?: boolean
  verifiedPurchase?: boolean
  helpful?: number
  helpfulCount?: number
  reviewer?: string
  reviewerName?: string
  reviewerUrl?: string
  author?: string
  images?: string[]
  reviewImages?: string[]
}

type AmazonProductRaw = {
  asin?: string
  title?: string
  url?: string
  price?: number
  currency?: string
  priceString?: string
  originalPrice?: number
  discount?: number
  stars?: number
  rating?: number
  reviews?: number
  reviewsCount?: number
  description?: string
  features?: string[]
  featureBullets?: string[]
  images?: string[]
  variants?: unknown[]
  availability?: string
  inStock?: boolean
  seller?: string
  brand?: string
  category?: string
  topReviews?: AmazonReviewRaw[]
}

/* ============================================================================
 * FUNCTIONS
 * ========================================================================= */

/**
 * Scrape Amazon product data
 *
 * @param input - Product scraping options
 * @param options - Actor run options
 * @returns Amazon product details
 *
 * @example
 * ```typescript
 * const product = await scrapeAmazonProduct({
 *   productUrl: 'https://www.amazon.com/dp/B08L5VT894',
 *   includeReviews: true,
 *   maxReviews: 50
 * })
 *
 * console.log(`${product.title} - $${product.price}`)
 * console.log(`Rating: ${product.rating}/5 (${product.reviewsCount} reviews)`)
 *
 * // Filter reviews in code - only 5-star verified purchases
 * const topReviews = product.reviews?.filter(r =>
 *   r.rating === 5 && r.verifiedPurchase
 * )
 * ```
 */
export async function scrapeAmazonProduct(
  input: AmazonProductInput,
  options?: ActorRunOptions
): Promise<AmazonProduct> {
  const apify = new Apify()

  const run = await apify.callActor('junglee/free-amazon-product-scraper', {
    startUrls: [input.productUrl],
    maxReviews: input.maxReviews || 0,
    includeReviews: input.includeReviews || false
  }, options)

  await apify.waitForRun(run.id)

  const finalRun = await apify.getRun(run.id)
  if (finalRun.status !== 'SUCCEEDED') {
    throw new Error(`Amazon product scraping failed: ${finalRun.status}`)
  }

  const dataset = apify.getDataset(finalRun.defaultDatasetId)
  const items = await dataset.listItems({ limit: 1 }) as AmazonProductRaw[]

  if (items.length === 0) {
    throw new Error(`Product not found: ${input.productUrl}`)
  }

  const product = items[0]

  return {
    asin: product.asin ?? "",
    title: product.title ?? "",
    url: product.url || input.productUrl,
    price: product.price,
    currency: product.currency,
    priceString: product.priceString,
    originalPrice: product.originalPrice,
    discount: typeof product.discount === "string"
      ? product.discount
      : product.discount != null
        ? String(product.discount)
        : undefined,
    rating: product.stars || product.rating,
    stars: product.stars,
    reviewsCount: product.reviews || product.reviewsCount,
    description: product.description,
    features: product.features || product.featureBullets,
    images: product.images,
    variants: product.variants as ProductVariant[] | undefined,
    availability: product.availability,
    inStock: product.inStock,
    seller: product.seller,
    brand: product.brand,
    category: product.category,
    reviews: product.topReviews?.map((r: AmazonReviewRaw) => ({
      id: r.id || r.reviewId || "",
      title: r.title || "",
      text: r.text || r.body || "",
      rating: r.stars ?? r.rating ?? 0,
      date: r.date || "",
      verifiedPurchase: r.verified,
      helpful: r.helpful,
      reviewerName: r.reviewer,
      reviewerUrl: r.reviewerUrl,
      images: r.images
    }))
  }
}

/**
 * Scrape Amazon product reviews
 *
 * @param input - Review scraping options
 * @param options - Actor run options
 * @returns Array of Amazon reviews
 *
 * @example
 * ```typescript
 * const reviews = await scrapeAmazonReviews({
 *   productUrl: 'https://www.amazon.com/dp/B08L5VT894',
 *   maxResults: 500,
 *   verifiedOnly: true
 * })
 *
 * // Filter in code - only detailed reviews
 * const detailed = reviews.filter(r =>
 *   r.text.length > 200 &&
 *   r.images && r.images.length > 0
 * )
 *
 * // Analyze sentiment by star rating
 * const positive = reviews.filter(r => r.rating >= 4)
 * const negative = reviews.filter(r => r.rating <= 2)
 * console.log(`Sentiment: ${positive.length}+ / ${negative.length}-`)
 * ```
 */
export async function scrapeAmazonReviews(
  input: AmazonReviewsInput,
  options?: ActorRunOptions
): Promise<AmazonReview[]> {
  const apify = new Apify()

  const run = await apify.callActor('axesso_data/amazon-reviews-scraper', {
    urls: [input.productUrl],
    maxReviews: input.maxResults || 100,
    starRating: input.starRating,
    verifiedPurchaseOnly: input.verifiedOnly
  }, options)

  await apify.waitForRun(run.id)

  const finalRun = await apify.getRun(run.id)
  if (finalRun.status !== 'SUCCEEDED') {
    throw new Error(`Amazon reviews scraping failed: ${finalRun.status}`)
  }

  const dataset = apify.getDataset(finalRun.defaultDatasetId)
  const items = await dataset.listItems({
    limit: input.maxResults || 1000,
    offset: input.offset || 0
  }) as AmazonReviewRaw[]

  return items.map((review: AmazonReviewRaw) => ({
    id: review.id || review.reviewId || "",
    title: review.title || "",
    text: review.text || review.body || "",
    rating: review.stars ?? review.rating ?? 0,
    date: review.date || "",
    verifiedPurchase: review.verifiedPurchase || review.verified,
    helpful: review.helpful || review.helpfulCount,
    reviewerName: review.reviewerName || review.author,
    reviewerUrl: review.reviewerUrl,
    images: review.images || review.reviewImages
  }))
}
