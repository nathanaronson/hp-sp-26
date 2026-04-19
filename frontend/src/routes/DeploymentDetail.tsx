import { useParams, useNavigate, Navigate } from "react-router";
import { ArrowLeft, Copy, ExternalLink, Mail, MessageSquare, TerminalSquare } from "lucide-react";
import { toast } from "sonner";
import dployIcon from "../dployIcon.png";
import { useAuth } from "../lib/AuthContext";
import {
  deploymentLogLines,
  deploymentSource,
  displayStatus,
  useProject,
} from "../lib/api";

export default function DeploymentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { data: deployment, isLoading, isError } = useProject(id, { poll: true });

  if (authLoading) return null;
  if (!user) return <Navigate to="/" replace />;

  if (isError) {
    return (
      <div className="size-full min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl mb-4">Deployment not found</h2>
          <button
            onClick={() => navigate("/dashboard")}
            className="text-indigo-600 hover:text-indigo-700 cursor-pointer"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (isLoading || !deployment) {
    return (
      <div className="size-full min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  const status = displayStatus(deployment.status);
  const source = deploymentSource(deployment);
  const logLines = deploymentLogLines(deployment);
  const port = deployment.exposed_ports?.[0] ?? null;
  const name = deployment.name ?? "Untitled deployment";
  const liveUrl = deployment.public_url;
  const isCli = deployment.kind === "cli";
  const canOpenTerminal = Boolean(deployment.sandbox_id) && deployment.status === "running";
  const terminalCommand = deployment.entrypoint && deployment.entrypoint.length > 0
    ? deployment.entrypoint.join(" ")
    : (deployment.start_command ?? "(entrypoint not configured)");

  const copyUrl = () => {
    if (liveUrl) {
      navigator.clipboard.writeText(liveUrl);
      toast.success("URL copied to clipboard");
    }
  };

  const shareViaEmail = () => {
    if (liveUrl) {
      window.open(
        `mailto:?subject=Check out my deployment&body=I deployed ${name} on DPloy: ${liveUrl}`,
      );
    }
  };

  const shareViaiMessage = () => {
    toast.info("iMessage sharing would open on macOS/iOS");
  };

  return (
    <div className="size-full min-h-screen bg-gray-50">
      {/* Nav */}
      <div className="border-b bg-white">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={dployIcon} alt="DPloy" className="w-8 h-8 rounded-lg" />
            <span className="text-xl">DPloy</span>
          </div>
          <button
            onClick={() => navigate("/dashboard")}
            className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl">{name}</h1>
            <span
              className={`px-3 py-1 rounded text-sm ${
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
          <p className="text-gray-600">
            {source.type === "github" ? (
              source.label
            ) : (
              <span className="italic">{source.label}</span>
            )}
          </p>
          {canOpenTerminal && (
            <button
              onClick={() => navigate(`/deployment/${deployment.id}/terminal`)}
              className="mt-3 inline-flex items-center gap-2 px-3 py-2 rounded bg-gray-900 text-white text-sm hover:bg-gray-800 cursor-pointer"
            >
              <TerminalSquare className="w-4 h-4" />
              Open terminal
            </button>
          )}
        </div>

        {/* Live URL section */}
        {isCli && (
          <div
            className={`rounded-lg p-6 mb-6 border ${
              status === "Running"
                ? "bg-gradient-to-r from-amber-50 to-orange-50 border-amber-200"
                : "bg-gradient-to-r from-gray-50 to-slate-50 border-gray-200"
            }`}
          >
            <div className="flex items-center gap-2 mb-3 text-gray-900">
              <div
                className={`w-2 h-2 rounded-full ${
                  status === "Running" ? "bg-amber-500 animate-pulse" : "bg-gray-400"
                }`}
              />
              <span>{status === "Running" ? "Your CLI is ready" : "Preparing your CLI"}</span>
            </div>
            <div className="text-sm text-gray-700 mb-2">
              This deployment is terminal-first. Anyone with the URL below can use the CLI from
              their browser — no login required.
            </div>
            {liveUrl && (
              <div className="mb-4">
                <div className="text-sm text-gray-700 mb-1">Terminal URL</div>
                <div className="flex items-center gap-3">
                  <a
                    href={liveUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 bg-white px-4 py-3 rounded border border-gray-200 text-indigo-600 hover:text-indigo-700 flex items-center gap-2"
                  >
                    {liveUrl}
                    <ExternalLink className="w-4 h-4" />
                  </a>
                  <button
                    onClick={copyUrl}
                    className="bg-white hover:bg-gray-50 border border-gray-200 px-4 py-3 rounded flex items-center gap-2 transition-colors cursor-pointer"
                  >
                    <Copy className="w-4 h-4" />
                    Copy URL
                  </button>
                </div>
              </div>
            )}
            <div className="bg-white px-4 py-3 rounded border border-gray-200 font-mono text-sm break-all">
              $ {terminalCommand}
            </div>
            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={() => navigate(`/deployment/${deployment.id}/terminal`)}
                disabled={!canOpenTerminal}
                className="inline-flex items-center gap-2 px-4 py-2 rounded bg-gray-900 text-white text-sm hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed cursor-pointer"
              >
                <TerminalSquare className="w-4 h-4" />
                Open terminal
              </button>
              {!canOpenTerminal && (
                <span className="text-sm text-gray-600">
                  The terminal unlocks once install/build finishes.
                </span>
              )}
            </div>
          </div>
        )}

        {!isCli && status === "Running" && liveUrl && (
          <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg p-6 mb-6">
            <div className="flex items-center gap-2 mb-4 text-green-800">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              <span>Your app is live!</span>
            </div>

            <div className="mb-4">
              <div className="text-sm text-gray-700 mb-1">Live URL</div>
              <div className="flex items-center gap-3">
                <a
                  href={liveUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 bg-white px-4 py-3 rounded border border-gray-200 text-indigo-600 hover:text-indigo-700 flex items-center gap-2"
                >
                  {liveUrl}
                  <ExternalLink className="w-4 h-4" />
                </a>
                <button
                  onClick={copyUrl}
                  className="bg-white hover:bg-gray-50 border border-gray-200 px-4 py-3 rounded flex items-center gap-2 transition-colors cursor-pointer"
                >
                  <Copy className="w-4 h-4" />
                  Copy URL
                </button>
              </div>
            </div>

            {port !== null && (
              <div className="mb-4">
                <div className="text-sm text-gray-700 mb-1">Port</div>
                <div className="bg-white px-4 py-2 rounded border border-gray-200 inline-block">
                  {port}
                </div>
              </div>
            )}

            <div>
              <div className="text-sm text-gray-700 mb-2">Share</div>
              <div className="flex gap-2">
                <button
                  onClick={shareViaEmail}
                  className="bg-white hover:bg-gray-50 border border-gray-200 px-4 py-2 rounded flex items-center gap-2 text-sm transition-colors cursor-pointer"
                >
                  <Mail className="w-4 h-4" />
                  Email
                </button>
                <button
                  onClick={shareViaiMessage}
                  className="bg-white hover:bg-gray-50 border border-gray-200 px-4 py-2 rounded flex items-center gap-2 text-sm transition-colors cursor-pointer"
                >
                  <MessageSquare className="w-4 h-4" />
                  iMessage
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Build Logs */}
        <div className="bg-white rounded-lg border">
          <div className="border-b px-6 py-4">
            <h3 className="text-lg">Build Logs</h3>
          </div>
          <div className="p-6">
            <div className="bg-gray-900 text-green-400 p-4 rounded font-mono text-sm overflow-auto max-h-96">
              {logLines.length === 0 && status === "Building" ? (
                <div className="mb-1 animate-pulse text-yellow-400">
                  Waiting for logs...
                </div>
              ) : (
                logLines.map((line, index) => (
                  <div key={index} className="mb-1 whitespace-pre-wrap">
                    {line}
                  </div>
                ))
              )}
              {logLines.length > 0 && status === "Building" && (
                <div className="mb-1 animate-pulse text-yellow-400">Building...</div>
              )}
              {deployment.error && (
                <div className="mt-3 text-red-400 whitespace-pre-wrap">{deployment.error}</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
