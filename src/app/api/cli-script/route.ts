import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-static'
export const runtime = 'nodejs'

/**
 * GET /api/cli-script
 * Returns a standalone Python CLI script that replicates the full
 * CaptionHarvest pipeline (playlist extraction + caption fetching + ZIP/CSV
 * packaging) so users can run it on their own machine (residential IP) where
 * YouTube doesn't bot-block. No dependencies beyond the Python stdlib.
 */
export async function GET(_req: NextRequest) {
  const script = CLI_SCRIPT
  return new NextResponse(script, {
    status: 200,
    headers: {
      'Content-Type': 'text/x-python; charset=utf-8',
      'Content-Length': String(Buffer.byteLength(script)),
      'Content-Disposition': 'attachment; filename="captionharvest.py"',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}

const CLI_SCRIPT = String.raw`#!/usr/bin/env python3
"""
CaptionHarvest — YouTube Playlist Transcript Extractor (standalone CLI)
=======================================================================

A single-file Python script that extracts captions from every video in a
YouTube playlist. No external dependencies — uses only the Python standard
library. Runs from your laptop (residential IP) where YouTube doesn't
bot-block.

Usage:
  python captionharvest.py <playlist_url_or_id> [output_dir] [options]

Examples:
  python captionharvest.py "https://www.youtube.com/playlist?list=PLxxxx"
  python captionharvest.py PLxxxx ./output --languages en,es --workers 4
  python captionharvest.py PLxxxx ./output --cookies cookies.txt

Options:
  --languages LANGS   Comma-separated caption languages to try (default: en)
  --workers N         Concurrent workers (default: 3, keep low to avoid 429s)
  --formats FMTS      Output formats: srt,vtt,txt (default: srt,txt)
  --cookies FILE      Path to a cookies.txt (Netscape) or raw cookie string
  --help              Show this help

Output:
  - SRT/TXT files per video in the output dir
  - manifest.csv with per-video status
  - all_transcripts.txt + all_transcripts.json (merged)
  - captions.zip (everything bundled)
"""

import argparse
import csv
import json
import os
import re
import sys
import time
import random
import zipfile
import urllib.request
import urllib.parse
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from http.cookiejar import MozillaCookieJar

# --------------------------------------------------------------------------- #
# Config
# --------------------------------------------------------------------------- #
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
DEFAULT_API_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8"
DEFAULT_CLIENT_VERSION = "2.20260708.00.00"


# --------------------------------------------------------------------------- #
# HTTP helper
# --------------------------------------------------------------------------- #
def http_get(url, headers=None, cookies=None, timeout=30):
    hdrs = {"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"}
    if headers:
        hdrs.update(headers)
    if cookies:
        hdrs["Cookie"] = cookies
    req = urllib.request.Request(url, headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8", "ignore"), dict(resp.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "ignore"), {}
    except Exception as e:
        return 0, str(e), {}


def http_post(url, body, headers=None, cookies=None, timeout=30):
    hdrs = {"User-Agent": UA, "Content-Type": "application/json", "Accept-Language": "en-US,en;q=0.9"}
    if headers:
        hdrs.update(headers)
    if cookies:
        hdrs["Cookie"] = cookies
    data = body.encode("utf-8") if isinstance(body, str) else body
    req = urllib.request.Request(url, data=data, headers=hdrs, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8", "ignore"), dict(resp.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "ignore"), {}
    except Exception as e:
        return 0, str(e), {}


# --------------------------------------------------------------------------- #
# JSON extraction (brace-matching)
# --------------------------------------------------------------------------- #
def extract_json_object(html, key):
    idx = html.find(key)
    if idx == -1:
        return None
    open_idx = html.find("{", idx)
    if open_idx == -1:
        return None
    depth = 0
    end = -1
    in_str = False
    esc = False
    for i in range(open_idx, len(html)):
        c = html[i]
        if in_str:
            if esc:
                esc = False
                continue
            if c == "\\":
                esc = True
                continue
            if c == '"':
                in_str = False
            continue
        if c == '"':
            in_str = True
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if end == -1:
        return None
    try:
        return json.loads(html[open_idx:end])
    except Exception:
        return None


def walk(obj, cb):
    if isinstance(obj, dict):
        for k, v in obj.items():
            cb(v, k, obj)
            walk(v, cb)
    elif isinstance(obj, list):
        for v in obj:
            walk(v, cb)


def find_all(obj, key):
    out = []
    def cb(v, k, parent):
        if k == key:
            out.append(v)
    walk(obj, cb)
    return out


# --------------------------------------------------------------------------- #
# Playlist extraction (InnerTube lockupViewModel + continuation)
# --------------------------------------------------------------------------- #
def extract_playlist_id(url):
    m = re.search(r"[?&]list=([a-zA-Z0-9_-]+)", url)
    if m:
        return m.group(1)
    if re.match(r"^(PL|OL|UU|RD|FL|LL|PU)[\w-]+$", url.strip()):
        return url.strip()
    return None


def parse_title(t):
    if t is None:
        return None
    if isinstance(t, str):
        return t
    if isinstance(t, dict):
        if isinstance(t.get("content"), str):
            return t["content"]
        if isinstance(t.get("simpleText"), str):
            return t["simpleText"]
        if isinstance(t.get("runs"), list) and t["runs"]:
            return "".join(r.get("text", "") for r in t["runs"])
    return None


def parse_lockup(lvm):
    if not isinstance(lvm, dict):
        return None
    vid = lvm.get("contentId")
    if not vid:
        vids = find_all(lvm, "videoId")
        vid = vids[0] if vids else None
    if not vid:
        return None
    md = (lvm.get("metadata") or {}).get("lockupMetadataViewModel", {})
    title = parse_title(md.get("title")) or vid
    length_seconds = None
    for b in find_all(lvm, "thumbnailBadgeViewModel"):
        lbl = b.get("text", "")
        if isinstance(lbl, str) and re.match(r"^\d", lbl):
            parts = lbl.split(":")
            try:
                sec = 0
                for p in parts:
                    sec = sec * 60 + int(p)
                length_seconds = sec
                break
            except ValueError:
                pass
    return {"id": vid, "title": title, "lengthSeconds": length_seconds}


def parse_playlist_video_renderer(pvr):
    if not pvr:
        return None
    vid = pvr.get("videoId")
    if not vid:
        return None
    return {"id": vid, "title": parse_title(pvr.get("title")) or vid}


def find_continuation_token(data):
    result = [None]
    def cb(v, k, parent):
        if result[0]:
            return
        if k == "continuationCommand" and isinstance(v, dict):
            if v.get("request") == "CONTINUATION_REQUEST_TYPE_BROWSE" and isinstance(v.get("token"), str):
                result[0] = v["token"]
    walk(data, cb)
    return result[0]


def collect_videos(data):
    out = []
    seen = set()
    for lvm in find_all(data, "lockupViewModel"):
        v = parse_lockup(lvm)
        if v and v["id"] not in seen:
            seen.add(v["id"])
            out.append(v)
    for pvr in find_all(data, "playlistVideoRenderer"):
        v = parse_playlist_video_renderer(pvr)
        if v and v["id"] not in seen:
            seen.add(v["id"])
            out.append(v)
    return out


def extract_playlist(url, cookies=None, on_progress=None):
    pid = extract_playlist_id(url)
    if not pid:
        raise ValueError("Could not find a playlist ID in the URL (need ?list=...)")
    page_url = f"https://www.youtube.com/playlist?list={pid}&hl=en"
    if on_progress:
        on_progress("Fetching playlist page...")
    status, html, _ = http_get(page_url, cookies=cookies)
    if status != 200:
        raise RuntimeError(f"Playlist page HTTP {status}")
    yid = extract_json_object(html, "ytInitialData")
    if not yid:
        raise RuntimeError("YouTube did not return ytInitialData (possible bot-check page).")
    title = (
        (yid.get("metadata") or {}).get("playlistMetadataRenderer", {}).get("title")
        or pid
    )
    m = re.search(r'"INNERTUBE_API_KEY":"([^"]+)"', html)
    api_key = m.group(1) if m else DEFAULT_API_KEY
    m = re.search(r'"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"', html)
    client_version = m.group(1) if m else DEFAULT_CLIENT_VERSION

    videos = []
    seen = set()
    for v in collect_videos(yid):
        if v["id"] not in seen:
            seen.add(v["id"])
            videos.append(v)
    if on_progress:
        on_progress(f"Found {len(videos)} videos on the first page")

    token = find_continuation_token(yid)
    page = 0
    while token and page < 200:
        page += 1
        body = json.dumps({
            "context": {"client": {"clientName": "WEB", "clientVersion": client_version, "hl": "en", "gl": "US"}},
            "continuation": token,
        })
        status, resp, _ = http_post(
            f"https://www.youtube.com/youtubei/v1/browse?key={api_key}",
            body, cookies=cookies,
        )
        if status != 200:
            if on_progress:
                on_progress(f"Continuation page {page} failed: HTTP {status}")
            break
        try:
            rj = json.loads(resp)
        except Exception:
            break
        before = len(videos)
        for v in collect_videos(rj):
            if v["id"] not in seen:
                seen.add(v["id"])
                videos.append(v)
        added = len(videos) - before
        if on_progress:
            on_progress(f"Page {page}: +{added} videos (total {len(videos)})")
        token = find_continuation_token(rj)
        if token:
            time.sleep(0.3)
    if not videos:
        raise RuntimeError("Playlist parsed but no videos found (may be empty or private).")
    return title, videos


# --------------------------------------------------------------------------- #
# Caption track selection
# --------------------------------------------------------------------------- #
def is_auto_track(t):
    return t.get("kind") == "asr" or (t.get("vssId", "") or "").startswith("a.")


def lang_matches(track, lang):
    code = (track.get("languageCode") or "").lower()
    return code == lang.lower() or code.startswith(lang.lower() + "-")


def pick_track(tracks, languages):
    if not tracks:
        return None, None
    # 1. Manual tracks in requested languages
    for lang in languages:
        for t in tracks:
            if lang_matches(t, lang) and not is_auto_track(t):
                return t, "manual"
    # 2. Auto-generated tracks in requested languages
    for lang in languages:
        for t in tracks:
            if lang_matches(t, lang) and is_auto_track(t):
                return t, "auto"
    # 3. Auto-translated
    for base in [t for t in tracks if not is_auto_track(t)] + [t for t in tracks if is_auto_track(t)]:
        if not base.get("isTranslatable"):
            continue
        for lang in languages:
            if not any(lang_matches(t, lang) for t in tracks):
                return {**base, "languageCode": lang,
                        "baseUrl": base["baseUrl"] + "&tlang=" + lang.lower()}, "translated"
    # 4. Any manual
    for t in tracks:
        if not is_auto_track(t):
            return t, "manual"
    # 5. Any auto
    for t in tracks:
        if is_auto_track(t):
            return t, "auto"
    return None, None


# --------------------------------------------------------------------------- #
# Caption parsing
# --------------------------------------------------------------------------- #
def decode_entities(s):
    return (s.replace("&amp;", "&").replace("&#39;", "'").replace("&quot;", '"')
             .replace("&lt;", "<").replace("&gt;", ">").replace("&apos;", "'")
             .replace("&#x27;", "'"))


def parse_json3(j):
    snippets = []
    for ev in j.get("events", []):
        if not ev.get("segs"):
            continue
        text = "".join(s.get("utf8", "") for s in ev["segs"]).replace("\n", " ")
        clean = re.sub(r"<[^>]+>", "", decode_entities(text)).strip()
        if not clean:
            continue
        start = ev.get("tStartMs", 0) / 1000
        duration = ev.get("dDurationMs", 0) / 1000
        snippets.append({"text": clean, "start": start, "duration": duration or 2})
    return snippets


def parse_xml(xml):
    snippets = []
    for m in re.finditer(r'<text\s+([^>]*)>([\s\S]*?)</text>', xml):
        attrs, raw = m.group(1), m.group(2)
        sm = re.search(r'start="([\d.]+)"', attrs)
        dm = re.search(r'dur="([\d.]+)"', attrs)
        start = float(sm.group(1)) if sm else 0
        duration = float(dm.group(1)) if dm else 2
        text = re.sub(r"<[^>]+>", "", decode_entities(raw)).replace("\n", " ").strip()
        if text:
            snippets.append({"text": text, "start": start, "duration": duration})
    return snippets


def parse_vtt(vtt):
    snippets = []
    lines = vtt.split("\n")
    i = 0
    while i < len(lines):
        m = re.match(r'(\d+):(\d+):(\d+)[.,](\d+)\s*-->\s*(\d+):(\d+):(\d+)[.,](\d+)', lines[i])
        if m:
            start = int(m[1]) * 3600 + int(m[2]) * 60 + int(m[3]) + int(m[4]) / 1000
            end = int(m[5]) * 3600 + int(m[6]) * 60 + int(m[7]) + int(m[8]) / 1000
            text_lines = []
            i += 1
            while i < len(lines) and lines[i].strip():
                text_lines.append(re.sub(r"<[^>]+>", "", lines[i]))
                i += 1
            text = decode_entities(" ".join(text_lines)).strip()
            if text:
                snippets.append({"text": text, "start": start, "duration": max(0.5, end - start)})
        i += 1
    return snippets


# --------------------------------------------------------------------------- #
# Transcript fetching
# --------------------------------------------------------------------------- #
def format_ts(s):
    h = int(s // 3600)
    m = int((s % 3600) // 60)
    sec = int(s % 60)
    ms = int(round((s - int(s)) * 1000))
    return f"{h:02d}:{m:02d}:{sec:02d},{ms:03d}"


def write_srt(snippets):
    out = ""
    for i, sn in enumerate(snippets, 1):
        out += f"{i}\n{format_ts(sn['start'])} --> {format_ts(sn['start'] + sn['duration'])}\n{sn['text']}\n\n"
    return out


def write_vtt(snippets):
    # WebVTT: "WEBVTT" header, timestamps use "." instead of "," as ms separator
    out = "WEBVTT\n\n"
    for i, sn in enumerate(snippets, 1):
        start = format_ts(sn['start']).replace(',', '.')
        end = format_ts(sn['start'] + sn['duration']).replace(',', '.')
        out += f"{i}\n{start} --> {end}\n{sn['text']}\n\n"
    return out


def write_txt(snippets):
    return " ".join(re.sub(r"\s+", " ", sn["text"]).strip() for sn in snippets if sn["text"].strip())


def fetch_transcript(video_id, languages, cookies=None, max_retries=3):
    """Fetch transcript via watch-page scrape. Returns (snippets, source, lang_code) or raises."""
    watch_url = f"https://www.youtube.com/watch?v={video_id}"
    status, html, _ = http_get(watch_url, cookies=cookies)
    if status != 200:
        raise RuntimeError(f"watch page HTTP {status}")
    player = extract_json_object(html, "ytInitialPlayerResponse")
    if not player:
        raise RuntimeError("ytInitialPlayerResponse not found")
    playability = (player.get("playabilityStatus") or {}).get("status")
    reason = (player.get("playabilityStatus") or {}).get("reason", "")
    if playability and playability != "OK":
        raise RuntimeError(f"YouTube playability: {playability} — {reason}")
    tracks = (player.get("captions") or {}).get("playerCaptionsTracklistRenderer", {}).get("captionTracks", [])
    if not tracks:
        raise RuntimeError("No caption tracks available")
    track, source = pick_track(tracks, languages)
    if not track:
        raise RuntimeError("No matching caption track")
    base = track["baseUrl"]
    for u in [base + ("&" if "?" in base else "?") + "fmt=json3",
              base + ("&" if "?" in base else "?") + "fmt=vtt", base]:
        status, body, _ = http_get(u, cookies=cookies)
        if status != 200 or not body.strip():
            continue
        if body.strip().startswith("{") or "fmt=json3" in u:
            try:
                sn = parse_json3(json.loads(body))
                if sn:
                    return sn, source, track.get("languageCode")
            except Exception:
                pass
        if "<text" in body:
            sn = parse_xml(body)
            if sn:
                return sn, source, track.get("languageCode")
        if "WEBVTT" in body:
            sn = parse_vtt(body)
            if sn:
                return sn, source, track.get("languageCode")
    raise RuntimeError("All caption fetch attempts returned empty")


def safe_name(name):
    cleaned = re.sub(r'[\\/:*?"<>|]', " ", name).strip()[:120]
    return cleaned or "untitled"


def process_video(idx, video, languages, out_dir, formats, cookies):
    vid = video["id"]
    title = video.get("title", vid)
    pos = video.get("position", idx)
    start = time.time()
    base_name = f"{str(pos + 1).zfill(3)} {safe_name(title)} [{vid}]"
    # Build file paths for all requested formats
    paths = {}
    for fmt in ["srt", "vtt", "txt"]:
        if fmt in formats:
            paths[fmt] = os.path.join(out_dir, base_name + f".{fmt}")
    # Resume: skip if any requested format file already exists
    if any(os.path.exists(p) for p in paths.values()):
        return {"video": video, "status": "skipped", "durationMs": (time.time() - start) * 1000}
    try:
        snippets, source, lang = fetch_transcript(vid, languages, cookies)
        if not snippets:
            return {"video": video, "status": "no-captions", "error": "Empty", "durationMs": (time.time() - start) * 1000}
        if "srt" in paths:
            with open(paths["srt"], "w", encoding="utf-8") as f:
                f.write(write_srt(snippets))
        if "vtt" in paths:
            with open(paths["vtt"], "w", encoding="utf-8") as f:
                f.write(write_vtt(snippets))
        if "txt" in paths:
            with open(paths["txt"], "w", encoding="utf-8") as f:
                f.write(write_txt(snippets))
        size = 0
        for p in paths.values():
            if os.path.exists(p):
                size += os.path.getsize(p)
        return {"video": video, "status": "ok", "snippetCount": len(snippets),
                "fileSize": size, "captionSource": source, "language": lang,
                "durationMs": (time.time() - start) * 1000}
    except Exception as e:
        msg = str(e)
        status = "blocked" if re.search(r"Sign in|LOGIN_REQUIRED|429|bot|playability", msg, re.I) else (
            "no-captions" if re.search(r"No caption|disabled|not found", msg, re.I) else "failed"
        )
        return {"video": video, "status": status, "error": msg[:300], "durationMs": (time.time() - start) * 1000}


# --------------------------------------------------------------------------- #
# Packaging
# --------------------------------------------------------------------------- #
def package_zip(out_dir, results, playlist_title, formats):
    # Manifest CSV
    manifest_path = os.path.join(out_dir, "manifest.csv")
    with open(manifest_path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["position", "video_id", "title", "status", "caption_source", "language", "error", "snippets", "file_size_bytes", "duration_ms"])
        for r in results:
            v = r["video"]
            w.writerow([v.get("position", 0) + 1, v["id"], v.get("title", ""), r["status"],
                        r.get("captionSource", ""), r.get("language", ""), r.get("error", ""),
                        r.get("snippetCount", ""), r.get("fileSize", ""), r.get("durationMs", "")])
    # Combined exports
    ok = [r for r in results if r["status"] == "ok"]
    if ok:
        txt_parts, json_parts = [], []
        for r in ok:
            v = r["video"]
            base = f"{str(v.get('position', 0) + 1).zfill(3)} {safe_name(v.get('title', v['id']))} [{v['id']}]"
            content = ""
            try:
                with open(os.path.join(out_dir, base + ".txt"), encoding="utf-8") as f:
                    content = f.read()
            except FileNotFoundError:
                try:
                    with open(os.path.join(out_dir, base + ".srt"), encoding="utf-8") as f:
                        content = re.sub(r'^\d+\n[\d:,.]+ --> [\d:,.]+\n', '', f.read(), flags=re.M).strip()
                except FileNotFoundError:
                    pass
            txt_parts.append(f"=== {v.get('title', v['id'])} ===\nVideo: https://www.youtube.com/watch?v={v['id']}\nSource: {r.get('captionSource', 'unknown')}\n\n{content}\n")
            json_parts.append({"videoId": v["id"], "title": v.get("title", ""), "url": f"https://www.youtube.com/watch?v={v['id']}",
                               "captionSource": r.get("captionSource"), "language": r.get("language"),
                               "snippetCount": r.get("snippetCount"), "text": content})
        with open(os.path.join(out_dir, "all_transcripts.txt"), "w", encoding="utf-8") as f:
            f.write(("\n" + "-" * 60 + "\n\n").join(txt_parts))
        with open(os.path.join(out_dir, "all_transcripts.json"), "w", encoding="utf-8") as f:
            json.dump({"playlist": playlist_title, "total": len(ok), "transcripts": json_parts}, f, indent=2)
    # ZIP
    zip_path = os.path.join(out_dir, "captions.zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for fn in sorted(os.listdir(out_dir)):
            if fn.endswith(".zip"):
                continue
            zf.write(os.path.join(out_dir, fn), fn)
    return zip_path, manifest_path


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def main():
    parser = argparse.ArgumentParser(description="CaptionHarvest — YouTube Playlist Transcript Extractor")
    parser.add_argument("url", help="Playlist URL or ID")
    parser.add_argument("output", nargs="?", default="./captions_output", help="Output directory (default: ./captions_output)")
    parser.add_argument("--languages", default="en", help="Comma-separated languages (default: en)")
    parser.add_argument("--workers", type=int, default=3, help="Concurrent workers (default: 3)")
    parser.add_argument("--formats", default="srt,txt", help="Output formats (default: srt,txt)")
    parser.add_argument("--cookies", default=None, help="cookies.txt path or raw cookie string")
    args = parser.parse_args()

    languages = [l.strip() for l in args.languages.split(",") if l.strip()]
    formats = [f.strip() for f in args.formats.split(",") if f.strip()]
    cookies = args.cookies

    # Load cookies from file if it's a path
    if cookies and os.path.exists(cookies):
        try:
            cj = MozillaCookieJar(cookies)
            cj.load(ignore_discard=True, ignore_expires=True)
            cookies = "; ".join(f"{c.name}={c.value}" for c in cj)
            print(f"Loaded {len(cj)} cookies from {args.cookies}")
        except Exception as e:
            print(f"Warning: could not load cookies file: {e}", file=sys.stderr)

    os.makedirs(args.output, exist_ok=True)

    print(f"\n  CaptionHarvest")
    print(f"  {'=' * 50}")
    print(f"  Playlist: {args.url}")
    print(f"  Languages: {', '.join(languages)}")
    print(f"  Workers: {args.workers}")
    print(f"  Formats: {', '.join(formats)}")
    print(f"  Cookies: {'yes' if cookies else 'no'}")
    print(f"  Output: {args.output}\n")

    # 1. Extract playlist
    print("→ Extracting playlist...")
    def on_progress(msg):
        print(f"   {msg}")
    playlist_title, videos = extract_playlist(args.url, cookies=cookies, on_progress=on_progress)
    print(f"\n   Playlist: {playlist_title}")
    print(f"   Total videos: {len(videos)}\n")

    # 2. Fetch transcripts
    print("→ Fetching transcripts...")
    results = []
    done = 0
    total = len(videos)
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = {
            ex.submit(process_video, i, {**v, "position": i}, languages, args.output, formats, cookies): v
            for i, v in enumerate(videos)
        }
        for fut in as_completed(futures):
            try:
                r = fut.result()
            except Exception as e:
                v = futures[fut]
                r = {"video": v, "status": "failed", "error": str(e)[:300]}
            results.append(r)
            done += 1
            v = r["video"]
            extra = ""
            if r["status"] == "ok":
                extra = f" ({r.get('snippetCount', 0)} snippets, {r.get('fileSize', 0) / 1024:.1f} KB"
                if r.get("captionSource") and r["captionSource"] != "unknown":
                    extra += f", {r['captionSource']})"
                else:
                    extra += ")"
            elif r.get("error"):
                extra = f" — {r['error'][:80]}"
            print(f"   [{done}/{total}] {v.get('title', v['id'])[:60]}{extra}")

    # 3. Package
    print("\n→ Packaging ZIP + manifest...")
    zip_path, manifest_path = package_zip(args.output, results, playlist_title, formats)

    # Summary
    ok = sum(1 for r in results if r["status"] == "ok")
    blocked = sum(1 for r in results if r["status"] == "blocked")
    no_cap = sum(1 for r in results if r["status"] == "no-captions")
    failed = sum(1 for r in results if r["status"] == "failed")
    print(f"\n  {'=' * 50}")
    print(f"  Done! {ok}/{total} captured, {blocked} blocked, {no_cap} no-captions, {failed} failed")
    print(f"  ZIP: {zip_path}")
    print(f"  Manifest: {manifest_path}")
    if blocked > 0 and ok == 0:
        print(f"\n  ⚠  All videos were blocked. YouTube is bot-detecting this IP.")
        print(f"     Try: --cookies cookies.txt  (export from a logged-in browser)")
        print(f"     Or run from a residential connection (your laptop).")
    print()


if __name__ == "__main__":
    main()
`
