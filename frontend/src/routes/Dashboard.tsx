import { useState, useMemo } from "react";
import { useNavigate, Navigate } from "react-router";
import { Plus, Search, Folder, Globe, Activity, ChevronRight, X } from "lucide-react";
import { GithubIcon } from "../components/GithubIcon";
import { useAuth } from "../lib/AuthContext";
import { deploymentSource, displayStatus, useProjects, type DisplayStatus } from "../lib/api";
import { Reveal } from "../components/Reveal";
import { Sparkline } from "../components/Sparkline";
import { Nav } from "../components/Nav";
import type { DeploymentRead } from "../client/types.gen";

function timeAgo(iso: string) {
  const now = Date.now();
  const t = new Date(iso).getTime();
  const m = Math.floor((now - t) / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function statusCls(status: DisplayStatus) {
  return status === "Running" ? "ok" : status === "Building" ? "warn" : "err";
}

function buildProgress(d: DeploymentRead): number {
  if (d.status === "running") return 100;
  if (d.status === "building" || d.status === "analyzing" || d.status === "pending") {
    const elapsed = (Date.now() - new Date(d.created_at).getTime()) / 1000;
    return Math.min(95, (elapsed / 30) * 100);
  }
  return 0;
}

function StatusPill({ status, size }: { status: DisplayStatus; size?: "lg" }) {
  const cls = statusCls(status);
  return (
    <span className={`pill pill-${cls} ${size === "lg" ? "pill-lg" : ""}`}>
      {status === "Running" && <span className="pill-dot" aria-hidden />}
      {status === "Failed" && <span className="pill-x" aria-hidden>✕</span>}
      {status}
    </span>
  );
}

function MetricMini({
  label,
  value,
  delta,
  seed,
}: {
  label: string;
  value: string | number;
  delta: string;
  seed: number;
}) {
  return (
    <div className="metric-mini metric-ok">
      <div className="metric-head">
        <span className="metric-lbl">{label}</span>
        <Sparkline seed={seed} color="var(--ok-ink)" />
      </div>
      <div className="metric-val">{value}</div>
      <div className="metric-delta">{delta}</div>
    </div>
  );
}

function DeploymentCard({ d, onClick }: { d: DeploymentRead; onClick: () => void }) {
  const status = displayStatus(d.status);
  const source = deploymentSource(d);
  const cls = statusCls(status);
  const progress = buildProgress(d);

  return (
    <div onClick={onClick} className={`dcard`} style={{ cursor: 'pointer' }}>
      <div className={`dcard-rail rail-${cls}`} />
      <div className="dcard-main">
        <div className="dcard-top">
          <div className="dcard-titlewrap">
            <div className={`dcard-icon dicon-${cls}`}>
              {source.type === "github" ? <GithubIcon size={16} /> : <Folder size={16} />}
            </div>
            <div>
              <h3 className="dcard-title">{d.name ?? "Untitled deployment"}</h3>
              <div className="dcard-sub">
                <span className={`mono${source.type === "local" ? " italic" : ""}`}>
                  {source.label}
                </span>
                {d.exposed_ports?.[0] && (
                  <>
                    <span className="dot-sep">•</span>
                    <span className="mono tiny">:{d.exposed_ports[0]}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <StatusPill status={status} />
        </div>

        {status === "Running" && d.public_url && (
          <div className="dcard-live">
            <div className="live-url" style={{ cursor: 'pointer' }} onClick={onClick}>
              <Globe size={13} />
              <span className="mono">{d.public_url}</span>
              <ChevronRight size={12} className="live-ext" style={{ cursor: 'pointer' }} />
            </div>
            <div className="live-meta">
              <span><Activity size={12} /> live</span>
              <Sparkline seed={d.id.charCodeAt(0)} color="var(--ok-ink)" width={60} height={20} />
            </div>
          </div>
        )}

        {status === "Building" && (
          <div className="dcard-building">
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${progress}%` }}>
                <span className="progress-sheen" aria-hidden />
              </div>
            </div>
            <div className="building-meta">
              <span className="mono">▸ Building…</span>
              <span className="mono muted">{Math.round(progress)}%</span>
            </div>
          </div>
        )}

        {status === "Failed" && (
          <div className="dcard-failed">
            <span className="mono err-ink-text">
              ⨯ {(d as DeploymentRead & { error?: string }).error ?? "Deployment failed"}
            </span>
          </div>
        )}
      </div>

      <div className="dcard-time">
        <div className="time-ago">{timeAgo(d.created_at)}</div>
        <ChevronRight size={16} className="chev" />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { data, isLoading } = useProjects();
  const [filter, setFilter] = useState<"all" | "running" | "building" | "failed">("all");
  const [q, setQ] = useState("");

  if (authLoading) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
      <span className="big-spinner" />
    </div>
  );
  if (!user) return <Navigate to="/signin" replace />;

  const deployments = data?.items ?? [];

  const counts = useMemo(
    () => ({
      running: deployments.filter((d) => displayStatus(d.status) === "Running").length,
      building: deployments.filter((d) => displayStatus(d.status) === "Building").length,
      failed: deployments.filter((d) => displayStatus(d.status) === "Failed").length,
    }),
    [deployments],
  );

  const filtered = useMemo(() => {
    return deployments.filter((d) => {
      const status = displayStatus(d.status).toLowerCase();
      if (filter !== "all" && status !== filter) return false;
      if (q && !(d.name ?? "").toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [deployments, filter, q]);

  const displayName = user.name ?? user.login ?? "there";

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh" }}>
      <Nav />
      <div className="dash-wrap">
        {/* Hero strip */}
        <Reveal className="dash-hero">
          <div>
            <div className="greet">
              <span className="greet-wave" aria-hidden>👋</span>
              Welcome back,&nbsp;<strong>{displayName}</strong>
            </div>
            <h2 className="dash-h2">Your Deployments</h2>
            <p className="dash-sub">
              <span className="ok-chip">
                <span className="status-dot dot-ok" aria-hidden /> {counts.running} live
              </span>
              <span className="warn-chip">
                <span className="status-dot dot-warn" aria-hidden /> {counts.building} building
              </span>
              {counts.failed > 0 && (
                <span className="err-chip">
                  <span className="status-dot dot-err" aria-hidden /> {counts.failed} failed
                </span>
              )}
            </p>
          </div>

          <div className="dash-hero-right">
            <MetricMini
              label="Deployments"
              value={deployments.length}
              delta={`${counts.running} active`}
              seed={3}
            />
            <MetricMini
              label="Avg build time"
              value="~38s"
              delta="across active"
              seed={7}
            />
            <button className="deploy-card-cta" onClick={() => navigate("/add")}>
              <span className="deploy-card-plus" aria-hidden>
                <Plus size={14} />
              </span>
              <span className="deploy-card-label-wrap">
                <span className="deploy-card-main">New Deployment</span>
                <span className="deploy-card-sub">ship in ~&lt;60s</span>
              </span>
              <span className="btn-shine" aria-hidden />
            </button>
          </div>
        </Reveal>

        {/* Controls */}
        <Reveal delay={80} className="dash-controls">
          <div className="search-box">
            <Search size={15} style={{ color: "var(--ink-faint)", flexShrink: 0 }} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search deployments…"
              aria-label="Search deployments"
            />
            {q && (
              <button
                style={{ border: "none", background: "none", color: "var(--ink-faint)", cursor: "pointer", padding: 0 }}
                onClick={() => setQ("")}
                aria-label="Clear search"
              >
                <X size={13} />
              </button>
            )}
          </div>
          <div className="filter-tabs" role="tablist">
            {(["all", "running", "building", "failed"] as const).map((f) => (
              <button
                key={f}
                role="tab"
                aria-selected={filter === f}
                onClick={() => setFilter(f)}
                className={`filter-tab ${filter === f ? "active" : ""}`}
              >
                {f === "all" ? "All" : f[0].toUpperCase() + f.slice(1)}
                <span className="filter-count">
                  {f === "all"
                    ? deployments.length
                    : f === "running"
                    ? counts.running
                    : f === "building"
                    ? counts.building
                    : counts.failed}
                </span>
              </button>
            ))}
          </div>
        </Reveal>

        {/* Cards */}
        <div className="dash-list">
          {isLoading ? (
            <Reveal className="dash-empty">
              <span className="mini-spinner" aria-hidden />
              <p>Loading deployments…</p>
            </Reveal>
          ) : filtered.length === 0 ? (
            <Reveal className="dash-empty">
              <Search size={28} style={{ color: "var(--ink-faint)" }} />
              {q ? (
                <p>No deployments match &ldquo;{q}&rdquo;</p>
              ) : (
                <>
                  <p>No deployments yet</p>
                  <button
                    className="btn-primary"
                    onClick={() => navigate("/add")}
                  >
                    <Plus size={14} /> Deploy your first project
                  </button>
                </>
              )}
            </Reveal>
          ) : (
            filtered.map((d, i) => (
              <Reveal key={d.id} delay={i * 60}>
                <DeploymentCard
                  d={d}
                  onClick={() => navigate(`/deployment/${d.id}`)}
                />
              </Reveal>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
