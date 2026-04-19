import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Navigate } from "react-router";
import { ArrowLeft, Copy, ExternalLink, Mail, MessageSquare, Trash2 } from "lucide-react";
import { toast } from "sonner";
import dployIcon from "../dployIcon.png";
import { useAuth } from "../lib/AuthContext";
import {
  deploymentLogLines,
  deploymentSource,
  displayStatus,
  useDeleteDeployment,
  useProject,
} from "../lib/api";

export default function DeploymentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { data: deployment, isLoading, isError } = useProject(id, { poll: true });
  const deleteDeployment = useDeleteDeployment();
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [deployment]);

  if (authLoading) return null;
  if (!user) return <Navigate to="/" replace />;

  if (isError) {
    return (
      <div className="size-full min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center animate__animated animate__fadeIn">
          <div className="text-5xl mb-4 animate__animated animate__shakeX">😵</div>
          <h2 className="text-2xl mb-4 font-semibold">Deployment not found</h2>
          <button
            onClick={() => navigate("/dashboard")}
            className="text-indigo-600 hover:text-indigo-700 cursor-pointer btn-hover-subtle font-medium"
          >
            ← Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (isLoading || !deployment) {
    return (
      <div className="size-full min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="spinner mx-auto mb-4" style={{ width: 32, height: 32, borderWidth: 3, borderColor: "rgba(99,102,241,0.2)", borderTopColor: "#6366f1" }} />
          <p className="text-gray-500">Loading deployment...</p>
        </div>
      </div>
    );
  }

  const status = displayStatus(deployment.status);
  const source = deploymentSource(deployment);
  const logLines = deploymentLogLines(deployment);
  const port = deployment.exposed_ports?.[0] ?? null;
  const name = deployment.name ?? "Untitled deployment";
  const liveUrl = deployment.public_url;

  const copyUrl = () => {
    if (liveUrl) {
      navigator.clipboard.writeText(liveUrl);
      toast.success("URL copied to clipboard");
    }
  };

  const shareViaEmail = () => {
    if (liveUrl) {
      window.open(
        `mailto:?subject=Check out my deployment&body=I deployed ${name} on dploy: ${liveUrl}`,
      );
    }
  };

  const shareViaiMessage = () => {
    toast.info("iMessage sharing would open on macOS/iOS");
  };

  const handleDelete = () => {
    if (!id) return;
    deleteDeployment.mutate(id, {
      onSuccess: () => {
        toast.success("Deployment deleted");
        navigate("/dashboard");
      },
      onError: () => {
        toast.error("Failed to delete deployment");
        setShowDeleteModal(false);
      },
    });
  };

  return (
    <div className="size-full min-h-screen bg-gray-50">
      {/* Nav */}
      <div className="border-b bg-white/80 backdrop-blur-sm nav-bar sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate("/dashboard")}>
            <img src={dployIcon} alt="dploy" className="w-8 h-8 rounded-lg logo-hover" />
            <span className="text-xl font-semibold">dploy</span>
          </div>
          <button
            onClick={() => navigate("/dashboard")}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 cursor-pointer btn-hover-subtle rounded-lg px-3 py-1.5"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 page-content">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-semibold">{name}</h1>
              <span
                className={`px-3 py-1 rounded-full text-sm font-medium inline-flex items-center gap-1.5 ${
                  status === "Running"
                    ? "bg-green-100 text-green-700 badge-running"
                    : status === "Building"
                    ? "bg-yellow-100 text-yellow-700 badge-building"
                    : "bg-red-100 text-red-700 badge-failed"
                }`}
              >
                {status === "Building" && <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />}
                {status === "Running" && <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />}
                {status}
              </span>
            </div>
            <button
              onClick={() => setShowDeleteModal(true)}
              className="flex items-center gap-2 text-sm text-gray-400 hover:text-red-500 cursor-pointer btn-hover-subtle rounded-lg px-3 py-2 border border-transparent hover:border-red-200 hover:bg-red-50 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          </div>
          <p className="text-gray-500">
            {source.type === "github" ? (
              <span className="font-mono text-sm">{source.label}</span>
            ) : (
              <span className="italic">{source.label}</span>
            )}
          </p>
        </div>

        {/* Building progress indicator */}
        {status === "Building" && (
          <div className="mb-6 p-5 rounded-xl border border-yellow-200 bg-yellow-50 animate__animated animate__fadeIn">
            <div className="flex items-center gap-3">
              <div className="spinner" style={{ width: 24, height: 24, borderWidth: 2.5 }} />
              <div>
                <p className="text-sm font-medium text-yellow-800">Deploying your project...</p>
                <p className="text-xs text-yellow-600 mt-0.5">This usually takes under a minute</p>
              </div>
            </div>
            <div className="mt-3 h-1.5 bg-yellow-200 rounded-full overflow-hidden">
              <div className="h-full bg-yellow-500 rounded-full" style={{ animation: "progressPulse 2s ease-in-out infinite", width: "60%" }} />
            </div>
          </div>
        )}

        {/* Live URL section */}
        {status === "Running" && liveUrl && (
          <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-xl p-6 mb-6 live-card">
            <div className="flex items-center gap-2 mb-4 text-green-800">
              <div className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse" />
              <span className="font-medium">Your app is live!</span>
            </div>

            <div className="mb-4">
              <div className="text-sm text-gray-600 mb-1.5 font-medium">Live URL</div>
              <div className="flex items-center gap-3">
                <a
                  href={liveUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 bg-white px-4 py-3 rounded-lg border border-gray-200 text-indigo-600 hover:text-indigo-700 flex items-center gap-2 transition-all hover:shadow-sm hover:border-indigo-200"
                >
                  {liveUrl}
                  <ExternalLink className="w-4 h-4" />
                </a>
                <button
                  onClick={copyUrl}
                  className="bg-white hover:bg-gray-50 border border-gray-200 px-4 py-3 rounded-lg flex items-center gap-2 cursor-pointer btn-hover-subtle"
                >
                  <Copy className="w-4 h-4" />
                  Copy URL
                </button>
              </div>
            </div>

            {port !== null && (
              <div className="mb-4">
                <div className="text-sm text-gray-600 mb-1.5 font-medium">Port</div>
                <div className="bg-white px-4 py-2 rounded-lg border border-gray-200 inline-block font-mono text-sm">
                  {port}
                </div>
              </div>
            )}

            <div>
              <div className="text-sm text-gray-600 mb-2 font-medium">Share</div>
              <div className="flex gap-2">
                <button
                  onClick={shareViaEmail}
                  className="bg-white hover:bg-gray-50 border border-gray-200 px-4 py-2 rounded-lg flex items-center gap-2 text-sm cursor-pointer btn-hover-subtle"
                >
                  <Mail className="w-4 h-4" />
                  Email
                </button>
                <button
                  onClick={shareViaiMessage}
                  className="bg-white hover:bg-gray-50 border border-gray-200 px-4 py-2 rounded-lg flex items-center gap-2 text-sm cursor-pointer btn-hover-subtle"
                >
                  <MessageSquare className="w-4 h-4" />
                  iMessage
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Failed banner */}
        {status === "Failed" && (
          <div className="mb-6 p-5 rounded-xl border border-red-200 bg-red-50 animate__animated animate__shakeX" style={{ animationDuration: "0.6s" }}>
            <p className="text-sm font-medium text-red-800">Deployment failed</p>
            <p className="text-xs text-red-600 mt-0.5">Check the build logs below for details</p>
          </div>
        )}

        {/* Build Logs */}
        <div className="bg-white rounded-xl border overflow-hidden animate__animated animate__fadeInUp" style={{ animationDuration: "0.5s", animationDelay: "0.2s" }}>
          <div className="border-b px-6 py-4 flex items-center justify-between">
            <h3 className="text-lg font-medium">Build Logs</h3>
            {status === "Building" && (
              <span className="text-xs text-gray-400 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-yellow-400 rounded-full animate-pulse" />
                Live
              </span>
            )}
          </div>
          <div className="p-6">
            <div className="bg-gray-950 text-green-400 p-5 rounded-lg font-mono text-sm overflow-auto max-h-96 leading-relaxed">
              {logLines.length === 0 && status === "Building" ? (
                <div className="flex items-center gap-2 text-yellow-400 animate-pulse">
                  <span className="spinner" style={{ width: 14, height: 14, borderWidth: 1.5, borderColor: "rgba(234,179,8,0.3)", borderTopColor: "#eab308" }} />
                  Waiting for logs...
                </div>
              ) : (
                logLines.map((line, index) => (
                  <div
                    key={index}
                    className="mb-0.5 whitespace-pre-wrap log-line"
                    style={{ animationDelay: `${index * 0.03}s` }}
                  >
                    {line}
                  </div>
                ))
              )}
              {logLines.length > 0 && status === "Building" && (
                <div className="mt-1 flex items-center gap-2 text-yellow-400 animate-pulse">
                  <span className="spinner" style={{ width: 14, height: 14, borderWidth: 1.5, borderColor: "rgba(234,179,8,0.3)", borderTopColor: "#eab308" }} />
                  Building...
                </div>
              )}
              {deployment.error && (
                <div className="mt-3 text-red-400 whitespace-pre-wrap border-t border-gray-800 pt-3">{deployment.error}</div>
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        </div>
      </div>

      {/* Delete confirmation modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm animate__animated animate__fadeIn"
            style={{ animationDuration: "0.2s" }}
            onClick={() => !deleteDeployment.isPending && setShowDeleteModal(false)}
          />
          <div
            className="relative bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4 animate__animated animate__fadeInUp"
            style={{ animationDuration: "0.3s" }}
          >
            <div className="text-center mb-6">
              <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Trash2 className="w-7 h-7 text-red-500" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Delete Deployment</h3>
              <p className="text-gray-500 text-sm">
                Are you sure you want to delete <span className="font-medium text-gray-700">{name}</span>? This will shut down the live URL and remove it from your account. This action cannot be undone.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteModal(false)}
                disabled={deleteDeployment.isPending}
                className="flex-1 px-4 py-3 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 cursor-pointer btn-hover-subtle disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteDeployment.isPending}
                className="flex-1 px-4 py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white cursor-pointer btn-hover flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deleteDeployment.isPending ? (
                  <>
                    <span className="spinner" style={{ borderColor: "rgba(255,255,255,0.3)", borderTopColor: "white", width: 16, height: 16, borderWidth: 2 }} />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes progressPulse {
          0%, 100% { width: 30%; opacity: 0.7; }
          50% { width: 80%; opacity: 1; }
        }
      `}</style>
    </div>
  );
}
