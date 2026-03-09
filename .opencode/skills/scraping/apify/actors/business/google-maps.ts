/**
 * Google Maps Scraper
 *
 * Apify Actor: compass/crawler-google-places (198,093 users, 4.76 rating)
 * Pricing: $0.001-$0.007 per event (Actor start + per place + optional add-ons)
 *
 * HIGHEST VALUE ACTOR - 198k users!
 * Extract Google Maps business data, reviews, contacts, images - perfect for lead generation.
 */

import { Apify } from '../../index'
import type {
  BusinessInfo,
  Location,
  ContactInfo,
  PaginationOptions,
  ActorRunOptions
} from '../../types'
import {
  asArray,
  asBoolean,
  asNumber,
  asRecord,
  asString,
  asStringArray,
  type UnknownRecord
} from '../shared/normalization'

/* ============================================================================
 * TYPES
 * ========================================================================= */

export interface GoogleMapsSearchInput extends PaginationOptions {
  /** Search query (e.g., "restaurants in San Francisco") */
  query: string
  /** Maximum number of places to scrape */
  maxResults?: number
  /** Include reviews for each place */
  includeReviews?: boolean
  /** Maximum reviews per place */
  maxReviewsPerPlace?: number
  /** Include images */
  includeImages?: boolean
  /** Scrape contact information from websites */
  scrapeContactInfo?: boolean
  /** Language code (en, es, fr, de, etc.) */
  language?: string
  /** Country code for search region */
  country?: string
}

export interface GoogleMapsPlaceInput {
  /** Google Maps place URL or Place ID */
  placeUrl: string
  /** Include reviews */
  includeReviews?: boolean
  /** Maximum reviews to scrape */
  maxReviews?: number
  /** Include images */
  includeImages?: boolean
  /** Scrape contact info from website */
  scrapeContactInfo?: boolean
}

export interface GoogleMapsPlace extends BusinessInfo {
  placeId: string
  name: string
  url: string
  category?: string
  categories?: string[]
  address?: string
  location?: Location
  rating?: number
  reviewsCount?: number
  priceLevel?: number
  phone?: string
  website?: string
  email?: string
  openingHours?: string[]
  openingHoursByDay?: OpeningHours
  popularTimes?: PopularTimes[]
  isTemporarilyClosed?: boolean
  isPermanentlyClosed?: boolean
  totalScore?: number
  reviewsDistribution?: ReviewsDistribution
  imageUrls?: string[]
  reviews?: GoogleMapsReview[]
  contactInfo?: ContactInfo
  socialMedia?: {
    facebook?: string
    twitter?: string
    instagram?: string
    linkedin?: string
  }
  verificationStatus?: string
}

export interface OpeningHours {
  monday?: string
  tuesday?: string
  wednesday?: string
  thursday?: string
  friday?: string
  saturday?: string
  sunday?: string
}

export interface PopularTimes {
  day: string
  hours: Array<{
    hour: number
    occupancyPercent: number
  }>
}

export interface ReviewsDistribution {
  oneStar?: number
  twoStar?: number
  threeStar?: number
  fourStar?: number
  fiveStar?: number
}

export interface GoogleMapsReview {
  id?: string
  text: string
  publishedAtDate: string
  rating: number
  likesCount?: number
  reviewerId?: string
  reviewerName?: string
  reviewerPhotoUrl?: string
  reviewerReviewsCount?: number
  responseFromOwner?: string
  responseFromOwnerDate?: string
  imageUrls?: string[]
}

export interface GoogleMapsReviewsInput extends PaginationOptions {
  /** Google Maps place URL */
  placeUrl: string
  /** Maximum number of reviews to scrape */
  maxResults?: number
  /** Minimum rating filter (1-5) */
  minRating?: number
  /** Language code */
  language?: string
}

/* ============================================================================
 * FUNCTIONS
 * ========================================================================= */

/**
 * Search Google Maps for places matching a query
 *
 * @param input - Search parameters
 * @param options - Actor run options
 * @returns Array of Google Maps places
 *
 * @example
 * ```typescript
 * // Search for coffee shops in SF
 * const places = await searchGoogleMaps({
 *   query: 'coffee shops in San Francisco',
 *   maxResults: 50,
 *   includeReviews: true,
 *   maxReviewsPerPlace: 10
 * })
 *
 * // Filter in code - only highly rated with many reviews
 * const topCoffeeShops = places
 *   .filter(p => p.rating >= 4.5 && p.reviewsCount >= 100)
 *   .sort((a, b) => b.rating - a.rating)
 *   .slice(0, 10)
 *
 * // Extract emails for lead generation
 * const leads = topCoffeeShops
 *   .filter(p => p.email)
 *   .map(p => ({ name: p.name, email: p.email, phone: p.phone }))
 * ```
 */
