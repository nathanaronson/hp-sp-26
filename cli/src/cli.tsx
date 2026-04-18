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

const cli = meow(
  `
  Usage
    $ dploy [command]

  Commands
    deploy [path|github-url]   Deploy current folder or repo (default)
    list                       Show your deployments
    status <id>                Show a deployment
    stop <id>                  Tear down a deployment
    open <id>                  Open a deployment URL
    login [--token <key>]      Log in (OAuth by default)
    login --mock               Log in as demo user (no backend required)
    logout                     Clear saved token
    whoami                     Show current user

  Deploy options
    --env KEY=val              Inline env var (repeatable)
    --env-file <path>          Explicit env file
    --name <name>              Deployment name
    --follow                   Stay attached after ready
  `,
  {
    importMeta: import.meta,
    version: VERSION,
    flags: {
      env: { type: "string", isMultiple: true, default: [] },
      envFile: { type: "string" },
      name: { type: "string" },
      follow: { type: "boolean", default: false },
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
    render(<Stop id={rest[0]!} />);
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
