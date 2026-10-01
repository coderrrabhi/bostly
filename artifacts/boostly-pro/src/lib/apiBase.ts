// Base URL for the backend. Defaults to same-origin "/api"; set VITE_API_URL
// (e.g. https://api.example.com/api) when the server runs on another host.
export const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) || "/api").replace(/\/+$/, "");
export const apiUrl = (path: string) => `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
