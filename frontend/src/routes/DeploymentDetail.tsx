import { useState, useEffect, useRef, useMemo } from "react";
import { useParams, useNavigate, Navigate } from "react-router";
import {
  ArrowLeft, Globe, Terminal, Key, Cpu, Copy, Download,
  ChevronRight, Trash, X, Rocket, ExternalLink, Mail, MessageSquare,
} from "lucide-react";
import { GithubIcon } from "../components/GithubIcon";
import { toast } from "sonner";
import { useAuth } from "../lib/AuthContext";
import { useProject, useDeleteDeployment, displayStatus, deploymentSource, deploymentLogLines } from "../lib/api";
import { Reveal } from "../components/Reveal";
import { Sparkline } from "../components/Sparkline";
import { Nav } from "../components/Nav";
import type { DeploymentRead } from "../client/types.gen";

const BUILD_STEPS = ["Clone", "Detect", "Install", "Build", "Package", "Upload", "Route", "Live"];

const MOCK_LOG_LINES = [
  { txt: "$ dploy build --prod", kind: "cmd" },
  { txt: "Cloning repository…", kind: "" },
  { txt: "Detected: Node.js 20 (package.json)", kind: "info" },
  { txt: "Running npm install…", kind: "" },
  { txt: "added 847 packages in 12.4s", kind: "muted" },
  { txt: "Running npm run build…", kind: "" },
  { txt: "vite v8.0.8 building for production…", kind: "" },
  { txt: "✓ 214 modules transformed", kind: "ok" },
  { txt: "dist/index.html   0.42 kB │ gzip: 0.28 kB", kind: "muted" },
  { txt: "dist/assets/index-4f8a3.js   148.23 kB │ gzip: 47.82 kB", kind: "muted" },
  { txt: "✓ built in 3.82s", kind: "ok" },
  { txt: "Packaging container image…", kind: "" },
  { txt: "Uploading to us-east-1…", kind: "" },
];

function RunningMetric({ label, value, spark }: { label: string; value: string; spark: number }) {
  return (
    <div className="running-metric">
      <div className="rm-top">
        <span className="rm-label">{label}</span>
        <Sparkline seed={spark} color="var(--ok-ink)" width={52} height={18} />
      </div>
      <div className="rm-val">{value}</div>
    </div>
  );
}

