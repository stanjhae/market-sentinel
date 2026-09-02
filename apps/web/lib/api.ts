export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/sentinel-api";

export function apiUrl(args: { path: string }): string {
  return `${API_BASE_URL}${args.path}`;
}

export function apiFetch(args: { path: string; init?: RequestInit }): Promise<Response> {
  return fetch(apiUrl({ path: args.path }), {
    ...args.init,
    credentials: "include",
  });
}
