import "./UserAvatar.css";

interface UserAvatarProps {
  name: string;
  /** Server-validated image data URL; the initial is shown without one. */
  src?: string;
  size?: number;
  alt?: string;
  className?: string;
}

/** Circular user avatar: the profile photo, or the name's initial. */
export default function UserAvatar({ name, src, size = 32, alt, className }: UserAvatarProps) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      className={`user-avatar${className ? ` ${className}` : ""}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      aria-hidden={alt ? undefined : true}
    >
      {src ? <img src={src} alt={alt ?? ""} className="user-avatar__image" /> : initial}
    </span>
  );
}
