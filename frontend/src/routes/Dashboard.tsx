import { useNavigate, Navigate } from "react-router";
import { Plus, LogOut } from "lucide-react";
import dployIcon from "../dployIcon.png";
import { useAuth } from "../lib/AuthContext";
import {
  deploymentSource,
  displayStatus,
  useProjects,
} from "../lib/api";

function SkeletonCard() {
  return (
    <div className="bg-white rounded-lg border p-6">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-3">
            <div className="skeleton h-5 w-40" />
            <div className="skeleton h-5 w-16" />
          </div>
          <div className="skeleton h-4 w-64 mb-2" />
          <div className="skeleton h-4 w-48" />
        </div>
        <div className="text-right">
          <div className="skeleton h-4 w-20 mb-1" />
          <div className="skeleton h-3 w-16" />
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, logout, loading: authLoading } = useAuth();
  const { data, isLoading } = useProjects();

  if (authLoading) return null;
  if (!user) return <Navigate to="/" replace />;

  const deployments = data?.items ?? [];

  const handleSignOut = () => {
    logout();
    navigate("/");
  };

  const displayName = user.name ?? user.login;
  const avatarUrl = user.avatar_url ?? "";

  return (
    <div className="size-full min-h-screen bg-gray-50">
      {/* Nav */}
      <div className="border-b bg-white/80 backdrop-blur-sm nav-bar sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate("/dashboard")}>
            <img src={dployIcon} alt="dploy" className="w-8 h-8 rounded-lg logo-hover" />
            <span className="text-xl font-semibold">dploy</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm">
              {avatarUrl && (
                <img
                  src={avatarUrl}
                  alt="GitHub avatar"
                  className="w-8 h-8 rounded-full ring-2 ring-gray-100 transition-all hover:ring-indigo-200"
                />
              )}
              <span className="text-gray-700">{displayName}</span>
            </div>
            <button
              onClick={handleSignOut}
              className="flex items-center gap-2 text-sm text-gray-500 hover:text-red-500 cursor-pointer btn-hover-subtle rounded-lg px-2 py-1"
            >
              <LogOut className="w-4 h-4" />
              Logout
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 page-content">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-semibold">Your Deployments</h2>
            {!isLoading && (
              <p className="text-sm text-gray-500 mt-1">
                {deployments.length} project{deployments.length !== 1 ? "s" : ""}
              </p>
            )}
          </div>
          <button
            onClick={() => navigate("/add")}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl flex items-center gap-2 cursor-pointer btn-hover"
          >
            <Plus className="w-4 h-4" />
            Add Deployment
          </button>
        </div>

        {/* Deployments List */}
        {isLoading ? (
          <div className="space-y-4">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : deployments.length === 0 ? (
          <div className="text-center py-20 animate__animated animate__fadeIn">
            <div className="text-6xl mb-4">🚀</div>
            <p className="text-gray-500 mb-6 text-lg">No deployments yet</p>
            <button
              onClick={() => navigate("/add")}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-xl cursor-pointer btn-hover inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Deploy your first project
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {deployments.map((deployment, index) => {
              const status = displayStatus(deployment.status);
              const source = deploymentSource(deployment);
              const createdAt = new Date(deployment.created_at);
              return (
                <div
                  key={deployment.id}
                  onClick={() => navigate(`/deployment/${deployment.id}`)}
                  className="bg-white rounded-xl border p-6 cursor-pointer card-hover stagger-item"
                  style={{ animationDelay: `${index * 0.08}s` }}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-medium">{deployment.name ?? "Untitled deployment"}</h3>
                        <span
                          className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                            status === "Running"
                              ? "bg-green-100 text-green-700 badge-running"
                              : status === "Building"
                              ? "bg-yellow-100 text-yellow-700 badge-building"
                              : "bg-red-100 text-red-700 badge-failed"
                          }`}
                        >
                          {status === "Building" && <span className="spinner mr-1.5" style={{ width: 10, height: 10, borderWidth: 1.5 }} />}
                          {status}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500 mb-2">
                        {source.type === "github" ? (
                          <span className="font-mono text-xs">{source.label}</span>
                        ) : (
                          <span className="italic">{source.label}</span>
                        )}
                      </p>
                      {deployment.public_url && (
                        <a
                          href={deployment.public_url}
                          onClick={(e) => e.stopPropagation()}
                          className="text-sm text-indigo-600 hover:text-indigo-700 font-medium transition-colors"
                        >
                          {deployment.public_url} ↗
                        </a>
                      )}
                    </div>
                    <div className="text-right text-sm text-gray-400">
                      <div>{createdAt.toLocaleDateString()}</div>
                      <div className="text-xs mt-0.5">{createdAt.toLocaleTimeString()}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