export async function searchGoogleMaps(
  input: GoogleMapsSearchInput,
  options?: ActorRunOptions
): Promise<GoogleMapsPlace[]> {
  const apify = new Apify()

  const run = await apify.callActor('compass/crawler-google-places', {
    searchStringsArray: [input.query],
    maxCrawledPlacesPerSearch: input.maxResults || 50,
    language: input.language || 'en',
    countryCode: input.country,
    includeReviews: input.includeReviews || false,
    maxReviews: input.maxReviewsPerPlace || 0,
    includeImages: input.includeImages || false,
    scrapeCompanyEmails: input.scrapeContactInfo || false,
    scrapeSocialMediaLinks: input.scrapeContactInfo || false
  }, options)

  await apify.waitForRun(run.id)

  const finalRun = await apify.getRun(run.id)
  if (finalRun.status !== 'SUCCEEDED') {
    throw new Error(`Google Maps search failed: ${finalRun.status}`)
  }

  const dataset = apify.getDataset(finalRun.defaultDatasetId)
  const items = await dataset.listItems({
    limit: input.maxResults || 1000,
    offset: input.offset || 0
  })

  return items
    .map(normalizeGoogleMapsPlace)
    .filter((place): place is GoogleMapsPlace => place !== null)
}

/**
 * Scrape detailed data for a specific Google Maps place
 *
 * @param input - Place scraping parameters
 * @param options - Actor run options
 * @returns Detailed place information
 *
 * @example
 * ```typescript
 * // Scrape a specific place with reviews
 * const place = await scrapeGoogleMapsPlace({
 *   placeUrl: 'https://maps.google.com/maps?cid=12345',
 *   includeReviews: true,
 *   maxReviews: 100,
 *   scrapeContactInfo: true
 * })
 *
 * // Filter reviews in code - only recent 5-star reviews
 * const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000)
 * const recentExcellent = place.reviews?.filter(r =>
 *   r.rating === 5 &&
 *   new Date(r.publishedAtDate).getTime() > thirtyDaysAgo
 * )
 * ```
 */
export async function scrapeGoogleMapsPlace(
  input: GoogleMapsPlaceInput,
  options?: ActorRunOptions
): Promise<GoogleMapsPlace> {
  const apify = new Apify()

  const run = await apify.callActor('compass/crawler-google-places', {
    startUrls: [input.placeUrl],
    includeReviews: input.includeReviews || false,
    maxReviews: input.maxReviews || 0,
    includeImages: input.includeImages || false,
    scrapeCompanyEmails: input.scrapeContactInfo || false,
    scrapeSocialMediaLinks: input.scrapeContactInfo || false
  }, options)

  await apify.waitForRun(run.id)

  const finalRun = await apify.getRun(run.id)
  if (finalRun.status !== 'SUCCEEDED') {
    throw new Error(`Google Maps place scraping failed: ${finalRun.status}`)
  }

  const dataset = apify.getDataset(finalRun.defaultDatasetId)
  const items = await dataset.listItems({ limit: 1 })

  if (items.length === 0) {
    throw new Error(`Place not found: ${input.placeUrl}`)
  }

  const firstItem = items[0]
  const place = normalizeGoogleMapsPlace(firstItem)
  if (!place) {
    throw new Error('Invalid Google Maps place payload shape')
  }

  return place
}

/**
 * Scrape reviews for a Google Maps place
 *
 * @param input - Review scraping parameters
 * @param options - Actor run options
 * @returns Array of reviews
 *
 * @example
 * ```typescript
 * // Get 500 reviews for sentiment analysis
 * const reviews = await scrapeGoogleMapsReviews({
 *   placeUrl: 'https://maps.google.com/maps?cid=12345',
 *   maxResults: 500,
 *   language: 'en'
 * })
 *
 * // Filter in code - only detailed reviews
 * const detailedReviews = reviews.filter(r =>
 *   r.text.length > 100 &&
 *   r.imageUrls && r.imageUrls.length > 0
 * )
 *
 * // Analyze sentiment by rating
 * const negative = reviews.filter(r => r.rating <= 2)
 * const positive = reviews.filter(r => r.rating >= 4)
 * ```
 */
