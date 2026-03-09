/**
 * YouTube Scraper
 *
 * Top Actors:
 * - streamers/youtube-scraper (40,455 users, 4.40 rating, $0.005/video)
 * - apidojo/youtube-scraper (4,336 users, 3.88 rating, $0.50/1k videos)
 *
 * Extract YouTube channels, videos, comments - no API quotas/limits!
 */

import { Apify } from '../../index'
import type {
  UserProfile,
  Post,
  PaginationOptions,
  ActorRunOptions
} from '../../types'
import {
  asBoolean,
  asNumber,
  asRecord,
  asString,
  asStringArray
} from '../shared/normalization'

/* ============================================================================
 * TYPES
 * ========================================================================= */

export interface YouTubeChannelInput {
  /** YouTube channel URL or ID */
  channelUrl: string
  /** Maximum number of videos to include */
  maxVideos?: number
}

export interface YouTubeChannel extends UserProfile {
  id: string
  title: string
  url: string
  description?: string
  subscribersCount?: number
  videosCount?: number
  viewsCount?: number
  joinedDate?: string
  country?: string
  thumbnailUrl?: string
  bannerUrl?: string
  verified?: boolean
  videos?: YouTubeVideo[]
}

export interface YouTubeVideo extends Post {
  id: string
  url: string
  title: string
  description?: string
  channelId?: string
  channelTitle?: string
  channelUrl?: string
  publishedAt: string
  viewsCount: number
  likesCount?: number
  commentsCount?: number
  duration?: string
  thumbnailUrl?: string
  tags?: string[]
  category?: string
}

export interface YouTubeSearchInput extends PaginationOptions {
  /** Search query */
  query: string
  /** Maximum number of videos */
  maxResults?: number
  /** Upload date filter */
  uploadDate?: 'hour' | 'today' | 'week' | 'month' | 'year'
  /** Duration filter */
  duration?: 'short' | 'medium' | 'long'
  /** Sort by */
  sortBy?: 'relevance' | 'date' | 'viewCount' | 'rating'
}

export interface YouTubeCommentsInput extends PaginationOptions {
  /** YouTube video URL or ID */
  videoUrl: string
  /** Maximum number of comments */
  maxResults?: number
}

export interface YouTubeComment {
  id: string
  text: string
  authorName: string
  authorChannelUrl?: string
  likesCount: number
  replyCount?: number
  publishedAt: string
}

interface NormalizedYouTubeChannel {
  id: string
  title: string
  url?: string
  description?: string
  subscribersCount?: number
  videosCount?: number
  viewsCount?: number
  joinedDate?: string
  country?: string
  thumbnailUrl?: string
  bannerUrl?: string
  verified?: boolean
}

/* ============================================================================
 * FUNCTIONS
 * ========================================================================= */

/**
 * Scrape YouTube channel data
 *
 * @param input - Channel scraping options
 * @param options - Actor run options
 * @returns YouTube channel with videos
 *
 * @example
 * ```typescript
 * const channel = await scrapeYouTubeChannel({
 *   channelUrl: 'https://www.youtube.com/@exampleuser',
 *   maxVideos: 50
 * })
 *
 * // Filter in code - only high-performing videos
 * const topVideos = channel.videos
 *   ?.filter(v => v.viewsCount > 10000)
 *   .sort((a, b) => b.viewsCount - a.viewsCount)
 *   .slice(0, 10)
 * ```
 */
