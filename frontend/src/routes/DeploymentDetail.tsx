import { useState, useEffect, useRef, useMemo } from "react";
import { useParams, useNavigate, Navigate } from "react-router";
import {
  ArrowLeft, Globe, Terminal, Copy, Download,
  ChevronRight, Trash, X, Rocket, ExternalLink, Mail, MessageSquare, Pencil, Check, Smartphone,
} from "lucide-react";
import { GithubIcon } from "../components/GithubIcon";
import { toast } from "sonner";
import { useAuth } from "../lib/AuthContext";
import { useProject, useDeleteDeployment, useRenameDeployment, displayStatus, deploymentSource, deploymentLogLines } from "../lib/api";
import { Reveal } from "../components/Reveal";
import { Nav } from "../components/Nav";

const BUILD_STEPS = ["Clone", "Detect", "Install", "Build", "Package", "Upload", "Route", "Live"];

const PHOTON_URL =
  (import.meta.env.VITE_PHOTON_URL as string | undefined) ?? "http://localhost:4000";

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
  { txt: "Uploading…", kind: "" },
];

export default function DeploymentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { data: deployment, isLoading, isError } = useProject(id, { poll: true });
  const deleteMutation = useDeleteDeployment();
  const renameMutation = useRenameDeployment();

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [smsPhone, setSmsPhone] = useState("");
  const [smsLinked, setSmsLinked] = useState(false);
  const [smsLinking, setSmsLinking] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const logsRef = useRef<HTMLDivElement>(null);

  // Derived values
  const status = displayStatus(deployment?.status);
  const source = deployment ? deploymentSource(deployment) : { type: "github" as const, label: "" };
  const name = deployment?.name ?? "Untitled deployment";
  const liveUrl = deployment?.public_url ?? null;
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

  // Focus name input when editing starts
  useEffect(() => {
    if (editing && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [editing]);

  const startEditing = () => {
    setEditName(name);
    setEditing(true);
  };

  const saveName = () => {
    const trimmed = editName.trim();
    setEditing(false);
    if (!id || !trimmed || trimmed === name) return;
    renameMutation.mutate(
      { id, name: trimmed },
      {
        onSuccess: () => toast.success(`Renamed to "${trimmed}"`),
        onError: () => toast.error("Failed to rename deployment"),
      },
    );
  };

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

  const linkSms = async () => {
    const phone = smsPhone.trim();
    if (!phone || !id) return;
    setSmsLinking(true);
    try {
      const res = await fetch(`${PHOTON_URL}/api/link-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, deploymentId: id }),
      });
      if (!res.ok) throw new Error("Link failed");
      setSmsLinked(true);
      toast.success("SMS terminal linked");
    } catch {
      toast.error("Failed to link SMS session");
    } finally {
      setSmsLinking(false);
    }
  };

  const unlinkSms = async () => {
    const phone = smsPhone.trim();
    if (!phone) return;
    setSmsLinking(true);
    try {
      await fetch(`${PHOTON_URL}/api/link-session`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      setSmsLinked(false);
      toast.success("SMS terminal unlinked");
    } catch {
      toast.error("Failed to unlink SMS session");
    } finally {
      setSmsLinking(false);
    }
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
              {editing ? (
                <div className="detail-name-edit">
                  <input
                    ref={nameInputRef}
                    className="detail-name-input"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveName();
                      if (e.key === "Escape") setEditing(false);
                    }}
                    onBlur={saveName}
                  />
                  <button className="icon-btn-sm" onClick={saveName} title="Save">
                    <Check size={14} />
                  </button>
                </div>
              ) : (
                <div className="detail-name-row">
                  <h1 className="detail-title">{name}</h1>
                  <button className="icon-btn-sm" onClick={startEditing} title="Edit name">
                    <Pencil size={13} />
                  </button>
                </div>
              )}
            </div>
            {liveUrl && (
              <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="btn-primary btn-sm">
                <ExternalLink size={12} /> Open
              </a>
            )}
          </div>
          <div className="detail-meta-row">
            <div className="detail-meta">
              <span className="mono">{source.label}</span>
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

        {/* Running banner */}
        {status === "Running" && liveUrl && (
          <Reveal delay={100} className="banner banner-ok">
            <div className="banner-top">
              <div className="banner-title-wrap">
                <span className="status-dot-lg dot-ok" aria-hidden />
                <div>
                  <div className="banner-title">Live</div>
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
          </Reveal>
        )}

        {/* SMS Terminal Link — CLI deployments only */}
        {status === "Running" && deployment.kind === "cli" && (
          <Reveal delay={120} className="banner banner-ok">
            <div className="banner-top" style={{ marginBottom: smsLinked ? 0 : 12 }}>
              <div className="banner-title-wrap">
                <Smartphone size={18} />
                <div>
                  <div className="banner-title">
                    {smsLinked ? "SMS Terminal Active" : "SMS Terminal"}
                  </div>
                  <div className="banner-sub">
                    {smsLinked
                      ? `Linked to ${smsPhone} — text this number to interact with the terminal`
                      : "Link your phone to interact with this CLI via text messages"}
                  </div>
                </div>
              </div>
              {smsLinked && (
                <button
                  className="btn-ghost danger-hover"
                  onClick={unlinkSms}
                  disabled={smsLinking}
                >
                  <X size={14} /> Disconnect
                </button>
              )}
            </div>
            {!smsLinked && (
              <div className="sms-link-row">
                <div className="sms-input-wrap">
                  <span className="sms-input-icon"><Smartphone size={14} /></span>
                  <input
                    className="sms-input"
                    type="tel"
                    placeholder="+1 555 123 4567"
                    value={smsPhone}
                    onChange={(e) => setSmsPhone(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") linkSms(); }}
                  />
                </div>
                <button
                  className="btn-primary"
                  onClick={linkSms}
                  disabled={smsLinking || !smsPhone.trim()}
                >
                  {smsLinking ? (
                    <><span className="spinner-white" aria-hidden /> Linking…</>
                  ) : (
                    <><MessageSquare size={14} /> Start</>
                  )}
                </button>
              </div>
            )}
          </Reveal>
        )}

        {/* Failed banner */}
        {status === "Failed" && (
          <Reveal delay={100} className="banner banner-err">
            <div className="banner-top">
              <div className="banner-title-wrap">
                <span className="status-dot-lg dot-err" aria-hidden />
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
