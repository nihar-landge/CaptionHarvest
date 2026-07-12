'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTheme } from 'next-themes'
import {
  Youtube,
  Link2,
  Languages,
  Gauge,
  FileText,
  Captions,
  Play,
  Square,
  RotateCcw,
  RefreshCw,
  Download,
  FileDown,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Ban,
  Loader2,
  Terminal,
  ListChecks,
  Clock,
  Hash,
  CircleSlash,
  Sparkles,
  ArrowDownToLine,
  Wifi,
  WifiOff,
  Film,
  Hourglass,
  Activity,
  ShieldAlert,
  Info,
  Moon,
  Sun,
  Search,
  FileJson,
  Eye,
  Copy,
  Check,
  FileStack,
  Type,
  KeyRound,
  ChevronRight,
  ChevronDown,
  HelpCircle,
  Monitor,
  Globe,
  History,
  Trash2,
  FileSearch,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  useTranscriptJob,
  type JobStatus,
  type VideoResult,
  type VideoStatus,
} from '@/hooks/use-transcript-job'

const QUICK_LANGS = ['en', 'en-GB', 'es', 'fr', 'de', 'hi', 'pt', 'ja', 'ko', 'zh', 'ar', 'ru']

function isPlaylistUrl(url: string): boolean {
  const v = url.trim()
  if (!v) return false
  return (
    /[?&]list=/.test(v) ||
    /^(PL|OL|UU|RD|FL|LL)[\w-]+$/.test(v)
  )
}

function formatDuration(ms: number): string {
  if (!ms || ms < 0) return '0s'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rs = s % 60
  if (m < 60) return `${m}m ${rs}s`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return `${h}h ${rm}m`
}

