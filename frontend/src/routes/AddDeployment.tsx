import { useState, useEffect, type FormEvent } from "react";
import { useNavigate, Navigate } from "react-router";
import { ArrowLeft, Terminal, Check, Key, Rocket, Link, X, Plus, Upload, Eye, EyeOff } from "lucide-react";
import { GithubIcon } from "../components/GithubIcon";
import { toast } from "sonner";
import { useAuth } from "../lib/AuthContext";
import { useDeploy } from "../lib/api";
import { Reveal } from "../components/Reveal";
import { Nav } from "../components/Nav";

const MOCK_RECENT_REPOS = [
  { full: "vercel/next.js", desc: "The React Framework", stars: 122000, lang: "TypeScript", updated: "1h ago" },
  { full: "honojs/hono", desc: "Web framework for edge runtimes", stars: 20400, lang: "TypeScript", updated: "3h ago" },
  { full: "pocketbase/pocketbase", desc: "Open Source backend in 1 file", stars: 39800, lang: "Go", updated: "1d ago" },
  { full: "withastro/astro", desc: "The web framework for content-driven websites", stars: 46200, lang: "Astro", updated: "2d ago" },
  { full: "pallets/flask", desc: "The Python micro framework", stars: 68000, lang: "Python", updated: "4d ago" },
];

const LANG_CLS: Record<string, string> = {
  TypeScript: "lang-typescript",
  Go: "lang-go",
  Astro: "lang-astro",
  Python: "lang-python",
};

type Permission = "ask" | "denied" | "loading" | "granted";

interface EnvVar {
  id: number;
  key: string;
  value: string;
  secret: boolean;
}

let envIdCounter = 1;
const emptyEnvVar = (): EnvVar => ({ id: envIdCounter++, key: "", value: "", secret: false });

