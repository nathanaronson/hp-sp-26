import Conf from "conf";

type Schema = {
  token?: string;
  apiUrl: string;
  mock?: boolean;
};

export const DEFAULT_API_URL = process.env.DPLOY_API_URL ?? "http://localhost:8000";
const configDir = process.env.DPLOY_CONFIG_DIR;

export const config = new Conf<Schema>({
  projectName: "dploy",
  cwd: configDir,
  defaults: { apiUrl: DEFAULT_API_URL },
});