function formatBytes(n?: number): string {
  if (!n) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

const STATUS_META: Record<
  VideoStatus,
  { label: string; icon: typeof CheckCircle2; cls: string }
> = {
  ok: {
    label: 'Captured',
    icon: CheckCircle2,
    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900',
  },
  failed: {
    label: 'Failed',
    icon: XCircle,
    cls: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900',
  },
  'no-captions': {
    label: 'No captions',
    icon: CircleSlash,
    cls: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900',
  },
  skipped: {
    label: 'Skipped',
    icon: Ban,
    cls: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:border-slate-700',
  },
  blocked: {
    label: 'Blocked',
    icon: ShieldAlert,
    cls: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200 dark:bg-fuchsia-950/40 dark:text-fuchsia-300 dark:border-fuchsia-900',
  },
  processing: {
    label: 'Working',
    icon: Loader2,
    cls: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900',
  },
}

export function TranscriptApp() {
  const job = useTranscriptJob()
  const [url, setUrl] = useState('')
  const [langInput, setLangInput] = useState('en')
  const [workers, setWorkers] = useState(3)
  const [fmtSrt, setFmtSrt] = useState(true)
  const [fmtVtt, setFmtVtt] = useState(false)
  const [fmtTxt, setFmtTxt] = useState(true)
  const [cookies, setCookies] = useState('')
  const [filenamePattern, setFilenamePattern] = useState<'verbose' | 'title' | 'position' | 'videoId'>('verbose')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  const languages = useMemo(
    () =>
      Array.from(
        new Set(
          langInput
            .split(',')
            .map((l) => l.trim())
            .filter(Boolean)
        )
      ),
    [langInput]
  )

  const valid = isPlaylistUrl(url)
  const formats = useMemo(() => {
    const f: ('srt' | 'txt' | 'vtt')[] = []
    if (fmtSrt) f.push('srt')
    if (fmtVtt) f.push('vtt')
    if (fmtTxt) f.push('txt')
    return f.length ? f : ['srt']
  }, [fmtSrt, fmtVtt, fmtTxt])

  const isRunning = ['queued', 'extracting', 'fetching', 'packaging'].includes(job.status)
  const hasJob = job.status !== 'idle'

  const handleStart = () => {
    if (!valid || !job.connected || formats.length === 0) return
    job.start({ url: url.trim(), languages, workers, formats, filenamePattern, cookies: cookies.trim() || undefined })
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-rose-50/60 via-white to-white dark:from-rose-950/10 dark:via-background dark:to-background relative">
      {/* Decorative grid pattern background */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.035] dark:opacity-[0.05]"
        style={{
          backgroundImage:
            'linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)',
          backgroundSize: '32px 32px',
          maskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 40%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 40%, transparent 100%)',
        }}
      />
      <Header
        connected={job.connected}
        jobHistory={job.jobHistory}
        currentJobId={job.jobId}
        onOpenHistory={job.listJobs}
        onRestoreJob={job.restoreJob}
        onDeleteJob={job.deleteJob}
      />

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-10 relative">
        {/* Hero */}
        <section className="pt-8 sm:pt-12 pb-6 text-center">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-gradient-to-r from-rose-50 via-rose-100/80 to-rose-50 dark:border-rose-900 dark:from-rose-950/30 dark:via-rose-900/20 dark:to-rose-950/30 px-3 py-1 text-xs font-medium text-rose-700 dark:text-rose-300 mb-4 bg-[length:200%_auto] animate-[shimmer_4s_linear_infinite]"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Playlist → Captions · 300+ videos in minutes
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.05 }}
            className="text-3xl sm:text-5xl font-bold tracking-tight text-foreground"
          >
            YouTube Playlist
            <span className="text-rose-600 dark:text-rose-400"> Transcript Extractor</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="mt-4 max-w-2xl mx-auto text-muted-foreground text-sm sm:text-base"
          >
            Paste a playlist link, pick your languages, and download every video's captions as a tidy ZIP of
            SRT + TXT files — with a manifest of what worked and what didn't.
          </motion.p>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.2 }}
            className="mt-4 flex items-center justify-center gap-2"
          >
            <Button variant="ghost" size="sm" onClick={() => setShowHelp(true)} className="text-xs text-muted-foreground hover:text-foreground">
              <HelpCircle className="h-3.5 w-3.5 mr-1.5" />
              Seeing errors? Read why
            </Button>
          </motion.div>
        </section>

        {/* Form */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.15 }}
        >
          <Card className="border-border/70 shadow-sm overflow-hidden">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Link2 className="h-4 w-4 text-rose-500" />
                Playlist details
              </CardTitle>
              <CardDescription>
                Works with public &amp; unlisted playlists. No API key, no quota, no sign-in.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* URL */}
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <Youtube className="h-4 w-4 text-rose-500" />
                  Playlist URL
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && valid && job.connected && !isRunning) handleStart()
                    }}
                    placeholder="https://www.youtube.com/playlist?list=PL..."
                    className="flex-1 h-11 font-mono text-sm"
                    disabled={isRunning}
                  />
                  {valid && !hasJob && (
                    <kbd className="hidden sm:inline-flex items-center gap-0.5 text-[10px] text-muted-foreground font-mono px-1.5 py-0.5 rounded border border-border bg-muted/50 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                      ↵
                    </kbd>
                  )}
                  {!hasJob ? (
                    <Button
                      size="lg"
                      onClick={handleStart}
                      disabled={!valid || !job.connected || formats.length === 0 || isRunning}
                      className="h-11 px-6 bg-rose-600 hover:bg-rose-700 text-white shadow-sm"
                    >
                      <Play className="h-4 w-4 mr-1.5" />
                      Extract captions
                    </Button>
                  ) : isRunning ? (
                    <Button size="lg" variant="destructive" onClick={job.cancel} className="h-11 px-6">
                      <Square className="h-4 w-4 mr-1.5" />
                      Cancel
                    </Button>
                  ) : (
                    <Button size="lg" variant="outline" onClick={job.reset} className="h-11 px-6">
                      <RotateCcw className="h-4 w-4 mr-1.5" />
                      New job
                    </Button>
                  )}
                </div>
                {url && !valid && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Hmm, that doesn't look like a playlist URL. It needs a <code className="px-1 py-0.5 rounded bg-muted">?list=</code> parameter.
                  </p>
                )}
                {!job.connected && (
                  <p className="text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1">
                    <WifiOff className="h-3 w-3" />
                    Connecting to extraction service…
                  </p>
                )}
              </div>

              {/* Languages */}
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <Languages className="h-4 w-4 text-rose-500" />
                  Languages <span className="text-muted-foreground font-normal">(try in order)</span>
                </label>
                <Input
                  value={langInput}
                  onChange={(e) => setLangInput(e.target.value)}
                  placeholder="en, es, fr"
                  className="font-mono text-sm"
                  disabled={isRunning}
                />
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_LANGS.map((l) => {
                    const active = languages.includes(l)
                    return (
                      <button
                        key={l}
                        type="button"
                        disabled={isRunning}
                        onClick={() => {
                          const set = new Set(languages)
                          if (set.has(l)) set.delete(l)
                          else set.add(l)
                          setLangInput(Array.from(set).join(', '))
                        }}
                        className={`text-xs px-2.5 py-1 rounded-full border transition-colors disabled:opacity-50 ${
                          active
                            ? 'bg-rose-600 text-white border-rose-600'
                            : 'bg-background border-border text-muted-foreground hover:border-rose-400 hover:text-rose-600'
                        }`}
                      >
                        {l}
                      </button>
                    )
                  })}
                </div>
                <div className="flex items-start gap-2 rounded-lg border border-violet-200 bg-violet-50/60 dark:border-violet-900 dark:bg-violet-950/20 px-3 py-2">
                  <Sparkles className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400 mt-0.5 flex-shrink-0" />
                  <p className="text-[11px] leading-relaxed text-violet-800 dark:text-violet-200/80">
                    <strong className="text-violet-900 dark:text-violet-100">Auto-generated captions are used automatically</strong>{' '}
                    when a video has no uploader-authored captions in your chosen language. Each result shows its source
                    (<span className="font-medium">Manual</span> / <span className="font-medium">Auto-gen</span> / <span className="font-medium">Translated</span>),
                    and the manifest CSV records it too.
                  </p>
                </div>
              </div>

              {/* Workers + formats */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div className="space-y-2.5">
                  <label className="text-sm font-medium flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <Gauge className="h-4 w-4 text-rose-500" />
                      Concurrent workers
                    </span>
                    <Badge variant="secondary" className="font-mono">{workers}</Badge>
                  </label>
                  <Slider
                    value={[workers]}
                    onValueChange={(v) => setWorkers(v[0])}
                    min={1}
                    max={6}
                    step={1}
                    disabled={isRunning}
                  />
                  <p className="text-xs text-muted-foreground">
                    Keep at 2–4 to dodge YouTube rate limits. Higher = faster but riskier.
                  </p>
                </div>

                <div className="space-y-2.5">
                  <label className="text-sm font-medium flex items-center gap-1.5">
                    <FileText className="h-4 w-4 text-rose-500" />
                    Output formats
                  </label>
                  <div className="flex flex-col gap-2 pt-1">
                    <label className="flex items-center justify-between rounded-lg border border-border px-3 py-2 cursor-pointer hover:bg-muted/50">
                      <span className="flex items-center gap-2 text-sm">
                        <Captions className="h-4 w-4 text-muted-foreground" />
                        SRT <span className="text-muted-foreground">(timestamps)</span>
                      </span>
                      <Switch checked={fmtSrt} onCheckedChange={setFmtSrt} disabled={isRunning} />
                    </label>
                    <label className="flex items-center justify-between rounded-lg border border-border px-3 py-2 cursor-pointer hover:bg-muted/50">
                      <span className="flex items-center gap-2 text-sm">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        VTT <span className="text-muted-foreground">(WebVTT)</span>
                      </span>
                      <Switch checked={fmtVtt} onCheckedChange={setFmtVtt} disabled={isRunning} />
                    </label>
                    <label className="flex items-center justify-between rounded-lg border border-border px-3 py-2 cursor-pointer hover:bg-muted/50">
                      <span className="flex items-center gap-2 text-sm">
                        <Type className="h-4 w-4 text-muted-foreground" />
                        TXT <span className="text-muted-foreground">(plain text)</span>
                      </span>
                      <Switch checked={fmtTxt} onCheckedChange={setFmtTxt} disabled={isRunning} />
                    </label>
                  </div>
                </div>
              </div>

              {/* Filename pattern selector */}
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <FileText className="h-4 w-4 text-rose-500" />
                  Filename pattern
                  <span className="text-muted-foreground font-normal text-xs ml-1">(how output files are named)</span>
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(
                    [
                      { value: 'verbose', label: 'Verbose', example: '001 Title [id].srt' },
                      { value: 'title', label: 'Title only', example: 'Title.srt' },
                      { value: 'position', label: 'Position', example: '001.srt' },
                      { value: 'videoId', label: 'Video ID', example: 'videoId.srt' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={isRunning}
                      onClick={() => setFilenamePattern(opt.value)}
                      className={`text-left rounded-lg border px-3 py-2 transition-colors disabled:opacity-50 ${
                        filenamePattern === opt.value
                          ? 'border-rose-400 bg-rose-50 dark:border-rose-700 dark:bg-rose-950/30'
                          : 'border-border bg-background hover:border-rose-300 hover:bg-muted/40'
                      }`}
                    >
                      <div className="text-xs font-medium">{opt.label}</div>
                      <div className="text-[10px] text-muted-foreground font-mono truncate mt-0.5">{opt.example}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Advanced: cookies + help */}
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  disabled={isRunning}
                  className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  <ChevronRight className={`h-3 w-3 transition-transform ${showAdvanced ? 'rotate-90' : ''}`} />
                  Advanced options
                  {cookies.trim() && <Badge variant="secondary" className="text-[10px] ml-1">cookies set</Badge>}
                </button>
                <AnimatePresence>
                  {showAdvanced && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
                        <label className="text-sm font-medium flex items-center gap-1.5">
                          <KeyRound className="h-4 w-4 text-amber-500" />
                          YouTube cookies <span className="text-muted-foreground font-normal text-xs">(optional — bypasses bot-check &amp; age restrictions)</span>
                        </label>
                        <textarea
                          value={cookies}
                          onChange={(e) => setCookies(e.target.value)}
                          disabled={isRunning}
                          placeholder="Paste your YouTube cookie string here, e.g.&#10;VISITOR_INFO1_LIVE=xxx; YSC=yyy; ...&#10;&#10;Or a Netscape cookies.txt export."
                          className="w-full h-20 text-xs font-mono p-2 rounded-md border border-border bg-background resize-y disabled:opacity-50"
                        />
                        <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
                          <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-sky-500" />
                          <p>
                            Export cookies from a logged-in YouTube tab using a browser extension like{' '}
                            <strong>“Get cookies.txt LOCALLY”</strong>, or copy the <code className="px-1 rounded bg-muted">Cookie</code> request header
                            from DevTools. Cookies are sent only to youtube.com and never stored after the job finishes.
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Error */}
        <AnimatePresence>
          {job.error && job.status === 'error' && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mt-4">
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertTitle>Extraction failed</AlertTitle>
                <AlertDescription className="font-mono text-xs">{job.error}</AlertDescription>
              </Alert>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Dashboard */}
        <AnimatePresence>
          {hasJob && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="mt-6 space-y-6"
            >
              <Dashboard job={job} isRunning={isRunning} />

              <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                <div className="lg:col-span-3">
                  <ResultsTable job={job} />
                </div>
                <div className="lg:col-span-2">
                  <ActivityLog job={job} />
                </div>
              </div>

              {job.status === 'done' && <DownloadSection job={job} />}
            </motion.div>
          )}
        </AnimatePresence>

        {/* How it works (only when idle) */}
        {!hasJob && <HowItWorks />}
      </main>

      <Footer />

      <HelpDialog open={showHelp} onOpenChange={setShowHelp} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Help dialog — explains the bot-block and solutions
// ---------------------------------------------------------------------------
function HelpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const solutions = [
    {
      icon: Monitor,
      title: 'Run on your own machine',
      desc: 'This is a cloud server — YouTube bot-blocks datacenter IPs. Running the tool from your laptop (a residential IP) works perfectly. The code is at mini-services/transcript-service/.',
      badge: 'Best',
    },
    {
      icon: KeyRound,
      title: 'Paste your YouTube cookies',
      desc: 'Expand "Advanced options" and paste cookies from a logged-in YouTube browser tab (use the "Get cookies.txt LOCALLY" extension). This carries your session and often bypasses the bot-check.',
      badge: 'Easy',
    },
    {
      icon: Globe,
      title: 'Use residential proxies',
      desc: 'If you must run on a cloud server, route requests through residential proxies (e.g. Webshare). Datacenter proxies won\'t help — YouTube blocks those too.',
      badge: 'Advanced',
    },
  ]
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5 text-rose-500" />
            Why am I seeing “Blocked” errors?
          </DialogTitle>
          <DialogDescription>
            YouTube returns “Sign in to confirm you're not a bot” when it detects automated requests from a server IP.
            This is not a bug — it's YouTube's bot-detection. Here's how to get your captions:
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          {solutions.map((s, i) => {
            const Icon = s.icon
            return (
              <div key={i} className="flex items-start gap-3 rounded-lg border border-border/70 p-3">
                <div className="h-8 w-8 rounded-md bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 flex items-center justify-center flex-shrink-0">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold">{s.title}</h4>
                    <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-200 dark:text-emerald-400 dark:border-emerald-900">{s.badge}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{s.desc}</p>
                </div>
              </div>
            )
          })}
        </div>
        <div className="mt-3 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
          <strong className="text-foreground">Good news:</strong> playlist extraction always works (it uses a different
          YouTube endpoint). Only caption fetching is affected. Your manifest CSV records every blocked video so you can
          re-run them elsewhere.
        </div>
        <a href="/api/cli-script" download className="block mt-3">
          <Button className="w-full bg-rose-600 hover:bg-rose-700 text-white">
            <Download className="h-4 w-4 mr-2" />
            Download standalone CLI script (Python, no deps)
          </Button>
        </a>
        <p className="text-[11px] text-muted-foreground text-center mt-2">
          Run it on your own machine: <code className="px-1 py-0.5 rounded bg-muted font-mono">python captionharvest.py "PLAYLIST_URL"</code>
        </p>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------
function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const isDark = theme === 'dark'
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            className="h-8 w-8 rounded-lg border border-border/60 flex items-center justify-center hover:bg-muted/60 transition-colors"
            aria-label="Toggle theme"
          >
            <Sun className="hidden dark:block h-4 w-4 text-amber-500" />
            <Moon className="block dark:hidden h-4 w-4 text-slate-600" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{isDark ? 'Switch to light mode' : 'Switch to dark mode'}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function Header({
  connected,
  jobHistory,
  currentJobId,
  onOpenHistory,
  onRestoreJob,
  onDeleteJob,
}: {
  connected: boolean
  jobHistory: import('@/hooks/use-transcript-job').JobSummary[]
  currentJobId: string | null
  onOpenHistory: () => void
  onRestoreJob: (jobId: string) => void
  onDeleteJob: (jobId: string) => void
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-rose-600 flex items-center justify-center shadow-sm">
            <Youtube className="h-4 w-4 text-white" />
          </div>
          <span className="font-semibold tracking-tight">CaptionHarvest</span>
          <Badge variant="outline" className="ml-2 hidden sm:inline-flex text-[10px] font-normal text-muted-foreground">
            beta
          </Badge>
        </div>
        <div className="flex items-center gap-2.5">
          <JobHistoryMenu
            jobHistory={jobHistory}
            currentJobId={currentJobId}
            onOpenHistory={onOpenHistory}
            onRestoreJob={onRestoreJob}
            onDeleteJob={onDeleteJob}
          />
          <ThemeToggle />
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
                    connected
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
                      : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300'
                  }`}
                >
                  {connected ? <Wifi className="h-3 w-3" /> : <Loader2 className="h-3 w-3 animate-spin" />}
                  <span className="hidden sm:inline">{connected ? 'Service online' : 'Connecting'}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {connected ? 'WebSocket connected to extraction service' : 'Establishing connection…'}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </header>
  )
}

// ---------------------------------------------------------------------------
// Job history menu — switch between past jobs
// ---------------------------------------------------------------------------
function JobHistoryMenu({
  jobHistory,
  currentJobId,
  onOpenHistory,
  onRestoreJob,
  onDeleteJob,
}: {
  jobHistory: import('@/hooks/use-transcript-job').JobSummary[]
  currentJobId: string | null
  onOpenHistory: () => void
  onRestoreJob: (jobId: string) => void
  onDeleteJob: (jobId: string) => void
}) {
  const count = jobHistory.length
  return (
    <DropdownMenu>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                onClick={onOpenHistory}
                className="h-8 px-2.5 rounded-lg border border-border/60 flex items-center gap-1.5 hover:bg-muted/60 transition-colors text-xs font-medium"
                aria-label="Job history"
              >
                <History className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">History</span>
                {count > 0 && (
                  <Badge variant="secondary" className="text-[10px] h-4 px-1 min-w-4 flex items-center justify-center">
                    {count}
                  </Badge>
                )}
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Past extraction jobs</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenuContent align="end" className="w-80 max-h-96 overflow-y-auto custom-scroll">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Job history ({count})
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {count === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-muted-foreground">
            <History className="h-6 w-6 mx-auto mb-2 opacity-30" />
            No past jobs yet. Run an extraction to see it here.
          </div>
        ) : (
          jobHistory.map((j) => {
            const isCurrent = j.id === currentJobId
            const date = new Date(j.startedAt)
            const timeAgo = formatTimeAgo(j.startedAt)
            const statusColor =
              j.status === 'done' ? 'text-emerald-600 dark:text-emerald-400' :
              j.status === 'error' || j.status === 'cancelled' ? 'text-rose-600 dark:text-rose-400' :
              'text-amber-600 dark:text-amber-400'
            return (
              <div
                key={j.id}
                className={`group flex items-start gap-2 px-2 py-2 rounded-md mx-1 cursor-pointer hover:bg-muted/60 ${isCurrent ? 'bg-rose-50/60 dark:bg-rose-950/20' : ''}`}
                onClick={() => onRestoreJob(j.id)}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium truncate flex-1">
                      {j.playlistTitle || j.url.slice(0, 40) + '…'}
                    </span>
                    {isCurrent && <Badge variant="secondary" className="text-[9px] h-4 px-1">current</Badge>}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                    <span className={`font-medium ${statusColor}`}>{j.status}</span>
                    <span>·</span>
                    <span>{j.stats.ok}/{j.stats.total} captured</span>
                    <span>·</span>
                    <span>{timeAgo}</span>
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onDeleteJob(j.id) }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-rose-500 flex-shrink-0 p-1"
                  title="Delete job"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            )
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
function Dashboard({
  job,
  isRunning,
}: {
  job: ReturnType<typeof useTranscriptJob>
  isRunning: boolean
}) {
  const { stats, status, startedAt, finishedAt, playlistTitle } = job
  const now = useNow(isRunning ? 1000 : 0)
  const elapsed = (finishedAt ?? now) - (startedAt ?? now)
  const percent = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0
  const rate = stats.done > 0 && elapsed > 0 ? stats.done / (elapsed / 1000) : 0
  const remaining = stats.total - stats.done
  const etaMs = rate > 0 ? (remaining / rate) * 1000 : 0
  const successRate = stats.done > 0 ? Math.round((stats.ok / stats.done) * 100) : 0

  const statusLabel: Record<JobStatus, string> = {
    idle: 'Idle',
    queued: 'Queued',
    extracting: 'Reading playlist',
    fetching: 'Fetching captions',
    packaging: 'Packaging ZIP',
    done: 'Complete',
    error: 'Failed',
    cancelled: 'Cancelled',
  }

  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              {isRunning ? (
                <Loader2 className="h-4 w-4 animate-spin text-rose-500" />
              ) : status === 'done' ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              ) : status === 'error' ? (
                <XCircle className="h-4 w-4 text-rose-500" />
              ) : (
                <Ban className="h-4 w-4 text-slate-400" />
              )}
              {statusLabel[status]}
            </CardTitle>
            <CardDescription className="truncate mt-0.5">
              {playlistTitle
                ? playlistTitle
                : status === 'extracting'
                ? 'Parsing playlist entries…'
                : '—'}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono gap-1">
              <Clock className="h-3 w-3" />
              {formatDuration(Math.max(0, elapsed))}
            </Badge>
            {isRunning && etaMs > 0 && (
              <Badge variant="outline" className="font-mono gap-1 text-muted-foreground">
                <Hourglass className="h-3 w-3" />
                ETA {formatDuration(etaMs)}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Progress bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground font-medium">
              {stats.done} / {stats.total || '…'} videos
            </span>
            <span className="font-mono font-semibold">{percent}%</span>
          </div>
          <Progress
            value={percent}
            className="h-2.5 bg-muted [&>div]:bg-gradient-to-r [&>div]:from-rose-500 [&>div]:to-rose-600"
          />
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{rate > 0 ? `${rate.toFixed(1)} videos/sec` : '—'}</span>
            <span>success rate {successRate}%</span>
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          <StatCard icon={Film} label="Total" value={stats.total} tint="slate" />
          <StatCard icon={CheckCircle2} label="Captured" value={stats.ok} tint="emerald" pulse={isRunning} />
          <StatCard icon={CircleSlash} label="No captions" value={stats.noCaptions} tint="amber" />
          <StatCard icon={ShieldAlert} label="Blocked" value={stats.blocked} tint="fuchsia" />
          <StatCard icon={XCircle} label="Failed" value={stats.failed} tint="rose" />
          <StatCard icon={Ban} label="Skipped" value={stats.skipped} tint="slate" />
        </div>

        {/* Environment-limitation banner (shown when YouTube bot-blocks requests) */}
        {stats.blocked > 0 && stats.ok === 0 && (
          <EnvironmentBanner blocked={stats.blocked} total={stats.total} />
        )}
      </CardContent>
    </Card>
  )
}

function StatCard({
  icon: Icon,
  label,
  value,
  tint,
  pulse,
}: {
  icon: typeof Film
  label: string
  value: number
  tint: 'slate' | 'emerald' | 'amber' | 'rose' | 'fuchsia'
  pulse?: boolean
}) {
  const tints: Record<string, { bg: string; text: string; ring: string }> = {
    slate: {
      bg: 'bg-slate-100 dark:bg-slate-800/60',
      text: 'text-slate-600 dark:text-slate-300',
      ring: 'ring-slate-200 dark:ring-slate-700',
    },
    emerald: {
      bg: 'bg-emerald-100 dark:bg-emerald-950/40',
      text: 'text-emerald-700 dark:text-emerald-300',
      ring: 'ring-emerald-200 dark:ring-emerald-900',
    },
    amber: {
      bg: 'bg-amber-100 dark:bg-amber-950/40',
      text: 'text-amber-700 dark:text-amber-300',
      ring: 'ring-amber-200 dark:ring-amber-900',
    },
    rose: {
      bg: 'bg-rose-100 dark:bg-rose-950/40',
      text: 'text-rose-700 dark:text-rose-300',
      ring: 'ring-rose-200 dark:ring-rose-900',
    },
    fuchsia: {
      bg: 'bg-fuchsia-100 dark:bg-fuchsia-950/40',
      text: 'text-fuchsia-700 dark:text-fuchsia-300',
      ring: 'ring-fuchsia-200 dark:ring-fuchsia-900',
    },
  }
  const t = tints[tint]
  return (
    <div className="relative rounded-xl border border-border/70 bg-card p-3 overflow-hidden">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{label}</span>
        <div className={`h-6 w-6 rounded-md flex items-center justify-center ${t.bg} ${t.text} ring-1 ${t.ring}`}>
          <Icon className={`h-3.5 w-3.5 ${pulse && tint === 'emerald' ? 'animate-pulse' : ''}`} />
        </div>
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  )
}

function EnvironmentBanner({ blocked, total }: { blocked: number; total: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-fuchsia-200 bg-fuchsia-50/70 dark:border-fuchsia-900 dark:bg-fuchsia-950/20 p-4"
    >
      <div className="flex items-start gap-3">
        <div className="h-8 w-8 rounded-md bg-fuchsia-100 dark:bg-fuchsia-950/50 text-fuchsia-700 dark:text-fuchsia-300 flex items-center justify-center flex-shrink-0">
          <ShieldAlert className="h-4 w-4" />
        </div>
        <div className="text-xs leading-relaxed">
          <p className="font-semibold text-fuchsia-900 dark:text-fuchsia-100 mb-1">
            YouTube is bot-blocking caption requests from this server's IP
          </p>
          <p className="text-fuchsia-800/90 dark:text-fuchsia-200/80">
            {blocked} of {total} videos returned <em>“Sign in to confirm you're not a bot.”</em> This is expected on
            cloud/datacenter IPs — the playlist was read fine, but YouTube refuses to serve caption data here.
            <strong className="text-fuchsia-900 dark:text-fuchsia-100"> The tool works fully from a residential connection</strong>{' '}
            (your laptop), or with residential proxies configured in the service. The manifest CSV records every
            blocked video so you can re-run them elsewhere.
          </p>
        </div>
      </div>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Results table
// ---------------------------------------------------------------------------
function ResultsTable({ job }: { job: ReturnType<typeof useTranscriptJob> }) {
  const [filter, setFilter] = useState<'all' | VideoStatus>('all')
  const [search, setSearch] = useState('')
  const [searchMode, setSearchMode] = useState<'title' | 'content'>('title')
  const [contentMatches, setContentMatches] = useState<Set<string> | null>(null)
  const [contentSearching, setContentSearching] = useState(false)
  const [selectedVideo, setSelectedVideo] = useState<VideoResult | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Debounced content search — when searchMode is 'content' and search has 2+ chars,
  // query the /api/search endpoint and build a Set of matching videoIds.
  useEffect(() => {
    if (searchMode !== 'content' || !job.jobId) {
      setContentMatches(null)
      return
    }
    const q = search.trim()
    if (q.length < 2) {
      setContentMatches(null)
      return
    }
    setContentSearching(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search/${job.jobId}?q=${encodeURIComponent(q)}&limit=200`)
        if (!res.ok) {
          setContentMatches(new Set())
        } else {
          const data = await res.json()
          setContentMatches(new Set((data.results || []).map((r: any) => r.videoId)))
        }
      } catch {
        setContentMatches(new Set())
      } finally {
        setContentSearching(false)
      }
    }, 400)
    return () => clearTimeout(t)
  }, [search, searchMode, job.jobId])

  const rows = useMemo(() => {
    let list = job.results
    if (filter !== 'all') list = list.filter((r) => r.status === filter)
    const q = search.trim().toLowerCase()
    if (q) {
      if (searchMode === 'content' && contentMatches) {
        list = list.filter((r) => contentMatches.has(r.video.id))
      } else {
        list = list.filter(
          (r) =>
            r.video.title.toLowerCase().includes(q) ||
            r.video.id.toLowerCase().includes(q)
        )
      }
    }
    return list
  }, [job.results, filter, search, searchMode, contentMatches])

  const counts = useMemo(() => {
    const c: Record<string, number> = {
      all: job.results.length,
      ok: 0,
      failed: 0,
      'no-captions': 0,
      skipped: 0,
      blocked: 0,
    }
    for (const r of job.results) c[r.status] = (c[r.status] ?? 0) + 1
    return c
  }, [job.results])

  // Auto-scroll to bottom when new rows arrive (only if user is near bottom)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [rows.length])

  return (
    <>
      <Card className="border-border/70 shadow-sm h-full flex flex-col">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ListChecks className="h-4 w-4 text-rose-500" />
              Per-video results
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono">{job.results.length}</Badge>
            </div>
          </div>
          {/* Search + filter row */}
          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchMode === 'title' ? 'Search by title or video ID…' : 'Search inside transcripts…'}
                className="h-8 pl-8 pr-7 text-xs"
              />
              {contentSearching && (
                <Loader2 className="absolute right-7 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
              )}
              {search && !contentSearching && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <XCircle className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {/* Search mode toggle */}
            <div className="inline-flex rounded-lg border border-border p-0.5 bg-muted/30 flex-shrink-0">
              <button
                onClick={() => setSearchMode('title')}
                className={`text-[11px] px-2.5 py-1 rounded-md flex items-center gap-1 transition-colors ${searchMode === 'title' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground'}`}
                title="Search video titles"
              >
                <Type className="h-3 w-3" /> Title
              </button>
              <button
                onClick={() => setSearchMode('content')}
                className={`text-[11px] px-2.5 py-1 rounded-md flex items-center gap-1 transition-colors ${searchMode === 'content' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground'}`}
                title="Search inside transcript text"
              >
                <FileSearch className="h-3 w-3" /> In transcripts
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ['all', 'All'],
                ['ok', 'Captured'],
                ['no-captions', 'No captions'],
                ['blocked', 'Blocked'],
                ['failed', 'Failed'],
                ['skipped', 'Skipped'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  filter === k
                    ? 'bg-rose-600 text-white border-rose-600'
                    : 'bg-background border-border text-muted-foreground hover:border-rose-400 hover:text-rose-600'
                }`}
              >
                {label} <span className="opacity-60">{counts[k] ?? 0}</span>
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="flex-1 min-h-0 p-0">
          <div ref={scrollRef} className="h-[440px] overflow-y-auto custom-scroll">
            {rows.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-2 px-6 text-center">
                <Hash className="h-8 w-8 opacity-40" />
                <p className="text-sm">
                  {job.results.length === 0
                    ? job.status === 'extracting'
                      ? 'Reading playlist — results will stream in shortly.'
                      : 'No results yet.'
                    : 'No results match your search.'}
                </p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur border-b border-border">
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pl-4 pr-2 font-medium w-10">#</th>
                    <th className="py-2 px-2 font-medium">Video</th>
                    <th className="py-2 px-2 font-medium text-right w-16">Snippets</th>
                    <th className="py-2 px-2 font-medium text-right w-20">Size</th>
                    <th className="py-2 px-2 font-medium text-right w-16">Time</th>
                    <th className="py-2 px-2 font-medium w-24">Source</th>
                    <th className="py-2 pl-2 pr-4 font-medium w-28">Status</th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence initial={false}>
                    {rows.map((r) => (
                      <ResultRow
                        key={`${r.video.id}-${r.video.position}`}
                        r={r}
                        onPreview={r.status === 'ok' ? () => setSelectedVideo(r) : undefined}
                      />
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
            )}
          </div>
          {rows.length > 0 && (
            <div className="px-4 py-2 border-t border-border/50 text-[11px] text-muted-foreground flex items-center justify-between">
              <span>
                Showing {rows.length} of {job.results.length}
                {search && <span> · filtered by "{search}"</span>}
              </span>
              {job.results.some((r) => r.status === 'ok') && (
                <span className="flex items-center gap-1 text-sky-600 dark:text-sky-400">
                  <Eye className="h-3 w-3" />
                  Click a captured row to preview
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      <TranscriptPreviewSheet
        video={selectedVideo}
        jobId={job.jobId}
        onClose={() => setSelectedVideo(null)}
      />
    </>
  )
}

function ResultRow({ r, onPreview }: { r: VideoResult; onPreview?: () => void }) {
  const meta = STATUS_META[r.status]
  const Icon = meta.icon
  return (
    <motion.tr
      initial={{ opacity: 0, backgroundColor: 'rgba(244,63,94,0.06)' }}
      animate={{ opacity: 1, backgroundColor: 'rgba(0,0,0,0)' }}
      transition={{ duration: 0.6 }}
      onClick={onPreview}
      className={`border-b border-border/50 group ${onPreview ? 'cursor-pointer hover:bg-rose-50/50 dark:hover:bg-rose-950/10' : 'hover:bg-muted/40'}`}
    >
      <td className="py-2 pl-4 pr-2 text-muted-foreground font-mono text-xs tabular-nums">
        {String(r.video.position + 1).padStart(3, '0')}
      </td>
      <td className="py-2 px-2 min-w-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <img
            src={`https://i.ytimg.com/vi/${r.video.id}/default.jpg`}
            alt=""
            loading="lazy"
            className="h-9 w-16 rounded object-cover bg-muted flex-shrink-0"
            onError={(e) => {
              ;(e.currentTarget as HTMLImageElement).style.visibility = 'hidden'
            }}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <a
                href={`https://www.youtube.com/watch?v=${r.video.id}`}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="block truncate text-sm font-medium hover:text-rose-600 hover:underline max-w-[200px] sm:max-w-[300px]"
                title={r.video.title}
              >
                {r.video.title}
              </a>
              {onPreview && (
                <Eye className="h-3 w-3 text-sky-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
              )}
            </div>
            <span className="block text-[11px] text-muted-foreground font-mono truncate">{r.video.id}</span>
          </div>
        </div>
      </td>
      <td className="py-2 px-2 text-right tabular-nums text-xs text-muted-foreground">{r.snippetCount ?? '—'}</td>
      <td className="py-2 px-2 text-right tabular-nums text-xs text-muted-foreground">{formatBytes(r.fileSize)}</td>
      <td className="py-2 px-2 text-right tabular-nums text-xs text-muted-foreground">
        {r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : '—'}
      </td>
      <td className="py-2 px-2">{r.status === 'ok' ? <SourceBadge source={r.captionSource} lang={r.language} /> : <span className="text-xs text-muted-foreground">—</span>}</td>
      <td className="py-2 pl-2 pr-4">
        <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${meta.cls}`}>
          <Icon className={`h-3 w-3 ${r.status === 'processing' ? 'animate-spin' : ''}`} />
          {meta.label}
        </span>
      </td>
    </motion.tr>
  )
}

// Caption-source badge: shows where the transcript came from (Manual / Auto-generated / Auto-translated)
const SOURCE_META: Record<string, { label: string; cls: string }> = {
  manual: { label: 'Manual', cls: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900' },
  auto: { label: 'Auto-gen', cls: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900' },
  translated: { label: 'Translated', cls: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-900' },
  unknown: { label: 'Caption', cls: 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:border-slate-700' },
}
function SourceBadge({ source, lang }: { source?: string; lang?: string }) {
  const s = source && SOURCE_META[source] ? SOURCE_META[source] : SOURCE_META.unknown
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border ${s.cls}`}>
      {s.label}
      {lang && <span className="opacity-60 font-mono uppercase">{lang}</span>}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Transcript preview sheet — click a captured row to see the transcript inline
