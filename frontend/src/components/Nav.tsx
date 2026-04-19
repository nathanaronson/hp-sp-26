import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { LogOut, Sun, Moon } from "lucide-react";
import dployIcon from "../dployIcon.png";
import { useAuth } from "../lib/AuthContext";

function useDarkMode() {
  const [dark, setDark] = useState(() => {
    try {
      const t = JSON.parse(localStorage.getItem("dployTweaks") || "{}");
      return t.theme === "dark";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try {
      const t = JSON.parse(localStorage.getItem("dployTweaks") || "{}");
      localStorage.setItem("dployTweaks", JSON.stringify({ ...t, theme: dark ? "dark" : "light" }));
    } catch {}
  }, [dark]);

  return [dark, setDark] as const;
}

export function Nav() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [dark, setDark] = useDarkMode();

  const handleLogout = async () => {
    await logout();
    navigate("/signin");
  };

  const displayName = user?.name ?? user?.login ?? "";
  const avatarUrl = user?.avatar_url ?? "";

  return (
    <nav className="navbar">
      <div className="nav-inner">
        <a className="nav-brand" onClick={() => navigate("/dashboard")} href="#">
          <div className="nav-logo-wrap">
            <img src={dployIcon} alt="dploy" className="nav-logo" />
            <div className="nav-logo-pulse" aria-hidden />
          </div>
          <div className="nav-brandtext">
            <span className="nav-title">dploy</span>
            <span className="nav-sub">deploy anything</span>
          </div>
        </a>

        <div className="nav-right">
          <button
            className="icon-btn"
            onClick={() => setDark((d) => !d)}
            aria-label="Toggle dark mode"
            title="Toggle dark mode"
          >
            <div className={`theme-swap ${dark ? "is-dark" : ""}`}>
              <Sun size={14} />
              <Moon size={14} />
            </div>
          </button>

          {user && (
            <>
              <div className="nav-user">
                {avatarUrl ? (
                  <img src={avatarUrl} alt={displayName} className="avatar" />
                ) : (
                  <div className="avatar" />
                )}
                <span className="nav-username">{displayName}</span>
              </div>
              <button className="logout-btn" onClick={handleLogout} title="Sign out">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <LogOut size={14} /> Logout
                </span>
              </button>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
