import { useNavigate, Navigate } from "react-router";
import { Plus, LogOut } from "lucide-react";
import dployIcon from "../dployIcon.png";
import { useAuth } from "../lib/AuthContext";
import {
  deploymentSource,
  displayStatus,
  useProjects,
} from "../lib/api";

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
      <div className="border-b bg-white">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={dployIcon} alt="DPloy" className="w-8 h-8 rounded-lg" />
            <span className="text-xl">DPloy</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm">
              {avatarUrl && (
                <img
                  src={avatarUrl}
                  alt="GitHub avatar"
                  className="w-8 h-8 rounded-full"
                />
              )}
              <span>{displayName}</span>
            </div>
            <button
              onClick={handleSignOut}
              className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              Logout
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl">Your Deployments</h2>
          <button
            onClick={() => navigate("/add")}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Add Deployment
          </button>
        </div>

        {/* Deployments List */}
        {isLoading ? (
          <div className="text-center py-16 text-gray-500">Loading deployments...</div>
        ) : deployments.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-gray-500 mb-4">No deployments yet</p>
            <button
              onClick={() => navigate("/add")}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg transition-colors cursor-pointer"
            >
              Deploy your first project
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {deployments.map((deployment) => {
              const status = displayStatus(deployment.status);
              const source = deploymentSource(deployment);
              const createdAt = new Date(deployment.created_at);
              return (
                <div
                  key={deployment.id}
                  onClick={() => navigate(`/deployment/${deployment.id}`)}
                  className="bg-white rounded-lg border p-6 hover:shadow-md transition-shadow cursor-pointer"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg">{deployment.name ?? "Untitled deployment"}</h3>
                        <span
                          className={`px-2 py-1 rounded text-xs ${
                            status === "Running"
                              ? "bg-green-100 text-green-700"
                              : status === "Building"
                              ? "bg-yellow-100 text-yellow-700"
                              : "bg-red-100 text-red-700"
                          }`}
                        >
                          {status}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 mb-2">
                        {source.type === "github" ? (
                          <span>{source.label}</span>
                        ) : (
                          <span className="italic">{source.label}</span>
                        )}
                      </p>
                      {deployment.public_url && (
                        <a
                          href={deployment.public_url}
                          onClick={(e) => e.stopPropagation()}
                          className="text-sm text-indigo-600 hover:text-indigo-700"
                        >
                          {deployment.public_url}
                        </a>
                      )}
                    </div>
                    <div className="text-right text-sm text-gray-500">
                      <div>{createdAt.toLocaleDateString()}</div>
                      <div className="text-xs">{createdAt.toLocaleTimeString()}</div>
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
