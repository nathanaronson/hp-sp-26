import { useState, useEffect } from "react";
import { Navigate, useNavigate } from "react-router";

import dployIcon from "../dployIcon.png";
import { loginWithGithub } from "../lib/api";
import { GithubIcon } from "../components/GithubIcon";
import { useAuth } from "../lib/AuthContext";

const FLOATING_TOKENS = [
  { txt: "→ git push", top: "12%", left: "8%", delay: 0 },
  { txt: "$ dploy deploy", top: "24%", left: "82%", delay: 2 },
  { txt: "✓ LIVE", top: "68%", left: "6%", delay: 4, kind: "ok" },
  { txt: "port 3000", top: "78%", left: "86%", delay: 1 },
  { txt: "building…", top: "42%", left: "92%", delay: 3, kind: "warn" },
  { txt: "npm install", top: "58%", left: "3%", delay: 2.5 },
];

export default function SignIn() {
  const { user, loading } = useAuth();
  const [redirecting, setRedirecting] = useState(false);

  // Sync dark mode from localStorage on load
  useEffect(() => {
    try {
      const t = JSON.parse(localStorage.getItem("dployTweaks") || "{}");
      document.documentElement.classList.toggle("dark", t.theme === "dark");
    } catch {}
  }, []);

  if (loading) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
      <span className="big-spinner" />
    </div>
  );
  if (user) return <Navigate to="/dashboard" replace />;

  const handleSignIn = () => {
    setRedirecting(true);
    loginWithGithub();
  };

  return (
    <div className="signin-root">
      {/* Ambient background */}
      <div className="dots-bg" aria-hidden>
        <div className="dots-layer" />
        <div className="dots-layer dots-layer-2" />
      </div>
      <div className="orb orb-1" aria-hidden />
      <div className="orb orb-2" aria-hidden />
      <div className="orb orb-3" aria-hidden />

      {/* Floating CLI tokens */}
      <div className="floating-tokens" aria-hidden>
        {FLOATING_TOKENS.map((t, i) => (
          <div
            key={i}
            className={`ft${t.kind ? ` ft-${t.kind}` : ""}`}
            style={{ top: t.top, left: t.left, animationDelay: `${t.delay}s` }}
          >
            {t.txt}
          </div>
        ))}
      </div>

      {/* Hero card */}
      <div className="signin-card">
        <div className="signin-logo-center">
          <div className="signin-logo-wrap">
            <img src={dployIcon} alt="dploy" className="signin-logo" />
            <div className="signin-logo-trail" aria-hidden>
              <span /><span /><span />
            </div>
          </div>
        </div>

        <h1 className="signin-title">
          <span className="word">dploy</span>
        </h1>
        <p className="signin-sub">One command. One minute. One live URL.</p>

        {/* Stats strip */}
        <div className="signin-stats">
          <div className="stat-block">
            <div className="stat-num">&lt;60<span className="unit">s</span></div>
            <div className="stat-lbl">avg deploy</div>
          </div>
          <div className="stat-divider" />
          <div className="stat-block">
            <div className="stat-num">99.9<span className="unit">%</span></div>
            <div className="stat-lbl">uptime</div>
          </div>
          <div className="stat-divider" />
          <div className="stat-block">
            <div className="stat-num">3<span className="unit">x</span></div>
            <div className="stat-lbl">regions</div>
          </div>
        </div>

        <button
          onClick={handleSignIn}
          disabled={redirecting}
          className="btn-primary-xl"
        >
          {redirecting ? (
            <>
              <span className="spinner-white" aria-hidden />
              Redirecting to GitHub…
            </>
          ) : (
            <>
              <GithubIcon size={18} />
              Continue with GitHub
            </>
          )}
          <span className="btn-shine" aria-hidden />
        </button>

        <div className="signin-foot">
          <span className="kbd">⌘ K</span>
          <span>or</span>
          <code className="inline-code">dploy login</code>
        </div>
      </div>
    </div>
  );
}