// ---------------------------------------------------------------------------
function TranscriptPreviewSheet({
  video,
  jobId,
  onClose,
}: {
  video: VideoResult | null
  jobId: string | null
  onClose: () => void
}) {
  const [content, setContent] = useState<string | null>(null)
  const [format, setFormat] = useState<'srt' | 'txt' | 'vtt'>('txt')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const open = !!video && !!jobId

  const fetchContent = useCallback(async () => {
    if (!video || !jobId) return
    setLoading(true)
    setError(null)
    setContent(null)
    try {
      const res = await fetch(`/api/transcript/${jobId}/${video.video.id}?format=${format}`)
      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: 'Failed to load' }))
        throw new Error(j.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setContent(data.content)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setLoading(false)
    }
  }, [video, jobId, format])

  useEffect(() => {
    if (open) fetchContent()
    else {
      setContent(null)
      setError(null)
      setCopied(false)
    }
  }, [open, fetchContent])

  const handleCopy = async () => {
    if (!content) return
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  // Estimate word count
  const wordCount = useMemo(() => {
    if (!content) return 0
    return content.split(/\s+/).filter(Boolean).length
  }, [content])

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl p-0 flex flex-col" side="right">
        {video && (
          <>
            <SheetHeader className="px-5 pt-5 pb-3 border-b border-border/60 flex-shrink-0">
              <div className="flex items-start justify-between gap-3 pr-6">
                <div className="min-w-0 flex-1">
                  <SheetTitle className="text-base leading-snug truncate">{video.video.title}</SheetTitle>
                  <SheetDescription className="flex items-center gap-2 mt-1 flex-wrap">
                    <a
                      href={`https://www.youtube.com/watch?v=${video.video.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-xs hover:text-rose-600 hover:underline"
                    >
                      {video.video.id}
                    </a>
                    <SourceBadge source={video.captionSource} lang={video.language} />
                    {video.snippetCount && (
                      <Badge variant="outline" className="text-[10px] font-mono">{video.snippetCount} snippets</Badge>
                    )}
                    {content && (
                      <Badge variant="outline" className="text-[10px] font-mono">{wordCount.toLocaleString()} words</Badge>
                    )}
                  </SheetDescription>
                </div>
              </div>
              {/* Format toggle + copy */}
              <div className="flex items-center gap-2 mt-3">
                <div className="inline-flex rounded-lg border border-border p-0.5 bg-muted/30">
                  <button
                    onClick={() => setFormat('txt')}
                    className={`text-xs px-3 py-1 rounded-md flex items-center gap-1.5 transition-colors ${format === 'txt' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground'}`}
                  >
                    <Type className="h-3 w-3" /> TXT
                  </button>
                  <button
                    onClick={() => setFormat('srt')}
                    className={`text-xs px-3 py-1 rounded-md flex items-center gap-1.5 transition-colors ${format === 'srt' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground'}`}
                  >
                    <Captions className="h-3 w-3" /> SRT
                  </button>
                  <button
                    onClick={() => setFormat('vtt')}
                    className={`text-xs px-3 py-1 rounded-md flex items-center gap-1.5 transition-colors ${format === 'vtt' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground'}`}
                  >
                    <FileText className="h-3 w-3" /> VTT
                  </button>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCopy}
                  disabled={!content}
                  className="h-7 text-xs"
                >
                  {copied ? <Check className="h-3 w-3 mr-1 text-emerald-500" /> : <Copy className="h-3 w-3 mr-1" />}
                  {copied ? 'Copied!' : 'Copy'}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" className="h-7 text-xs ml-auto">
                      <Download className="h-3 w-3 mr-1" /> Download as
                      <ChevronDown className="h-3 w-3 ml-1 opacity-60" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Subtitle format
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <a href={`/api/transcript/${jobId}/${video.video.id}?format=srt`} download className="flex items-center gap-2 cursor-pointer">
                        <Captions className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs">SRT</span>
                        <span className="ml-auto text-[10px] text-muted-foreground">.srt</span>
                      </a>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <a href={`/api/transcript/${jobId}/${video.video.id}?format=vtt`} download className="flex items-center gap-2 cursor-pointer">
                        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs">VTT</span>
                        <span className="ml-auto text-[10px] text-muted-foreground">.vtt</span>
                      </a>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <a href={`/api/transcript/${jobId}/${video.video.id}?format=txt`} download className="flex items-center gap-2 cursor-pointer">
                        <Type className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs">TXT</span>
                        <span className="ml-auto text-[10px] text-muted-foreground">.txt</span>
                      </a>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </SheetHeader>
            <div className="flex-1 overflow-hidden p-0">
              {loading ? (
                <div className="h-full flex items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-rose-500" />
                </div>
              ) : error ? (
                <div className="h-full flex flex-col items-center justify-center gap-2 px-6 text-center">
                  <XCircle className="h-8 w-8 text-rose-400" />
                  <p className="text-sm font-medium">Couldn't load transcript</p>
                  <p className="text-xs text-muted-foreground font-mono">{error}</p>
                  <Button size="sm" variant="outline" onClick={fetchContent} className="mt-2 h-7 text-xs">
                    <RotateCcw className="h-3 w-3 mr-1" /> Retry
                  </Button>
                </div>
              ) : content ? (
                <pre className="h-full overflow-y-auto custom-scroll p-4 text-xs leading-relaxed font-mono whitespace-pre-wrap break-words bg-slate-50 dark:bg-slate-950/40 border-t border-border/60">
                  {content}
                </pre>
              ) : null}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------
function ActivityLog({ job }: { job: ReturnType<typeof useTranscriptJob> }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [job.logs.length])

  const levelCls: Record<string, string> = {
    info: 'text-slate-500 dark:text-slate-400',
    warn: 'text-amber-600 dark:text-amber-400',
    error: 'text-rose-600 dark:text-rose-400',
  }

  return (
    <Card className="border-border/70 shadow-sm h-full flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Terminal className="h-4 w-4 text-rose-500" />
          Activity log
        </CardTitle>
        <CardDescription className="text-xs">Live server-side progress stream</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 p-0">
        <div
          ref={scrollRef}
          className="h-[440px] overflow-y-auto custom-scroll bg-slate-950 dark:bg-black/40 rounded-b-xl font-mono text-[11px] leading-relaxed p-3"
        >
          {job.logs.length === 0 ? (
            <div className="h-full flex items-center justify-center text-slate-600 text-xs">
              Waiting for output…
            </div>
          ) : (
            job.logs.map((l, i) => (
              <div key={i} className="flex gap-2 hover:bg-white/5 px-1 py-0.5 rounded">
                <span className="text-slate-600 select-none flex-shrink-0">
                  {new Date(l.ts).toLocaleTimeString([], { hour12: false })}
                </span>
                <span className={`flex-shrink-0 uppercase font-semibold ${levelCls[l.level] ?? levelCls.info}`}>
                  {l.level}
                </span>
                <span className="text-slate-300 break-all">{l.message}</span>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Download section
// ---------------------------------------------------------------------------
function DownloadSection({ job }: { job: ReturnType<typeof useTranscriptJob> }) {
  const { stats, zipUrl, manifestUrl, finishedAt, startedAt, jobId, results, retryFailed } = job
  const duration = (finishedAt ?? 0) - (startedAt ?? 0)
  const hasCaptures = stats.ok > 0
  const combinedTxtUrl = jobId ? `/api/combined/${jobId}?format=txt` : undefined
  const combinedJsonUrl = jobId ? `/api/combined/${jobId}?format=json` : undefined
  const allTextUrl = jobId ? `/api/all-text/${jobId}` : undefined
  const retryableCount = stats.blocked + stats.failed + stats.noCaptions
  const [retrying, setRetrying] = useState(false)
  const [copyingAll, setCopyingAll] = useState(false)
  const [copiedAll, setCopiedAll] = useState(false)
  const [allTextStats, setAllTextStats] = useState<{ wordCount: number; charCount: number } | null>(null)

  const handleRetry = () => {
    setRetrying(true)
    retryFailed()
    // Reset the retrying state when the job completes again
    setTimeout(() => setRetrying(false), 30000)
  }

  const handleCopyAll = async () => {
    if (!allTextUrl) return
    setCopyingAll(true)
    setCopiedAll(false)
    try {
      const res = await fetch(allTextUrl)
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()
      await navigator.clipboard.writeText(data.content)
      setAllTextStats({ wordCount: data.wordCount, charCount: data.charCount })
      setCopiedAll(true)
      setTimeout(() => setCopiedAll(false), 3000)
    } catch {
      // ignore
    } finally {
      setCopyingAll(false)
    }
  }

  // Estimate total word count from snippet counts (avg ~8 words per snippet)
  const estWordCount = useMemo(
    () => results.filter((r) => r.status === 'ok').reduce((sum, r) => sum + (r.snippetCount || 0) * 8, 0),
    [results]
  )

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="border-emerald-200 dark:border-emerald-900 bg-emerald-50/40 dark:bg-emerald-950/10 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            All done — your captions are ready
          </CardTitle>
          <CardDescription>
            Captured <strong>{stats.ok}</strong> of <strong>{stats.total}</strong> videos in {formatDuration(duration)}.
            {stats.noCaptions > 0 && ` ${stats.noCaptions} had no captions, ${stats.failed} failed.`}
            {hasCaptures && estWordCount > 0 && ` ~${estWordCount.toLocaleString()} words total.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Primary downloads */}
          <div className="flex flex-col sm:flex-row gap-3">
            {zipUrl && (
              <a href={zipUrl} className="flex-1">
                <Button className="w-full h-12 bg-rose-600 hover:bg-rose-700 text-white shadow-sm">
                  <ArrowDownToLine className="h-4 w-4 mr-2" />
                  Download captions.zip
                </Button>
              </a>
            )}
            {manifestUrl && (
              <a href={manifestUrl} className="flex-1">
                <Button variant="outline" className="w-full h-12">
                  <FileDown className="h-4 w-4 mr-2" />
                  Download manifest.csv
                </Button>
              </a>
            )}
          </div>

          {/* Combined single-file exports (for LLM/RAG input) */}
          {hasCaptures && (
            <div className="rounded-xl border border-border/70 bg-card/60 dark:bg-card/30 p-4">
              <div className="flex items-center gap-2 mb-2">
                <FileStack className="h-4 w-4 text-violet-500" />
                <h4 className="text-sm font-semibold">Single-file exports</h4>
                <Badge variant="secondary" className="text-[10px] ml-auto">{stats.ok} transcripts merged</Badge>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                All captured transcripts merged into one file — ideal for feeding into an LLM or RAG pipeline.
                Also included inside the ZIP.
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                {combinedTxtUrl && (
                  <a href={combinedTxtUrl} className="flex-1">
                    <Button variant="outline" size="sm" className="w-full h-9">
                      <Type className="h-3.5 w-3.5 mr-1.5" />
                      all_transcripts.txt
                    </Button>
                  </a>
                )}
                {combinedJsonUrl && (
                  <a href={combinedJsonUrl} className="flex-1">
                    <Button variant="outline" size="sm" className="w-full h-9">
                      <FileJson className="h-3.5 w-3.5 mr-1.5" />
                      all_transcripts.json
                    </Button>
                  </a>
                )}
              </div>
              {/* Copy all transcripts to clipboard */}
              <div className="mt-3 flex flex-col sm:flex-row gap-2 sm:items-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyAll}
                  disabled={copyingAll}
                  className="h-9"
                >
                  {copyingAll ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : copiedAll ? (
                    <Check className="h-3.5 w-3.5 mr-1.5 text-emerald-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  {copyingAll ? 'Copying…' : copiedAll ? 'Copied to clipboard!' : 'Copy all transcripts'}
                </Button>
                {/* Stats summary */}
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground ml-auto">
                  {allTextStats ? (
                    <>
                      <span className="flex items-center gap-1">
                        <Type className="h-3 w-3" />
                        {allTextStats.wordCount.toLocaleString()} words
                      </span>
                      <span className="flex items-center gap-1">
                        <Hash className="h-3 w-3" />
                        {(allTextStats.charCount / 1000).toFixed(1)}k chars
                      </span>
                    </>
                  ) : (
                    <span className="flex items-center gap-1">
                      <Type className="h-3 w-3" />
                      ~{estWordCount.toLocaleString()} words (est.)
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Re-run failed videos — shown when there are non-ok results */}
          {retryableCount > 0 && (
            <div className="rounded-xl border border-sky-200 bg-sky-50/60 dark:border-sky-900 dark:bg-sky-950/20 p-4">
              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-md bg-sky-100 dark:bg-sky-950/50 text-sky-700 dark:text-sky-400 flex items-center justify-center flex-shrink-0">
                  <RefreshCw className={`h-4 w-4 ${retrying ? 'animate-spin' : ''}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="text-sm font-semibold text-sky-900 dark:text-sky-100">
                    {retryableCount} video{retryableCount !== 1 ? 's' : ''} to re-try
                  </h4>
                  <p className="text-xs text-sky-800/90 dark:text-sky-200/80 mt-0.5 mb-3 leading-relaxed">
                    Re-run only the {stats.blocked > 0 && `${stats.blocked} blocked`}
                    {stats.blocked > 0 && (stats.failed > 0 || stats.noCaptions > 0) ? ', ' : ''}
                    {stats.failed > 0 && `${stats.failed} failed`}
                    {stats.failed > 0 && stats.noCaptions > 0 ? ', ' : ''}
                    {stats.noCaptions > 0 && `${stats.noCaptions} no-captions`}
                    {' '}videos without re-scanning the whole playlist. Useful after adding cookies or switching networks.
                  </p>
                  <Button
                    size="sm"
                    onClick={handleRetry}
                    disabled={retrying}
                    className="bg-sky-600 hover:bg-sky-700 text-white"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${retrying ? 'animate-spin' : ''}`} />
                    {retrying ? 'Re-running…' : `Re-run ${retryableCount} failed`}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* CLI script download — shown when there are blocked/failed videos */}
          {(stats.blocked > 0 || stats.failed > 0) && (
            <CliDownloadCard blocked={stats.blocked} failed={stats.failed} url={job.url} />
          )}

          <p className="text-xs text-muted-foreground">
            The ZIP contains SRT/TXT files named <code className="px-1 py-0.5 rounded bg-muted">NNN Title [videoId].srt</code>,
            plus the manifest and combined exports. The CSV lists every video with its status, caption source, and file size —
            handy for re-running just the failures.
          </p>
        </CardContent>
      </Card>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// CLI download card — with copy-command button
// ---------------------------------------------------------------------------
function CliDownloadCard({ blocked, failed, url }: { blocked: number; failed: number; url: string }) {
  const [copied, setCopied] = useState(false)
  const command = `python captionharvest.py "${url}"`

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20 p-4"
    >
      <div className="flex items-start gap-3">
        <div className="h-8 w-8 rounded-md bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400 flex items-center justify-center flex-shrink-0">
          <Monitor className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-100">
            {blocked > 0 ? `${blocked} videos were bot-blocked` : `${failed} videos failed`}
          </h4>
          <p className="text-xs text-amber-800/90 dark:text-amber-200/80 mt-0.5 mb-3 leading-relaxed">
            Download a standalone Python script to run on your own machine (residential IP) where YouTube doesn't
            bot-block. No dependencies — just Python 3.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <a href="/api/cli-script" download>
              <Button size="sm" className="bg-amber-600 hover:bg-amber-700 text-white">
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Download captionharvest.py
              </Button>
            </a>
          </div>
          {/* Copyable command */}
          <div className="mt-3 group/cmd relative">
            <div className="flex items-center gap-2 rounded-lg border border-amber-300/60 dark:border-amber-800/60 bg-amber-100/40 dark:bg-amber-950/30 px-3 py-2">
              <span className="text-amber-700 dark:text-amber-500 text-xs font-mono flex-shrink-0">$</span>
              <code className="text-[11px] font-mono text-amber-900 dark:text-amber-200 truncate flex-1">
                {command.length > 70 ? command.slice(0, 67) + '...' : command}
              </code>
              <button
                onClick={handleCopy}
                className="flex-shrink-0 inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md bg-amber-200/60 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 hover:bg-amber-300/60 dark:hover:bg-amber-800/60 transition-colors"
                title="Copy command"
              >
                {copied ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-600" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    Copy
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// How it works
// ---------------------------------------------------------------------------
function HowItWorks() {
  const steps = [
    { icon: Link2, title: '1 · Paste a playlist', desc: 'Any public or unlisted YouTube playlist URL. 10 videos or 1,000 — same flow.' },
    { icon: Languages, title: '2 · Choose languages', desc: 'Pick caption languages to try in order. English first, then fall back to others.' },
    { icon: Gauge, title: '3 · Set concurrency', desc: '2–4 parallel workers balances speed against YouTube\'s rate limiter.' },
    { icon: Download, title: '4 · Download the ZIP', desc: 'Get every transcript as SRT + TXT, plus a CSV manifest of results.' },
  ]
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.25 }}
      className="mt-12"
    >
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4 text-center">
        How it works
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {steps.map((s) => {
          const Icon = s.icon
          return (
            <Card key={s.title} className="border-border/60 shadow-none">
              <CardContent className="pt-5">
                <div className="h-9 w-9 rounded-lg bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 flex items-center justify-center mb-3">
                  <Icon className="h-4 w-4" />
                </div>
                <h3 className="font-medium text-sm">{s.title}</h3>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{s.desc}</p>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Card className="mt-4 border-dashed border-border/70 bg-muted/30">
        <CardContent className="pt-5 pb-5">
          <div className="flex items-start gap-3">
            <div className="h-8 w-8 rounded-md bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div className="text-xs text-muted-foreground leading-relaxed">
              <strong className="text-foreground">Responsible use.</strong> This tool fetches publicly-available
              captions at a polite rate. Some videos have captions disabled or are age-restricted — those will show
              as <Badge variant="outline" className="mx-1 text-[10px]">No captions</Badge> in the manifest. Don't hammer
              YouTube; keep concurrency low and avoid re-running huge playlists repeatedly.
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.section>
  )
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------
function Footer() {
  return (
    <footer className="mt-auto border-t border-border/60 bg-background/60">
      <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <div className="h-5 w-5 rounded bg-rose-600 flex items-center justify-center">
            <Youtube className="h-3 w-3 text-white" />
          </div>
          <span>CaptionHarvest · playlist → captions in minutes</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <Activity className="h-3 w-3" /> socket.io live progress
          </span>
          <span className="hidden sm:flex items-center gap-1">
            <FileText className="h-3 w-3" /> SRT + TXT + CSV manifest
          </span>
        </div>
      </div>
    </footer>
  )
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (intervalMs <= 0) return
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
