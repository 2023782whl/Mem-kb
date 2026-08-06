import type { CSSProperties } from "react";
import { api } from "../api/client";
import type { User } from "../types/domain";

export const AVATAR_PRESETS = ["indigo", "jade", "sunset", "ocean", "plum", "citrus", "slate", "rose"] as const;
export type AvatarPreset = typeof AVATAR_PRESETS[number];

export function UserAvatar({ user, size = 34, className = "" }: { user: Pick<User, "id" | "name" | "avatar_type" | "avatar_value">; size?: number; className?: string }) {
  const style = { "--avatar-size": `${size}px` } as CSSProperties;
  const label = `${user.name}的头像`;
  if (user.avatar_type === "upload" && user.avatar_value) {
    return <span className={`user-avatar upload ${className}`} style={style}><img src={api.userAvatarUrl(user.id, user.avatar_value)} alt={label} /></span>;
  }
  if (user.avatar_type === "preset" && AVATAR_PRESETS.includes(user.avatar_value as AvatarPreset)) {
    return <span className={`user-avatar preset avatar-${user.avatar_value} ${className}`} style={style} role="img" aria-label={label}><i /><b /></span>;
  }
  return <span className={`user-avatar initials ${className}`} style={style} role="img" aria-label={label}>{initials(user.name)}</span>;
}

function initials(name: string) {
  const normalized = name.trim();
  if (!normalized) return "U";
  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length > 1) return `${parts[0][0]}${parts.at(-1)?.[0] || ""}`.toUpperCase();
  return normalized.slice(0, 2).toUpperCase();
}
