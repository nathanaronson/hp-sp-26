import { useState, type FormEvent } from "react";
import { useNavigate, Navigate } from "react-router";
import { ArrowLeft, Folder } from "lucide-react";

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}
import { toast } from "sonner";
import dployIcon from "../dployIcon.png";
import { useAuth } from "../lib/AuthContext";
import { useDeploy } from "../lib/api";

export default function AddDeployment() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const deploy = useDeploy();
  const [deploymentType, setDeploymentType] = useState<"github" | "local">("github");
  const [githubUrl, setGithubUrl] = useState("");

  if (authLoading) return null;
  if (!user) return <Navigate to="/" replace />;

  const handleDeploy = (e: FormEvent) => {
    e.preventDefault();
    const url = githubUrl.trim();
    if (!url) return;
    deploy.mutate(
      { body: { github_url: url } },
      {
        onSuccess: (created) => navigate(`/deployment/${created.id}`),
        onError: () => toast.error("Failed to start deployment"),
      },
    );
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

      <div className="max-w-2xl mx-auto px-6 py-12">
        <h1 className="text-3xl mb-2">Add New Deployment</h1>
        <p className="text-gray-600 mb-8">
          Deploy from GitHub or a local project on your computer
        </p>

        <div className="bg-white rounded-lg border p-6 mb-6">
          {/* Type Picker */}
          <label className="block mb-4">
            <span className="text-sm text-gray-700 mb-2 block">Deployment Type</span>
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => setDeploymentType("github")}
                className={`p-4 border-2 rounded-lg flex flex-col items-center gap-2 transition-all cursor-pointer ${
                  deploymentType === "github"
                    ? "border-indigo-600 bg-indigo-50"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <GithubIcon className="w-8 h-8 stroke-[1.5]" />
                <span>GitHub Repository</span>
              </button>
              <button
                onClick={() => setDeploymentType("local")}
                className={`p-4 border-2 rounded-lg flex flex-col items-center gap-2 transition-all cursor-pointer ${
                  deploymentType === "local"
                    ? "border-indigo-600 bg-indigo-50"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <Folder className="w-8 h-8 stroke-[1.5]" />
                <span>Local Project</span>
              </button>
            </div>
          </label>

          {/* GitHub form */}
          {deploymentType === "github" ? (
            <form onSubmit={handleDeploy}>
              <label className="block">
                <span className="text-sm text-gray-700 mb-2 block">GitHub Repository URL</span>
                <input
                  type="text"
                  value={githubUrl}
                  onChange={(e) => setGithubUrl(e.target.value)}
                  placeholder="https://github.com/username/repository"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </label>
            </form>
          ) : (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <p className="text-sm text-gray-700 mb-2">
                To deploy a local project, use the DPloy CLI:
              </p>
              <code className="block bg-gray-900 text-white px-4 py-3 rounded text-sm font-mono">
                cd /path/to/your/project<br />
                dploy deploy
              </code>
              <p className="text-xs text-gray-600 mt-3">
                The CLI will automatically detect your project type and deploy it to a live URL.
              </p>
            </div>
          )}
        </div>

        {deploymentType === "github" && (
          <button
            onClick={handleDeploy as () => void}
            disabled={!githubUrl || deploy.isPending}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white py-3 px-4 rounded-lg transition-colors cursor-pointer"
          >
            {deploy.isPending ? "Deploying..." : "Deploy Project"}
          </button>
        )}
      </div>
    </div>
  );
}
