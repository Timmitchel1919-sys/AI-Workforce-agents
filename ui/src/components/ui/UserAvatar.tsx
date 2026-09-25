import "./UserAvatar.css";
import { initialsOf } from "./userInitials";

interface UserAvatarProps {
  name: string;
  /** Server-validated image data URL; the initials are shown without one. */
  src?: string;
  size?: number;
  alt?: string;
  className?: string;
}

/** Circular user avatar: the profile photo, or the name's initials on royal blue. */
export default function UserAvatar({ name, src, size = 32, alt, className }: UserAvatarProps) {
  const initials = initialsOf(name);
  return (
    <span
      className={`user-avatar${src ? " user-avatar--photo" : ""}${className ? ` ${className}` : ""}`}
      style={{ width: size, height: size, fontSize: Math.round(size * (initials.length > 1 ? 0.36 : 0.42)) }}
      aria-hidden={alt ? undefined : true}
    >
      {src ? <img src={src} alt={alt ?? ""} className="user-avatar__image" /> : initials}
    </span>
  );
}
