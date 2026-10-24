import axios, { type AxiosInstance } from "axios";

export interface ApiClientConfig {
  baseUrl: string;
  token?: string;
  username?: string;
  password?: string;
}

/**
 * Credentials travel as an Authorization header. Axios's `auth` option is lost when a request
 * follows a redirect, so a same-host 302 (e.g. /pullrequests/{id}/diffstat) reached its target
 * unauthenticated and failed with 404. The redirect follower (follow-redirects) keeps the
 * header on the same host, a subdomain of it, and an http-to-https upgrade; it drops the header
 * on any other host, such as the S3 link a step log redirects to.
 */
export function createApiClient(config: ApiClientConfig): AxiosInstance {
  const headers: Record<string, string> = {};
  if (config.token) {
    headers.Authorization = `Bearer ${config.token}`;
  } else if (config.username && config.password) {
    const credentials = Buffer.from(
      `${config.username}:${config.password}`
    ).toString("base64");
    headers.Authorization = `Basic ${credentials}`;
  }
  return axios.create({ baseURL: config.baseUrl, headers });
}
