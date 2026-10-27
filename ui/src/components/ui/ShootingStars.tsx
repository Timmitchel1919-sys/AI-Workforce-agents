import type { CSSProperties } from "react";
import "./ShootingStars.css";

type ShootingStarStyle = CSSProperties & {
  "--star-top": string;
  "--star-delay": string;
  "--star-duration": string;
  "--star-distance": string;
};

const trails: ShootingStarStyle[] = [
  { "--star-top": "12%", "--star-delay": "0s", "--star-duration": "5.8s", "--star-distance": "68vw" },
  { "--star-top": "30%", "--star-delay": "2.1s", "--star-duration": "7.2s", "--star-distance": "84vw" },
  { "--star-top": "51%", "--star-delay": "4.6s", "--star-duration": "6.4s", "--star-distance": "72vw" },
  { "--star-top": "70%", "--star-delay": "1.2s", "--star-duration": "8.1s", "--star-distance": "90vw" },
  { "--star-top": "87%", "--star-delay": "6.3s", "--star-duration": "6.9s", "--star-distance": "76vw" },
];

export function ShootingStars({ className = "" }: { className?: string }) {
  return (
    <div className={`shooting-stars ${className}`.trim()} aria-hidden="true">
      <div className="shooting-stars__field" />
      {trails.map((style, index) => (
        <span className="shooting-stars__trail" style={style} key={index} />
      ))}
    </div>
  );
}

export default ShootingStars;
