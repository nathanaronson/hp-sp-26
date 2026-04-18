import { render } from "ink";
import meow from "meow";
import { Deploy } from "./commands/deploy.js";
import { List } from "./commands/list.js";
import { Status } from "./commands/status.js";
import { Stop } from "./commands/stop.js";
import { Login } from "./commands/login.js";
import { Logout } from "./commands/logout.js";
import { Whoami } from "./commands/whoami.js";
import { openCmd } from "./commands/open.js";
import { VERSION } from "./lib/version.js";

const HELP_TEXT = `
  ▲ dploy  v${VERSION}

  Just deploy it.

  Usage
    $ dploy
    $ dploy deploy [path|github-url]
    $ dploy <path|github-url>

  Core Commands
    deploy [path|github-url]   Deploy the current folder, a local path, or GitHub repo
    list                       Browse recent deployments
    status <id>                Inspect one deployment
    stop <id>                  Tear down a deployment
    open <id>                  Open a live deployment in the browser

  Auth
    login                      Browser OAuth flow
    login --token <key>        Paste a token manually
    login --mock               Instant demo login with seeded mock data
    logout                     Clear saved auth + mock mode
    whoami                     Show the active user

  Deploy Flags
    --env KEY=val              Inline env var, repeatable
    --env-file <path>          Load env vars from a file
    --name <name>              Override the deployment name
    --follow                   Stay attached after the deploy finishes
    --yes                      Skip confirmation for destructive commands

  Examples
    $ dploy
    $ dploy ./apps/web --name landing-page
    $ dploy https://github.com/acme/api --env NODE_ENV=production
    $ dploy login --mock
    $ dploy deploy . --follow
    $ dploy stop dep_abc123 --yes

  Tips
    - Press q to quit long-running Ink views.
    - Use --follow when you want the terminal to stay attached after ready.
    - Mock mode is the fastest way to demo the CLI without a backend.
`;

const cli = meow(
  HELP_TEXT,
  {
    importMeta: import.meta,
    description: false,
    version: VERSION,
    flags: {
      env: { type: "string", isMultiple: true, default: [] },
      envFile: { type: "string" },
      name: { type: "string" },
      follow: { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
      token: { type: "string" },
      mock: { type: "boolean", default: false },
    },
    allowUnknownFlags: false,
  },
);

const [rawCmd, ...rest] = cli.input;
const cmd = rawCmd ?? "deploy";

switch (cmd) {
  case "deploy": {
    render(
      <Deploy
        target={rest[0]}
        envInline={cli.flags.env ?? []}
        envFile={cli.flags.envFile}
        name={cli.flags.name}
        follow={cli.flags.follow ?? false}
      />,
    );
    break;
  }
  case "list":
    render(<List />);
    break;
  case "status":
    requireArg(rest[0], "status <id>");
    render(<Status id={rest[0]!} />);
    break;
  case "stop":
    requireArg(rest[0], "stop <id>");
    render(<Stop id={rest[0]!} yes={cli.flags.yes ?? false} />);
    break;
  case "open":
    requireArg(rest[0], "open <id>");
    await openCmd(rest[0]!);
    break;
  case "login":
    render(<Login token={cli.flags.token} mock={cli.flags.mock} />);
    break;
  case "logout":
    render(<Logout />);
    break;
  case "whoami":
    render(<Whoami />);
    break;
  default: {
    render(
      <Deploy
        target={cmd}
        envInline={cli.flags.env ?? []}
        envFile={cli.flags.envFile}
        name={cli.flags.name}
        follow={cli.flags.follow ?? false}
      />,
    );
  }
}

function requireArg(value: string | undefined, usage: string): void {
  if (!value) {
    console.error(`Missing argument. Usage: dploy ${usage}`);
    process.exit(1);
  }
}