export default function DeploymentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { data: deployment, isLoading, isError } = useProject(id, { poll: true });
  const deleteMutation = useDeleteDeployment();

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(true);
  const logsRef = useRef<HTMLDivElement>(null);

  // Derived values
  const status = displayStatus(deployment?.status);
  const source = deployment ? deploymentSource(deployment) : { type: "github" as const, label: "" };
  const name = deployment?.name ?? "Untitled deployment";
  const liveUrl = deployment?.public_url ?? null;
  const port = deployment?.exposed_ports?.[0] ?? 3000;
  const region = "us-east-1";
  const elapsed = deployment
    ? (Date.now() - new Date(deployment.created_at).getTime()) / 1000
    : 0;
  const progress = useMemo(() => {
    if (!deployment) return 0;
    if (deployment.status === "running") return 100;
    if (["building", "analyzing", "pending"].includes(deployment.status)) {
      return Math.min(95, (elapsed / 30) * 100);
    }
    return 0;
  }, [deployment, elapsed]);

  // Build log lines — use real logs if available, otherwise mock
  const realLogs = deployment ? deploymentLogLines(deployment) : [];
  const logLines = useMemo(() => {
    if (realLogs.length > 0) {
      return realLogs.map((txt) => {
        let kind = "";
        if (txt.startsWith("$") || txt.startsWith("#")) kind = "cmd";
        else if (txt.startsWith("✓")) kind = "ok";
        else if (txt.startsWith("✗") || txt.startsWith("ERROR")) kind = "err";
        return { txt, kind };
      });
    }
    // Show mock logs progressively during building
    if (status === "Building") {
      const showCount = Math.min(MOCK_LOG_LINES.length, Math.floor(elapsed / 2) + 1);
      return MOCK_LOG_LINES.slice(0, showCount);
    }
    if (status === "Running") return MOCK_LOG_LINES;
    return MOCK_LOG_LINES.slice(0, 3);
  }, [realLogs, status, elapsed]);

  // Auto-scroll logs
  useEffect(() => {
    if (logsRef.current && logsOpen) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [logLines, logsOpen]);

  // Escape key to close modal
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && deleteOpen && !deleteMutation.isPending) {
        setDeleteOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteOpen, deleteMutation.isPending]);

  const confirmDelete = () => {
    if (!id) return;
    deleteMutation.mutate(id, {
      onSuccess: () => {
        setDeleteOpen(false);
        toast.success("Deployment deleted");
        navigate("/dashboard");
      },
      onError: () => {
        toast.error("Failed to delete deployment");
      },
    });
  };

  const copyUrl = () => {
    if (liveUrl) {
      navigator.clipboard.writeText(liveUrl);
      toast.success("URL copied");
    }
  };

  const copyLogs = () => {
    const text = logLines.map((l) => l.txt).join("\n");
    navigator.clipboard.writeText(text);
    toast.success("Logs copied");
  };

  const downloadLogs = () => {
    const text = logLines.map((l) => l.txt).join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${name}-build.log`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success("Logs downloaded");
  };

  // Auth loading
  if (authLoading) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
      <span className="big-spinner" />
    </div>
  );
  if (!user) return <Navigate to="/signin" replace />;

  // Data loading
  if (isLoading) {
    return (
      <div style={{ background: "var(--bg)", minHeight: "100vh" }}>
        <Nav />
        <div className="detail-wrap" style={{ display: "flex", justifyContent: "center", paddingTop: 80 }}>
          <span className="big-spinner" aria-label="Loading" />
        </div>
      </div>
    );
  }

  // Not found / error
  if (!id || isError || !deployment) {
    return (
      <div style={{ background: "var(--bg)", minHeight: "100vh" }}>
        <Nav />
        <div className="detail-wrap" style={{ textAlign: "center", paddingTop: 80 }}>
          <h2 style={{ color: "var(--ink)", marginBottom: 8 }}>Deployment not found</h2>
          <p style={{ color: "var(--ink-faint)", marginBottom: 20 }}>
            It may have been deleted or the ID is invalid.
          </p>
          <button className="btn-primary" onClick={() => navigate("/dashboard")}>
            <ArrowLeft size={14} /> Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh" }}>
      <Nav />
      <div className="detail-wrap">
        {/* Header */}
        <Reveal>
          <button className="back-btn" onClick={() => navigate("/dashboard")}>
            <ArrowLeft size={14} /> Back to Dashboard
          </button>
        </Reveal>

        <Reveal delay={60} className="detail-header">
          <div className="detail-header-top">
            <div className="detail-header-left">
              <div className={`detail-icon dicon-${status === "Running" ? "ok" : status === "Building" ? "warn" : "err"}`}>
                {source.type === "github" ? <GithubIcon size={20} /> : <Terminal size={20} />}
              </div>
              <h1 className="detail-title">{name}</h1>
            </div>
            {liveUrl && (
              <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="btn-primary">
                <ExternalLink size={14} /> Open
              </a>
            )}
          </div>
          <div className="detail-meta-row">
            <div className="detail-meta">
              <span className="mono">{source.label}</span>
              {port && (
                <>
                  <span className="dot-sep">•</span>
                  <span className="mono tiny">:{port}</span>
                </>
              )}
              <span className="dot-sep">•</span>
              <span className={`pill pill-${status === "Running" ? "ok" : status === "Building" ? "warn" : "err"}`}>
                {status === "Running" && <span className="pill-dot" aria-hidden />}
                {status === "Failed" && <span className="pill-x" aria-hidden>✕</span>}
                {status}
              </span>
            </div>
            <button
              className="btn-ghost danger-hover"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash size={14} /> Delete
            </button>
          </div>
        </Reveal>

        {/* Building banner */}
        {status === "Building" && (
          <Reveal delay={100} className="banner banner-warn">
            <div className="banner-top">
              <div className="banner-title-wrap">
                <span className="big-spinner" aria-hidden />
                <div>
                  <div className="banner-title">Deploying to {region}…</div>
                  <div className="banner-sub">
                    ETA {Math.max(0, Math.round(29.5 - elapsed))}s · step{" "}
                    {Math.min(8, Math.floor(elapsed / 4) + 1)} of 8
                  </div>
                </div>
              </div>
              <div className="banner-time">{elapsed.toFixed(1)}s</div>
            </div>
            <div className="banner-progress">
              <div className="progress-track tall">
                <div className="progress-fill" style={{ width: `${progress}%` }}>
                  <span className="progress-sheen" aria-hidden />
                </div>
              </div>
              <div className="steps-row">
                {BUILD_STEPS.map((s, i) => {
                  const done = progress > (i + 1) * 12;
                  const cur = progress > i * 12 && !done;
                  return (
                    <div key={s} className={`step-chip ${done ? "done" : cur ? "cur" : ""}`}>
                      <span className="step-chip-dot" aria-hidden />
                      {s}
                    </div>
                  );
                })}
              </div>
            </div>
          </Reveal>
        )}

        {/* Running banner */}
        {status === "Running" && liveUrl && (
          <Reveal delay={100} className="banner banner-ok">
            <div className="banner-top">
              <div className="banner-title-wrap">
                <span className="live-dot-big" aria-hidden />
                <div>
                  <div className="banner-title">Live</div>
                  <div className="banner-sub">Deployed and serving traffic</div>
                </div>
              </div>
            </div>
            <div className="live-url-bar">
              <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="live-url-link">
                <Globe size={14} />
                <span className="mono">{liveUrl}</span>
                <ExternalLink size={12} className="live-ext" />
              </a>
              <div className="live-url-actions">
                <button className="icon-btn-lg" onClick={copyUrl} title="Copy URL">
                  <Copy size={14} />
                </button>
                <button
                  className="icon-btn-lg"
                  title="Share via email"
                  onClick={() => {
                    if (liveUrl) window.open(`mailto:?subject=Check out ${name}&body=${liveUrl}`);
                  }}
                >
                  <Mail size={14} />
                </button>
                <button
                  className="icon-btn-lg"
                  title="Share via iMessage"
                  onClick={() => toast.info("iMessage share would open on macOS/iOS")}
                >
                  <MessageSquare size={14} />
                </button>
              </div>
            </div>
            <div className="running-metrics">
              <RunningMetric label="Requests" value="—" spark={3} />
              <RunningMetric label="p50 latency" value="42ms" spark={1} />
              <RunningMetric label="p99 latency" value="128ms" spark={4} />
              <RunningMetric label="Uptime" value="just now" spark={6} />
            </div>
          </Reveal>
        )}

        {/* Failed banner */}
        {status === "Failed" && (
          <Reveal delay={100} className="banner banner-err">
            <div className="banner-top">
              <div className="banner-title-wrap">
                <div className="err-circle"><X size={16} /></div>
                <div>
                  <div className="banner-title">Deployment failed</div>
                  <div className="banner-sub">
                    {deployment.error ?? "An error occurred during build"}
                  </div>
                </div>
              </div>
              <button
                className="btn-ghost"
                onClick={() => toast.info("Retry triggered")}
              >
                <Rocket size={14} /> Retry
              </button>
            </div>
          </Reveal>
        )}

        {/* Build Logs */}
        <Reveal delay={160} className="logs-panel">
          <div className="logs-head">
            <div className="logs-head-l">
              <Terminal size={14} />
              <span>Build Logs</span>
              {status === "Building" && (
                <span className="live-tag" role="status">
                  <span className="live-dot" aria-hidden /> LIVE
                </span>
              )}
            </div>
            <div className="logs-head-r">
              <button className="icon-btn-sm" title="Copy logs" onClick={copyLogs}>
                <Copy size={12} />
              </button>
              <button className="icon-btn-sm" title="Download logs" onClick={downloadLogs}>
                <Download size={12} />
              </button>
              <button
                className={`logs-toggle ${logsOpen ? "" : "collapsed"}`}
                onClick={() => setLogsOpen((v) => !v)}
                aria-expanded={logsOpen}
              >
                <ChevronRight size={12} className={`chev-r${logsOpen ? "" : " rotated"}`} />
                {logsOpen ? "Collapse" : "Expand"}
              </button>
            </div>
          </div>
          <div className={`logs-collapse ${logsOpen ? "" : "closed"}`}>
            <div ref={logsRef} className="logs-body">
              {logLines.length === 0 && status === "Building" && (
                <div className="log-row log-muted">Waiting for logs…</div>
              )}
              {logLines.map((l, i) => (
                <div key={i} className={`log-row log-${l.kind}`}>
                  {l.txt || " "}
                </div>
              ))}
              {status === "Building" && (
                <div className="log-row log-cursor">
                  <span className="cursor-blink" aria-hidden>▌</span>
                </div>
              )}
            </div>
          </div>
        </Reveal>

        {/* Info grid */}
        <div className="info-grid">
          <Reveal delay={200} className="info-card">
            <div className="info-title"><Key size={13} /> Environment</div>
            <div className="kv">
              <div><span className="k">NODE_ENV</span><span className="v">production</span></div>
              <div><span className="k">PORT</span><span className="v">{port}</span></div>
              <div><span className="k">DB_URL</span><span className="v masked">•••••••••••••</span></div>
            </div>
          </Reveal>
          <Reveal delay={240} className="info-card">
            <div className="info-title"><Cpu size={13} /> Resources</div>
            <div className="kv">
              <div><span className="k">Memory</span><span className="v">512MB / 1GB</span></div>
              <div><span className="k">CPU</span><span className="v">0.3 / 2 vCPU</span></div>
              <div><span className="k">Region</span><span className="v">{region}</span></div>
            </div>
          </Reveal>
        </div>

        {/* Delete modal */}
        {deleteOpen && (
          <div className="modal-root" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <div
              className="modal-bg"
              onClick={() => !deleteMutation.isPending && setDeleteOpen(false)}
            />
            <div className="modal-card">
              <div className="modal-iconwrap err">
                <Trash size={22} />
              </div>
              <h3 className="modal-title" id="modal-title">Delete deployment?</h3>
              <p className="modal-body">
                This will shut down <strong>{name}</strong> and free its URL. This action
                can&apos;t be undone.
              </p>
              <div className="modal-actions">
                <button
                  className="btn-ghost"
                  onClick={() => setDeleteOpen(false)}
                  disabled={deleteMutation.isPending}
                >
                  Cancel
                </button>
                <button className="btn-danger" onClick={confirmDelete} disabled={deleteMutation.isPending}>
                  {deleteMutation.isPending ? (
                    <><span className="spinner-white" aria-hidden /> Deleting…</>
                  ) : (
                    <><Trash size={13} /> Delete</>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
