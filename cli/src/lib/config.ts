import Conf from "conf";

type Schema = {
  token?: string;
  apiUrl: string;
  mock?: boolean;
};

export const DEFAULT_API_URL = "https://api.dploy.dev";

export const config = new Conf<Schema>({
  projectName: "dploy",
  defaults: { apiUrl: DEFAULT_API_URL },
});
