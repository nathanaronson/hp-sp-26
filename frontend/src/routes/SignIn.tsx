import { useState } from "react";
import { Navigate } from "react-router";
import dployIcon from "../dployIcon.png";
import { loginWithGithub } from "../lib/api";
import { useAuth } from "../lib/AuthContext";

export default function SignIn() {
  const { user, loading } = useAuth();
  const [redirecting, setRedirecting] = useState(false);

  if (loading) return null;
  if (user) return <Navigate to="/dashboard" replace />;

  const handleSignIn = () => {
    setRedirecting(true);
    loginWithGithub();
  };

  return (
    <div className="size-full min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center overflow-hidden">
      <div className="bg-white rounded-2xl shadow-2xl p-12 max-w-md w-full animate__animated animate__fadeInUp" style={{ animationDuration: "0.7s" }}>
        <div className="flex items-center justify-center mb-8">
          <img
            src={dployIcon}
            alt="dploy"
            className="w-20 h-20 rounded-2xl shadow-lg logo-hover animate__animated animate__bounceIn"
            style={{ animationDelay: "0.3s" }}
          />
        </div>
        <h1 className="text-3xl text-center mb-2 animate__animated animate__fadeIn" style={{ animationDelay: "0.5s" }}>
          dploy
        </h1>
        <p className="text-center text-gray-500 mb-8 animate__animated animate__fadeIn" style={{ animationDelay: "0.6s" }}>
          Deploy your apps in under 1 minute
        </p>
        <button
          onClick={handleSignIn}
          disabled={redirecting}
          className="w-full bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white py-3.5 px-4 rounded-xl flex items-center justify-center gap-3 cursor-pointer disabled:cursor-not-allowed btn-hover animate__animated animate__fadeInUp"
          style={{ animationDelay: "0.7s" }}
        >
          {redirecting ? (
            <span className="spinner" style={{ borderColor: "rgba(255,255,255,0.3)", borderTopColor: "white", width: 18, height: 18 }} />
          ) : (
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
          )}
          {redirecting ? "Redirecting to GitHub..." : "Sign in with GitHub"}
        </button>
      </div>
    </div>
  );
}