export default function AddDeployment() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const deploy = useDeploy();
  const [mode, setMode] = useState<"github" | "local">("github");
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [envVars, setEnvVars] = useState<EnvVar[]>([emptyEnvVar()]);
  const [envExpanded, setEnvExpanded] = useState(false);

  const [permission, setPermission] = useState<Permission>(() => {
    try { return (localStorage.getItem("dployRepoPerm") as Permission) || "ask"; } catch { return "ask"; }
  });
  const [recent, setRecent] = useState(permission === "granted" ? MOCK_RECENT_REPOS : []);

  useEffect(() => {
    try { localStorage.setItem("dployRepoPerm", permission); } catch {}
  }, [permission]);

  // ⌘+Enter shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && mode === "github" && url && !submitting) {
        e.preventDefault();
        handleDeploy();
      }
      if (e.key === "Escape") navigate("/dashboard");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [url, submitting, mode]);

  if (authLoading) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
      <span className="big-spinner" />
    </div>
  );
  if (!user) return <Navigate to="/signin" replace />;

  const grantPermission = () => {
    setPermission("loading");
    setTimeout(() => {
      setPermission("granted");
      setRecent(MOCK_RECENT_REPOS);
      toast.success("Connected to GitHub");
    }, 650);
  };

  const addEnvVar = () => setEnvVars((prev) => [...prev, emptyEnvVar()]);

  const updateEnvVar = (id: number, field: "key" | "value", val: string) => {
    setEnvVars((prev) => prev.map((v) => (v.id === id ? { ...v, [field]: val } : v)));
  };

  const toggleSecret = (id: number) => {
    setEnvVars((prev) => prev.map((v) => (v.id === id ? { ...v, secret: !v.secret } : v)));
  };

  const removeEnvVar = (id: number) => {
    setEnvVars((prev) => {
      const next = prev.filter((v) => v.id !== id);
      return next.length === 0 ? [emptyEnvVar()] : next;
    });
  };

  const pasteEnvFile = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".env,.env.*,text/plain";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      const parsed: EnvVar[] = [];
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx < 1) continue;
        const k = trimmed.slice(0, eqIdx).trim();
        let v = trimmed.slice(eqIdx + 1).trim();
        // Strip surrounding quotes
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        parsed.push({ id: envIdCounter++, key: k, value: v, secret: false });
      }
      if (parsed.length === 0) {
        toast.error("No valid KEY=value lines found");
        return;
      }
      setEnvVars(parsed);
      setEnvExpanded(true);
      toast.success(`Imported ${parsed.length} variable${parsed.length > 1 ? "s" : ""}`);
    };
    input.click();
  };

  const handleDeploy = (e?: FormEvent) => {
    e?.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) { toast.error("Paste a GitHub URL first"); return; }
    // Collect non-empty env vars
    const envObj: Record<string, string> = {};
    for (const v of envVars) {
      const k = v.key.trim();
      if (k && v.value) envObj[k] = v.value;
    }

    setSubmitting(true);
    deploy.mutate(
      { body: { github_url: trimmed, ...(Object.keys(envObj).length > 0 ? { env_vars: envObj } : {}) } as never },
      {
        onSuccess: (created) => {
          setSubmitting(false);
          navigate(`/deployment/${created.id}`);
        },
        onError: () => {
          setSubmitting(false);
          toast.error("Failed to start deployment");
        },
      },
    );
  };

  const displayUrl = url.replace(/^https?:\/\/github\.com\//, "");

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh" }}>
      <Nav />
      <div className="add-wrap">
        <Reveal>
          <button className="back-btn" onClick={() => navigate("/dashboard")}>
            <ArrowLeft size={14} /> Back to Dashboard
          </button>
        </Reveal>

        <Reveal delay={60}>
          <div className="add-header">
            <div className="add-header-badge">
              <Rocket size={14} /> New deployment
            </div>
            <h1 className="add-title">Let's ship something.</h1>
            <p className="add-sub">
              From repo to live URL — typically in <strong>38 seconds.</strong>
            </p>
          </div>
        </Reveal>

        {/* Mode switcher */}
        <Reveal delay={120} className="mode-switch">
          <button
            className={`mode-card ${mode === "github" ? "sel" : ""}`}
            onClick={() => setMode("github")}
          >
            <div className="mode-icon"><GithubIcon size={28} /></div>
            <div>
              <div className="mode-title">GitHub Repository</div>
              <div className="mode-sub">Any public or connected repo</div>
            </div>
            <div className="mode-check">{mode === "github" && <Check size={14} />}</div>
          </button>
          <button
            className={`mode-card ${mode === "local" ? "sel" : ""}`}
            onClick={() => setMode("local")}
          >
            <div className="mode-icon"><Terminal size={28} /></div>
            <div>
              <div className="mode-title">Local Project</div>
              <div className="mode-sub">Via the dploy CLI</div>
            </div>
            <div className="mode-check">{mode === "local" && <Check size={14} />}</div>
          </button>
        </Reveal>

        {mode === "github" ? (
          <Reveal delay={180} className="add-panel">
            {/* URL input */}
            <label className="field">
              <span className="field-label">
                <Link size={13} /> Repository URL
              </span>
              <div className="url-input-wrap">
                <span className="url-prefix">github.com/</span>
                <input
                  autoFocus
                  value={displayUrl}
                  onChange={(e) => setUrl("https://github.com/" + e.target.value)}
                  placeholder="owner/repo"
                  className="url-input"
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      e.preventDefault();
                      handleDeploy();
                    }
                  }}
                />
                {url && (
                  <button className="url-clear" onClick={() => setUrl("")} aria-label="Clear URL">
                    <X size={12} />
                  </button>
                )}
              </div>
            </label>

            {/* Recent repos — permission gated */}
            <div className="field">
              <span className="field-label">
                <GithubIcon size={13} /> Recent public repos
              </span>

              {permission === "ask" && (
                <div className="perm-card">
                  <div className="perm-icon"><Key size={18} /></div>
                  <div>
                    <div className="perm-title">Show repos from your GitHub account?</div>
                    <div className="perm-sub">
                      dploy will read your <span className="mono">public_repo</span> list to show
                      recent suggestions here. Read-only, nothing is stored.
                    </div>
                    <div className="perm-actions">
                      <button className="btn-ghost" onClick={() => setPermission("denied")}>
                        Not now
                      </button>
                      <button className="btn-primary" onClick={grantPermission}>
                        <Check size={14} /> Allow
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {permission === "loading" && (
                <div className="perm-loading">
                  <span className="mini-spinner" aria-hidden /> Fetching your recent repos…
                </div>
              )}

              {permission === "denied" && (
                <div className="perm-denied">
                  <span>Suggestions disabled.</span>
                  <button className="linklike" onClick={() => setPermission("ask")}>
                    Enable
                  </button>
                </div>
              )}

              {permission === "granted" && (
                <div className="repo-list">
                  {recent.map((r) => (
                    <button
                      key={r.full}
                      className={`repo-card ${url.endsWith(r.full) ? "sel" : ""}`}
                      onClick={() => setUrl("https://github.com/" + r.full)}
                    >
                      <div className="repo-card-l">
                        <GithubIcon size={14} />
                        <div>
                          <div className="repo-card-name">{r.full}</div>
                          <div className="repo-card-desc">{r.desc}</div>
                        </div>
                      </div>
                      <div className="repo-card-r">
                        <span className={`lang-dot ${LANG_CLS[r.lang] ?? ""}`} />
                        <span style={{ fontSize: 11.5 }}>{r.lang}</span>
                        <span style={{ fontSize: 11, fontFamily: "var(--mono)" }}>★ {r.stars.toLocaleString()}</span>
                        <span style={{ fontSize: 11 }}>{r.updated}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Environment variables */}
            <div className="field">
              <button
                className="env-toggle"
                onClick={() => setEnvExpanded((e) => !e)}
                type="button"
              >
                <span className="field-label" style={{ margin: 0 }}>
                  <Key size={13} /> Environment variables
                </span>
                <span className="env-opt-badge">optional</span>
                <span className={`env-chevron ${envExpanded ? "open" : ""}`}>&#8250;</span>
              </button>

              {envExpanded && (
                <div className="env-panel">
                  <div className="env-header">
                    <span className="env-hint">
                      Keys are injected at runtime. Values marked secret are stored encrypted.
                    </span>
                    <button className="env-paste-btn" onClick={pasteEnvFile} type="button">
                      <Upload size={12} /> Paste .env
                    </button>
                  </div>

                  <div className="env-rows">
                    {envVars.map((v) => (
                      <div key={v.id} className="env-row">
                        <input
                          className="env-key-input"
                          value={v.key}
                          onChange={(e) => updateEnvVar(v.id, "key", e.target.value)}
                          placeholder="API_KEY"
                          spellCheck={false}
                        />
                        <span className="env-eq">=</span>
                        <input
                          className="env-val-input"
                          value={v.value}
                          onChange={(e) => updateEnvVar(v.id, "value", e.target.value)}
                          placeholder="value"
                          type={v.secret ? "password" : "text"}
                          spellCheck={false}
                        />
                        <button
                          className={`env-secret-btn ${v.secret ? "is-secret" : ""}`}
                          onClick={() => toggleSecret(v.id)}
                          title={v.secret ? "Show value" : "Mark as secret"}
                          type="button"
                        >
                          {v.secret ? <EyeOff size={13} /> : <Eye size={13} />}
                        </button>
                        <button
                          className="env-remove-btn"
                          onClick={() => removeEnvVar(v.id)}
                          title="Remove variable"
                          type="button"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>

                  <button className="env-add-btn" onClick={addEnvVar} type="button">
                    <Plus size={13} /> Add variable
                  </button>
                </div>
              )}
            </div>

            {/* Deploy button */}
            <button
              className="btn-primary-xl deploy-btn"
              disabled={!url || submitting}
              onClick={() => handleDeploy()}
            >
              {submitting ? (
                <><span className="spinner-white" aria-hidden /> Starting deployment…</>
              ) : (
                <>
                  <Rocket size={16} /> Deploy
                  <span className="kbd-inline-white">
                    <span className="kbd kbd-light">⌘</span>
                    <span className="kbd kbd-light">⏎</span>
                  </span>
                  <span className="btn-shine" aria-hidden />
                </>
              )}
            </button>

            <div className="deploy-foot">
              Press <span className="kbd">⌘</span><span className="kbd">⏎</span> to deploy
              <span className="dot-sep">•</span>
              <span className="kbd">Esc</span> to cancel
            </div>
          </Reveal>
        ) : (
          <Reveal delay={180} className="add-panel">
            <div className="cli-steps">
              <div className="step">
                <div className="step-num">1</div>
                <div className="step-body">
                  <div className="step-title">Install the dploy CLI</div>
                  <pre className="codeblock">
                    <span className="prompt">$</span> curl -sL https://dploy.sh/install | sh
                  </pre>
                </div>
              </div>
              <div className="step">
                <div className="step-num">2</div>
                <div className="step-body">
                  <div className="step-title">Authenticate</div>
                  <pre className="codeblock">
                    <span className="prompt">$</span> dploy login
                  </pre>
                </div>
              </div>
              <div className="step">
                <div className="step-num">3</div>
                <div className="step-body">
                  <div className="step-title">Deploy from any directory</div>
                  <pre className="codeblock">
                    <div><span className="prompt">$</span> cd ~/my-project</div>
                    <div><span className="prompt">$</span> dploy deploy</div>
                    <div className="cli-out"># uploading 218 files…</div>
                    <div className="cli-out ok">✓ deployed in 38s → https://my-project.dploy.sh</div>
                  </pre>
                </div>
              </div>
            </div>
            <div className="cli-hint">
              <Terminal size={14} />
              Auto-detects Node, Python, Go, Rust, Deno, Bun, Docker.
            </div>
          </Reveal>
        )}
      </div>
    </div>
  );
}
