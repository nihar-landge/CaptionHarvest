import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CAPTIONS_DIR = process.env.CAPTIONS_DIR || path.join(os.tmpdir(), 'playlist-captions')

interface SearchHit {
  videoId: string
  filename: string
  matches: { text: string; start?: string }[]
  totalMatches: number
}

/**
 * GET /api/search/[jobId]?q=query&limit=50
 * Searches across all transcript files (TXT) in a job's output directory.
 * Returns matching videoIds with context snippets around each match.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params
  if (!/^[a-f0-9-]{36}$/i.test(jobId)) {
    return NextResponse.json({ error: 'Invalid job id' }, { status: 400 })
  }

  const url = new URL(req.url)
  const query = url.searchParams.get('q') || ''
  const limit = Math.min(100, parseInt(url.searchParams.get('limit') || '50', 10))

  if (!query.trim()) {
    return NextResponse.json({ error: 'Missing query parameter "q"' }, { status: 400 })
  }

  const jobDir = path.join(CAPTIONS_DIR, jobId)
  try {
    const files = fs.readdirSync(jobDir)
    // Only search .txt files (transcripts), skip manifest/combined/zip
    const txtFiles = files.filter(
      (f) => f.endsWith('.txt') && !f.startsWith('all_transcripts') && !f.startsWith('manifest')
    )

    if (txtFiles.length === 0) {
      return NextResponse.json({ results: [], total: 0, query })
    }

    const queryLower = query.toLowerCase()
    const results: SearchHit[] = []

    for (const filename of txtFiles) {
      try {
        const content = fs.readFileSync(path.join(jobDir, filename), 'utf-8')
        const contentLower = content.toLowerCase()
        if (!contentLower.includes(queryLower)) continue

        // Extract videoId from filename: "...[videoId].txt"
        const vidMatch = filename.match(/\[([\w-]{6,30})\]\.txt$/)
        const videoId = vidMatch ? vidMatch[1] : filename.replace(/\.txt$/, '')

        // Find all match positions with context
        const matches: { text: string; start?: string }[] = []
        let idx = 0
        const maxSnippetsPerVideo = 3
        while (idx < contentLower.length && matches.length < maxSnippetsPerVideo) {
          const found = contentLower.indexOf(queryLower, idx)
          if (found === -1) break
          // Extract context: 60 chars before + query + 60 after
          const start = Math.max(0, found - 60)
          const end = Math.min(content.length, found + query.length + 60)
          let snippet = content.slice(start, end).replace(/\n/g, ' ').trim()
          if (start > 0) snippet = '…' + snippet
          if (end < content.length) snippet = snippet + '…'
          matches.push({ text: snippet })
          idx = found + query.length
        }

        // Count total matches
        let totalMatches = 0
        let pos = 0
        while (true) {
          const found = contentLower.indexOf(queryLower, pos)
          if (found === -1) break
          totalMatches++
          pos = found + query.length
        }

        results.push({ videoId, filename, matches, totalMatches })
      } catch {
        // skip unreadable files
      }
    }

    // Sort by total matches descending, take top N
    results.sort((a, b) => b.totalMatches - a.totalMatches)
    const limited = results.slice(0, limit)

    return NextResponse.json({
      results: limited,
      total: results.length,
      totalMatches: results.reduce((sum, r) => sum + r.totalMatches, 0),
      query,
    })
  } catch {
    return NextResponse.json(
      { error: 'Job directory not found' },
      { status: 404 }
    )
  }
}