export async function scrapeGoogleMapsReviews(
  input: GoogleMapsReviewsInput,
  options?: ActorRunOptions
): Promise<GoogleMapsReview[]> {
  const apify = new Apify()

  const run = await apify.callActor('compass/Google-Maps-Reviews-Scraper', {
    startUrls: [input.placeUrl],
    maxReviews: input.maxResults || 100,
    reviewsSort: 'newest',
    language: input.language || 'en'
  }, options)

  await apify.waitForRun(run.id)

  const finalRun = await apify.getRun(run.id)
  if (finalRun.status !== 'SUCCEEDED') {
    throw new Error(`Google Maps reviews scraping failed: ${finalRun.status}`)
  }

  const dataset = apify.getDataset(finalRun.defaultDatasetId)
  const items = await dataset.listItems({
    limit: input.maxResults || 1000,
    offset: input.offset || 0
  })

  // Filter by rating if specified
  let reviews = items
    .map(normalizeGoogleMapsReview)
    .filter((review): review is GoogleMapsReview => review !== null)
  const minRating = input.minRating
  if (typeof minRating === "number") {
    reviews = reviews.filter(r => r.rating >= minRating)
  }

  return reviews
}

/* ============================================================================
 * HELPERS
 * ========================================================================= */

const OPENING_HOURS_DAYS: Array<keyof OpeningHours> = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday'
]

type GoogleMapsSocialMedia = NonNullable<GoogleMapsPlace['socialMedia']>

function hasDefinedValue(values: unknown[]): boolean {
  return values.some((value) => value !== undefined)
}

function normalizeOpeningHoursByDay(hours: unknown): OpeningHours | undefined {
  const record = asRecord(hours)
  if (!record) {
    return undefined
  }

  const byDay: OpeningHours = {}
  for (const day of OPENING_HOURS_DAYS) {
    const value = asString(record[day])
    if (value) {
      byDay[day] = value
    }
  }

  return hasDefinedValue(Object.values(byDay)) ? byDay : undefined
}

function normalizeOpeningHours(hours: unknown, byDay?: OpeningHours): string[] | undefined {
  if (Array.isArray(hours)) {
    return asStringArray(hours)
  }

  if (byDay) {
    const normalized = OPENING_HOURS_DAYS
      .map((day) => {
        const value = byDay[day]
        return value ? `${day}: ${value}` : undefined
      })
      .filter((entry): entry is string => typeof entry === 'string')

    return normalized.length > 0 ? normalized : undefined
  }

  const single = asString(hours)
  return single ? [single] : undefined
}

function normalizeLocation(place: UnknownRecord, address?: string): Location | undefined {
  const locationRecord = asRecord(place.location)
  const latitude = asNumber(locationRecord?.lat) ?? asNumber(locationRecord?.latitude)
  const longitude = asNumber(locationRecord?.lng) ?? asNumber(locationRecord?.longitude)
  const city = asString(place.city)
  const state = asString(place.state)
  const country = asString(place.countryCode)
  const postalCode = asString(place.postalCode)

  if (!hasDefinedValue([latitude, longitude, address, city, state, country, postalCode])) {
    return undefined
  }

  return {
    latitude,
    longitude,
    address,
    city,
    state,
    country,
    postalCode
  }
}

function normalizeReviewsDistribution(value: unknown): ReviewsDistribution | undefined {
  const record = asRecord(value)
  if (!record) {
    return undefined
  }

  const distribution: ReviewsDistribution = {
    oneStar: asNumber(record.oneStar),
    twoStar: asNumber(record.twoStar),
    threeStar: asNumber(record.threeStar),
    fourStar: asNumber(record.fourStar),
    fiveStar: asNumber(record.fiveStar)
  }

  return hasDefinedValue(Object.values(distribution)) ? distribution : undefined
}

function normalizePopularTimes(value: unknown): PopularTimes[] | undefined {
  const entries = asArray(value)
  if (!entries) {
    return undefined
  }

  const normalized = entries
    .map((entry): PopularTimes | null => {
      const record = asRecord(entry)
      if (!record) {
        return null
      }

      const day = asString(record.day)
      const hours = asArray(record.hours)
      if (!day || !hours) {
        return null
      }

      const normalizedHours = hours
        .map((hour): PopularTimes['hours'][number] | null => {
          const hourRecord = asRecord(hour)
          if (!hourRecord) {
            return null
          }

          const hourValue = asNumber(hourRecord.hour)
          const occupancyPercent = asNumber(hourRecord.occupancyPercent)
          if (hourValue === undefined || occupancyPercent === undefined) {
            return null
          }

          return {
            hour: hourValue,
            occupancyPercent
          }
        })
        .filter((hour): hour is PopularTimes['hours'][number] => hour !== null)

      if (normalizedHours.length === 0) {
        return null
      }

      return {
        day,
        hours: normalizedHours
      }
    })
    .filter((entry): entry is PopularTimes => entry !== null)

  return normalized.length > 0 ? normalized : undefined
}