export async function scrapeYouTubeChannel(
  input: YouTubeChannelInput,
  options?: ActorRunOptions
): Promise<YouTubeChannel> {
  const apify = new Apify()

  const run = await apify.callActor('streamers/youtube-channel-scraper', {
    startUrls: [input.channelUrl],
    maxResults: input.maxVideos || 50
  }, options)

  await apify.waitForRun(run.id)

  const finalRun = await apify.getRun(run.id)
  if (finalRun.status !== 'SUCCEEDED') {
    throw new Error(`YouTube channel scraping failed: ${finalRun.status}`)
  }

  const dataset = apify.getDataset(finalRun.defaultDatasetId)
  const items = await dataset.listItems()

  if (items.length === 0) {
    throw new Error(`Channel not found: ${input.channelUrl}`)
  }

  // First item is channel info, rest are videos
  const channelData = normalizeYouTubeChannel(items[0])
  if (!channelData) {
    throw new Error('Invalid YouTube channel payload shape')
  }

  const videos = items
    .slice(1)
    .map(normalizeYouTubeVideo)
    .filter((video): video is YouTubeVideo => video !== null)

  return {
    id: channelData.id,
    title: channelData.title,
    fullName: channelData.title,
    url: channelData.url || input.channelUrl,
    description: channelData.description,
    bio: channelData.description,
    subscribersCount: channelData.subscribersCount,
    followersCount: channelData.subscribersCount,
    videosCount: channelData.videosCount,
    viewsCount: channelData.viewsCount,
    joinedDate: channelData.joinedDate,
    country: channelData.country,
    thumbnailUrl: channelData.thumbnailUrl,
    bannerUrl: channelData.bannerUrl,
    verified: channelData.verified,
    videos
  }
}

/**
 * Search YouTube videos
 *
 * @param input - Search parameters
 * @param options - Actor run options
 * @returns Array of YouTube videos
 *
 * @example
 * ```typescript
 * const videos = await searchYouTube({
 *   query: 'artificial intelligence tutorial',
 *   maxResults: 100,
 *   uploadDate: 'month',
 *   sortBy: 'viewCount'
 * })
 *
 * // Filter in code - only videos with high engagement
 * const engaging = videos.filter(v =>
 *   v.viewsCount > 50000 &&
 *   (v.likesCount || 0) > 1000
 * )
 * ```
 */
export async function searchYouTube(
  input: YouTubeSearchInput,
  options?: ActorRunOptions
): Promise<YouTubeVideo[]> {
  const apify = new Apify()

  const run = await apify.callActor('streamers/youtube-scraper', {
    searchKeywords: input.query,
    maxResults: input.maxResults || 50,
    uploadDate: input.uploadDate,
    videoDuration: input.duration,
    sortBy: input.sortBy || 'relevance'
  }, options)

  await apify.waitForRun(run.id)

  const finalRun = await apify.getRun(run.id)
  if (finalRun.status !== 'SUCCEEDED') {
    throw new Error(`YouTube search failed: ${finalRun.status}`)
  }

  const dataset = apify.getDataset(finalRun.defaultDatasetId)
  const items = await dataset.listItems({
    limit: input.maxResults || 1000,
    offset: input.offset || 0
  })

  return items
    .map(normalizeYouTubeVideo)
    .filter((video): video is YouTubeVideo => video !== null)
}

/**
 * Scrape YouTube comments from a video
 *
 * @param input - Comment scraping options
 * @param options - Actor run options
 * @returns Array of comments
 *
 * @example
 * ```typescript
 * const comments = await scrapeYouTubeComments({
 *   videoUrl: 'https://www.youtube.com/watch?v=ABC123',
 *   maxResults: 500
 * })
 *
 * // Filter in code - only highly-liked comments
 * const popular = comments
 *   .filter(c => c.likesCount > 100)
 *   .sort((a, b) => b.likesCount - a.likesCount)
 * ```
 */
export async function scrapeYouTubeComments(
  input: YouTubeCommentsInput,
  options?: ActorRunOptions
): Promise<YouTubeComment[]> {
  const apify = new Apify()

  const run = await apify.callActor('streamers/youtube-comments-scraper', {
    startUrls: [input.videoUrl],
    maxComments: input.maxResults || 100
  }, options)

  await apify.waitForRun(run.id)

  const finalRun = await apify.getRun(run.id)
  if (finalRun.status !== 'SUCCEEDED') {
    throw new Error(`YouTube comments scraping failed: ${finalRun.status}`)
  }

  const dataset = apify.getDataset(finalRun.defaultDatasetId)
  const items = await dataset.listItems({
    limit: input.maxResults || 1000,
    offset: input.offset || 0
  })

  return items
    .map(normalizeYouTubeComment)
    .filter((comment): comment is YouTubeComment => comment !== null)
}

