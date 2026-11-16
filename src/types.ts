export interface SiteConfig {
  id: string;
  name: string;
  url: string;
  feed: string;
  sitemap: string;
  brand_color: string;
  accent_color: string;
  hashtags: string[];
  handles: Record<string, string>;
  enabled: boolean;
  source?: "manual" | "gravatar";
  created_at?: number;
}

export interface Article {
  site: string;
  title: string;
  url: string;
  summary: string;
  image: string;
  published: number;
  guid: string;
  tags: string[];
  key: string;
}

export interface CopyDeck {
  hook: string;
  bsky: string;
  mastodon: string;
  telegram: string;
  discord: string;
  facebook_page: string;
  linkedin: string;
  x: string;
  threads: string;
  reddit_title: string;
  reddit_body: string;
  devto_title: string;
  devto_description: string;
  hashtags: string[];
}

export interface RunSettings {
  dry_run: boolean;
  max_per_site: number;
  lookback_days: number;
  timezone: string;
}

export interface AiSettings {
  enabled: boolean;
  model: string;
  brand_voice: string;
}

export interface ThumbnailSettings {
  width: number;
  height: number;
  style: "gradient" | "photo" | "solid";
  use_og_image: boolean;
}

export interface MediaHostSettings {
  provider: "app_url" | "github_raw" | "none";
  repo: string;
  branch: string;
  path_prefix: string;
}

export interface ScheduleSettings {
  enabled: boolean;
  frequency: "daily" | "every_12h" | "every_6h";
  post_time: string;
  timezone: string;
  mode: "live" | "dry";
  sync_gravatar: boolean;
  last_run_at: number | null;
  next_run_at: number | null;
  last_status: "idle" | "running" | "ok" | "error";
  last_error: string;
  last_run_id: string;
}

export interface PlatformInfo {
  name: string;
  label: string;
  copy_key: string;
  required_env: string[];
  supports_image: boolean;
  needs_public_url: boolean;
  char_limit: number;
  effort: string;
  safety: "safe" | "caution" | "manual";
  notes: string;
  enabled: boolean;
  config: Record<string, unknown>;
  ready: boolean;
  missing_env: string[];
}

export interface PlatformPostResult {
  platform: string;
  label: string;
  status: "ok" | "dry" | "error";
  text: string;
  url: string;
  detail: string;
}

export interface RunItemResult {
  site: string;
  siteId: string;
  title: string;
  url: string;
  key: string;
  image_filename: string;
  image_url: string;
  copy: CopyDeck;
  results: PlatformPostResult[];
}

export interface RunRecord {
  id: string;
  mode: "LIVE" | "DRY RUN" | "PREVIEW ALL";
  started: string;
  elapsed: number;
  writer: "gemini" | "template";
  counts: {
    ok: number;
    dry: number;
    error: number;
  };
  items: RunItemResult[];
  created_at: number;
}

export interface LedgerEntry {
  ts: number;
  key: string;
  platform: string;
  status: "ok" | "dry" | "error";
  post_url: string;
  detail: string;
  title?: string;
  article_url?: string;
  site?: string;
}

export interface GravatarAccount {
  label: string;
  url: string;
  service_type: string;
}

export interface GravatarProfile {
  hash: string;
  username: string;
  display_name: string;
  profile_url: string;
  avatar_url: string;
  job_title: string;
  company: string;
  location: string;
  pronouns: string;
  description: string;
  background_color: string;
  header_image: string;
  verified_accounts: GravatarAccount[];
  links: Array<{ label: string; url: string }>;
}

export type UserRole = "admin" | "member";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  created_at: number;
  last_login_at: number;
}

export interface AuthStatus {
  authenticated: boolean;
  user: AuthUser | null;
  hasUsers: boolean;
  allowSignups: boolean;
  activeSessionsCount: number;
}

export interface SecurityInfo {
  allowSignups: boolean;
  activeSessionsCount: number;
  totalUsers?: number;
}

export interface GravatarConnection {
  identifier: string;
  auto_sync: boolean;
  last_synced_at: number | null;
  synced_site_ids: string[];
  profile: GravatarProfile | null;
}

export interface BootstrapState {
  user: AuthUser;
  security: SecurityInfo;
  sites: SiteConfig[];
  platforms: PlatformInfo[];
  settings: {
    run: RunSettings;
    ai: AiSettings;
    thumbnail: ThumbnailSettings;
    media_host: MediaHostSettings;
  };
  schedule: ScheduleSettings;
  gravatar: GravatarConnection;
  geminiReady: boolean;
  secretStatus: Record<string, boolean>;
  runs: RunRecord[];
  ledger: LedgerEntry[];
}