function normalizeSocialMedia(place: UnknownRecord): GoogleMapsSocialMedia | undefined {
  const facebook = asString(place.facebookUrl)
  const twitter = asString(place.twitterUrl)
  const instagram = asString(place.instagramUrl)
  const linkedin = asString(place.linkedinUrl)

  if (!hasDefinedValue([facebook, twitter, instagram, linkedin])) {
    return undefined
  }

  return {
    facebook,
    twitter,
    instagram,
    linkedin
  }
}

function normalizeContactInfo(
  place: UnknownRecord,
  socialMedia: GoogleMapsSocialMedia | undefined
): ContactInfo | undefined {
  const email = asString(place.email) ?? asString(place.companyEmail)
  const phone = asString(place.phone)
  const website = asString(place.website)

  if (!hasDefinedValue([email, phone, website, socialMedia])) {
    return undefined
  }

  return {
    email,
    phone,
    website,
    socialMedia
  }
}

function normalizeGoogleMapsReview(review: unknown): GoogleMapsReview | null {
  const record = asRecord(review)
  if (!record) {
    return null
  }

  const text = asString(record.text) ?? asString(record.reviewText)
  const publishedAtDate = asString(record.publishedAtDate) ?? asString(record.publishAt)
  const rating = asNumber(record.stars) ?? asNumber(record.rating)
  if (!text || !publishedAtDate || rating === undefined) {
    return null
  }

  return {
    id: asString(record.reviewId) ?? asString(record.id),
    text,
    publishedAtDate,
    rating,
    likesCount: asNumber(record.likesCount),
    reviewerId: asString(record.reviewerId),
    reviewerName: asString(record.name) ?? asString(record.reviewerName),
    reviewerPhotoUrl: asString(record.profilePhotoUrl) ?? asString(record.reviewerPhotoUrl),
    reviewerReviewsCount: asNumber(record.reviewerNumberOfReviews),
    responseFromOwner: asString(record.responseFromOwnerText),
    responseFromOwnerDate: asString(record.responseFromOwnerDate),
    imageUrls: asStringArray(record.reviewImageUrls) ?? asStringArray(record.imageUrls)
  }
}

function normalizeGoogleMapsPlace(place: unknown): GoogleMapsPlace | null {
  const record = asRecord(place)
  if (!record) {
    return null
  }

  const placeId = asString(record.placeId) ?? asString(record.id)
  const name = asString(record.title) ?? asString(record.name)
  const url = asString(record.url)
  if (!name || !placeId || !url) {
    return null
  }

  const category = asString(record.categoryName) ?? asString(record.category)
  const categories = asStringArray(record.categories) ?? (category ? [category] : undefined)
  const address = asString(record.address)
  const openingHoursByDay = normalizeOpeningHoursByDay(record.openingHours)
  const socialMedia = normalizeSocialMedia(record)
  const contactInfo = normalizeContactInfo(record, socialMedia)
  const normalizedReviews = asArray(record.reviews)
    ?.map(normalizeGoogleMapsReview)
    .filter((review): review is GoogleMapsReview => review !== null)
  const totalScore = asNumber(record.totalScore)

  return {
    placeId,
    name,
    url,
    category,
    categories,
    address,
    location: normalizeLocation(record, address),
    rating: totalScore ?? asNumber(record.rating),
    totalScore,
    reviewsCount: asNumber(record.reviewsCount),
    priceLevel: asNumber(record.priceLevel),
    phone: asString(record.phone),
    website: asString(record.website),
    email: asString(record.email) ?? asString(record.companyEmail),
    openingHours: normalizeOpeningHours(record.openingHours, openingHoursByDay),
    openingHoursByDay,
    popularTimes: normalizePopularTimes(record.popularTimesHistogram),
    isTemporarilyClosed: asBoolean(record.temporarilyClosed),
    isPermanentlyClosed: asBoolean(record.permanentlyClosed),
    reviewsDistribution: normalizeReviewsDistribution(record.reviewsDistribution),
    imageUrls: asStringArray(record.imageUrls),
    reviews: normalizedReviews && normalizedReviews.length > 0 ? normalizedReviews : undefined,
    contact: contactInfo,
    contactInfo,
    socialMedia,
    verificationStatus: asString(record.claimThisBusiness)
  }
}