/* ============================================================================
 * HELPERS
 * ========================================================================= */

function extractVideoIdFromUrl(url: string): string | undefined {
  const watchMatch = /[?&]v=([A-Za-z0-9_-]{6,})/.exec(url)
  if (watchMatch?.[1]) {
    return watchMatch[1]
  }

  const shortUrlMatch = /youtu\.be\/([A-Za-z0-9_-]{6,})/.exec(url)
  if (shortUrlMatch?.[1]) {
    return shortUrlMatch[1]
  }

  const shortsMatch = /\/shorts\/([A-Za-z0-9_-]{6,})/.exec(url)
  return shortsMatch?.[1]
}

function normalizeYouTubeChannel(value: unknown): NormalizedYouTubeChannel | null {
  const channel = asRecord(value)
  if (!channel) {
    return null
  }

  const title = asString(channel.title)
  const channelId = asString(channel.channelId) ?? asString(channel.id)
  const url = asString(channel.url) ?? asString(channel.channelUrl)
  if (!title || (!channelId && !url)) {
    return null
  }

  const resolvedId = channelId ?? url
  if (!resolvedId) {
    return null
  }

  return {
    id: resolvedId,
    title,
    url,
    description: asString(channel.description),
    subscribersCount: asNumber(channel.numberOfSubscribers) ?? asNumber(channel.subscribersCount),
    videosCount: asNumber(channel.numberOfVideos) ?? asNumber(channel.videosCount),
    viewsCount: asNumber(channel.numberOfViews) ?? asNumber(channel.viewsCount),
    joinedDate: asString(channel.joinedDate),
    country: asString(channel.country),
    thumbnailUrl: asString(channel.thumbnailUrl) ?? asString(channel.thumbnail),
    bannerUrl: asString(channel.bannerUrl),
    verified: asBoolean(channel.verified)
  }
}

function normalizeYouTubeVideo(value: unknown): YouTubeVideo | null {
  const video = asRecord(value)
  if (!video) {
    return null
  }

  const title = asString(video.title)
  const publishedAt = asString(video.date) ?? asString(video.publishedAt)
  const idFromPayload = asString(video.id)
  const urlFromPayload = asString(video.url)
  const id = idFromPayload ?? (urlFromPayload ? extractVideoIdFromUrl(urlFromPayload) : undefined)

  if (!title || !publishedAt || !id) {
    return null
  }

  return {
    id,
    url: urlFromPayload ?? `https://www.youtube.com/watch?v=${id}`,
    title,
    text: asString(video.text) ?? title,
    description: asString(video.description),
    channelId: asString(video.channelId),
    channelTitle: asString(video.channelName) ?? asString(video.channelTitle),
    channelUrl: asString(video.channelUrl),
    publishedAt,
    timestamp: asString(video.timestamp) ?? publishedAt,
    viewsCount: asNumber(video.views) ?? asNumber(video.viewsCount) ?? 0,
    likesCount: asNumber(video.likes) ?? asNumber(video.likesCount),
    commentsCount: asNumber(video.numberOfComments) ?? asNumber(video.commentsCount),
    duration: asString(video.duration),
    thumbnailUrl: asString(video.thumbnail) ?? asString(video.thumbnailUrl),
    tags: asStringArray(video.tags),
    category: asString(video.category)
  }
}

function normalizeYouTubeComment(value: unknown): YouTubeComment | null {
  const comment = asRecord(value)
  if (!comment) {
    return null
  }

  const id = asString(comment.id)
  const text = asString(comment.text)
  const authorName = asString(comment.authorText) ?? asString(comment.authorName)
  const publishedAt = asString(comment.publishedTimeText) ?? asString(comment.publishedAt)
  if (!id || !text || !authorName || !publishedAt) {
    return null
  }

  return {
    id,
    text,
    authorName,
    authorChannelUrl: asString(comment.authorChannelUrl),
    likesCount: asNumber(comment.likesCount) ?? 0,
    replyCount: asNumber(comment.replyCount),
    publishedAt
  }
}
