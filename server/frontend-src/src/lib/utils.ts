import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
// Site-wide premium theme layer; utils is imported by every page, so the theme loads everywhere.
import "./premium-theme.css";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
